# ruff: noqa: B008
"""File-bound text highlights and comments, separate from user notes."""

import json
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Query
from pydantic import Field, model_validator
from sqlalchemy import func, select

from .models import File, TextAnnotation, now, public
from .schemas import Strict
from .storage_budget import lock_owner, require_space

Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class AnnotationRect(Strict):
    x: Unit
    y: Unit
    w: Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]
    h: Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]

    @model_validator(mode="after")
    def within_page(self):
        if self.x + self.w > 1.00001 or self.y + self.h > 1.00001:
            raise ValueError("标注范围超出页面")
        return self


class AnnotationInput(Strict):
    page: int = Field(ge=1, le=3000, strict=True)
    quote: str = Field(min_length=1, max_length=10000)
    prefix: str = Field(default="", max_length=1000)
    rects: list[AnnotationRect] = Field(min_length=1, max_length=64)
    color: Color = "#fde68a"
    comment: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def has_quote(self):
        if not self.quote.strip():
            raise ValueError("请选择要标注的文字")
        return self


class AnnotationUpdate(Strict):
    revision: int = Field(ge=1, strict=True)
    color: Color | None = None
    comment: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def has_changes(self):
        if self.color is None and self.comment is None:
            raise ValueError("请提供标注颜色或评论")
        return self


def annotation_size(payload):
    return len(json.dumps(payload, ensure_ascii=False).encode()) + 512


def install_annotation_routes(app, settings, db, auth, owned):
    def pdf(d, id, a):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf":
            raise HTTPException(422, "文字标注只支持 PDF")
        return file

    def annotation(d, id, annotation_id, a):
        pdf(d, id, a)
        row = owned(d, TextAnnotation, str(annotation_id), a)
        if row.file_id != id:
            raise HTTPException(404, "标注不存在")
        return row

    def capacity(d, owner, file_id, incoming):
        if incoming <= 0:
            return
        used = d.scalar(
            select(func.coalesce(func.sum(TextAnnotation.size), 0)).where(
                TextAnnotation.file_id == file_id
            )
        )
        if used + incoming > 16 * 1024**2:
            raise HTTPException(409, "这份文件的文字标注已达 16 MB 上限")
        require_space(d, settings, owner, incoming)

    @app.get("/api/v1/files/{id}/annotations")
    def read(id: str, a=Depends(auth), d=Depends(db)):
        pdf(d, id, a)
        return [
            public(row)
            for row in d.scalars(
                select(TextAnnotation)
                .where(
                    TextAnnotation.file_id == id,
                    TextAnnotation.owner == a["id"],
                    TextAnnotation.deleted.is_(False),
                )
                .order_by(
                    TextAnnotation.page, TextAnnotation.created_at, TextAnnotation.id
                )
            )
        ]

    @app.put("/api/v1/files/{id}/annotations/{annotation_id}")
    def create(
        id: str,
        annotation_id: UUID,
        body: AnnotationInput,
        a=Depends(auth),
        d=Depends(db),
    ):
        lock_owner(d, a["id"])
        file = pdf(d, id, a)
        if body.page > (file.pages or 0):
            raise HTTPException(422, "页码超出 PDF 范围")
        payload = body.model_dump(mode="json")
        existing = d.get(TextAnnotation, str(annotation_id))
        if existing:
            if existing.owner != a["id"] or existing.file_id != id:
                raise HTTPException(404, "标注不存在")
            # A delayed create must never resurrect a highlight removed elsewhere.
            if existing.deleted:
                return public(existing)
            if any(
                getattr(existing, key) != payload[key]
                for key in ("page", "quote", "prefix", "rects")
            ):
                raise HTTPException(409, "此标注编号已用于其他选区")
            return public(existing)
        count = d.scalar(
            select(func.count())
            .select_from(TextAnnotation)
            .where(TextAnnotation.file_id == id)
        )
        if count >= 5000:
            raise HTTPException(409, "这份文件的文字标注数量已达上限")
        size = annotation_size(payload)
        capacity(d, a["id"], id, size)
        row = TextAnnotation(
            id=str(annotation_id),
            owner=a["id"],
            paper_id=file.paper_id,
            file_id=file.id,
            version_id=file.version_id,
            size=size,
            **payload,
        )
        d.add(row)
        d.commit()
        return public(row)

    @app.patch("/api/v1/files/{id}/annotations/{annotation_id}")
    def update(
        id: str,
        annotation_id: UUID,
        body: AnnotationUpdate,
        a=Depends(auth),
        d=Depends(db),
    ):
        lock_owner(d, a["id"])
        row = annotation(d, id, annotation_id, a)
        if row.deleted:
            raise HTTPException(404, "标注已删除")
        if row.revision != body.revision:
            raise HTTPException(409, "标注已被更新，请重新加载后修改")
        changes = body.model_dump(exclude={"revision"}, exclude_none=True)
        payload = {key: getattr(row, key) for key in AnnotationInput.model_fields}
        payload.update(changes)
        size = annotation_size(payload)
        capacity(d, a["id"], id, size - row.size)
        for key, value in changes.items():
            setattr(row, key, value)
        row.size = size
        row.revision += 1
        row.updated_at = now()
        d.commit()
        return public(row)

    @app.delete("/api/v1/files/{id}/annotations/{annotation_id}")
    def remove(
        id: str,
        annotation_id: UUID,
        revision: int = Query(ge=1),
        a=Depends(auth),
        d=Depends(db),
    ):
        lock_owner(d, a["id"])
        row = annotation(d, id, annotation_id, a)
        if row.deleted:
            return {"ok": True}
        if row.revision != revision:
            raise HTTPException(409, "标注已被更新，请重新加载后删除")
        row.deleted = True
        row.quote = row.prefix = row.comment = ""
        row.rects = []
        row.size = 512
        row.revision += 1
        row.updated_at = now()
        d.commit()
        return {"ok": True}
