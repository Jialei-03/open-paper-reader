# ruff: noqa: B008
"""Private, file-bound vector handwriting. Stroke IDs make retries idempotent."""

import json
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .models import File, InkStroke, public
from .storage_budget import lock_owner, require_space

Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class StrokeInput(BaseModel):
    page: int = Field(ge=1)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    width: float = Field(ge=0.5, le=12, allow_inf_nan=False)
    points: list[tuple[Unit, Unit, Unit]] = Field(min_length=1, max_length=4096)


def install_ink_routes(app, settings, db, auth, owned):
    def pdf(d, id, a):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf":
            raise HTTPException(422, "手写批注只支持 PDF")
        return file

    @app.get("/api/v1/files/{id}/ink")
    def read(id: str, a=Depends(auth), d=Depends(db)):
        pdf(d, id, a)
        return [
            public(s)
            for s in d.scalars(
                select(InkStroke)
                .where(
                    InkStroke.file_id == id,
                    InkStroke.owner == a["id"],
                    InkStroke.deleted.is_(False),
                )
                .order_by(InkStroke.created_at, InkStroke.id)
            )
        ]

    @app.put("/api/v1/files/{id}/ink/{stroke_id}")
    def put(
        id: str, stroke_id: UUID, body: StrokeInput, a=Depends(auth), d=Depends(db)
    ):
        file = pdf(d, id, a)
        if body.page > (file.pages or 0):
            raise HTTPException(422, "页码超出 PDF 范围")
        lock_owner(d, a["id"])
        identifier = str(stroke_id)
        existing = d.get(InkStroke, identifier)
        if existing:
            if existing.owner != a["id"] or existing.file_id != id:
                raise HTTPException(404, "笔迹不存在")
            return public(existing)
        # Include tombstones to bound metadata as well as live stroke data.
        count = d.scalar(
            select(func.count()).select_from(InkStroke).where(InkStroke.file_id == id)
        )
        if count >= 30000:
            raise HTTPException(409, "这份文件的批注数量已达上限")
        payload = body.model_dump()
        size = len(json.dumps(payload).encode()) + 256
        used = d.scalar(
            select(func.coalesce(func.sum(InkStroke.size), 0)).where(
                InkStroke.file_id == id
            )
        )
        if used + size > 16 * 1024**2:
            raise HTTPException(409, "这份文件的手写批注已达 16 MB 上限")
        require_space(d, settings, a["id"], size)
        stroke = InkStroke(
            id=identifier,
            owner=a["id"],
            paper_id=file.paper_id,
            file_id=id,
            page=body.page,
            data=payload,
            size=size,
        )
        d.add(stroke)
        d.commit()
        return public(stroke)

    @app.delete("/api/v1/files/{id}/ink/{stroke_id}")
    def remove(id: str, stroke_id: UUID, a=Depends(auth), d=Depends(db)):
        pdf(d, id, a)
        lock_owner(d, a["id"])
        stroke = owned(d, InkStroke, str(stroke_id), a)
        if stroke.file_id != id:
            raise HTTPException(404, "笔迹不存在")
        stroke.deleted = True
        stroke.data = {}
        stroke.size = 256
        d.commit()
        return {"ok": True}
