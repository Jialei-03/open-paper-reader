# ruff: noqa: B008
"""Explicit, user-managed library collections, independent of notes and topics."""

from typing import ClassVar
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, Query
from pydantic import Field, model_validator
from sqlalchemy import JSON, ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, Paper, now, public
from .schemas import Strict


class LibraryCollection(Base):
    __tablename__ = "library_collections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    paper_ids: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (UniqueConstraint("owner", "name"),)
    __mapper_args__: ClassVar[dict] = {
        "version_id_col": revision,
        "version_id_generator": False,
    }


class CollectionCreate(Strict):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=100)
    paper_ids: list[UUID] = Field(default_factory=list, max_length=5000)


class CollectionUpdate(Strict):
    revision: int = Field(ge=1, strict=True)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    paper_ids: list[UUID] | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def has_changes(self):
        if self.name is None and self.paper_ids is None:
            raise ValueError("请提供集合名称或论文")
        return self


def remove_paper_from_collections(d, owner, paper_id):
    from .storage_budget import lock_owner

    # Serialize with collection membership writes before deleting its paper.
    lock_owner(d, owner)
    for row in d.scalars(
        select(LibraryCollection).where(LibraryCollection.owner == owner)
    ):
        if paper_id in row.paper_ids:
            row.paper_ids = [
                identifier for identifier in row.paper_ids if identifier != paper_id
            ]
            row.revision += 1
            row.updated_at = now()


def install_collection_routes(app, settings, db, auth, owned):
    from .storage_budget import lock_owner

    def members(d, owner, ids):
        ids = list(dict.fromkeys(str(identifier) for identifier in ids))
        found = set(
            d.scalars(select(Paper.id).where(Paper.owner == owner, Paper.id.in_(ids)))
        )
        if found != set(ids):
            raise HTTPException(404, "集合中包含不存在的论文")
        return ids

    def name_available(d, owner, name, current=None):
        rows = list(
            d.scalars(select(LibraryCollection).where(LibraryCollection.owner == owner))
        )
        if any(
            row.id != current and row.name.casefold() == name.casefold() for row in rows
        ):
            raise HTTPException(409, "已有同名集合")
        return len(rows)

    @app.get("/api/v1/library-collections")
    def list_collections(a=Depends(auth), d=Depends(db)):
        return [
            public(row)
            for row in d.scalars(
                select(LibraryCollection)
                .where(LibraryCollection.owner == a["id"])
                .order_by(LibraryCollection.created_at, LibraryCollection.id)
            )
        ]

    @app.get("/api/v1/library-collections/{id}")
    def read_collection(id: UUID, a=Depends(auth), d=Depends(db)):
        return public(owned(d, LibraryCollection, str(id), a))

    @app.post("/api/v1/library-collections")
    def create_collection(body: CollectionCreate, a=Depends(auth), d=Depends(db)):
        lock_owner(d, a["id"])
        identifier = str(body.id)
        ids = members(d, a["id"], body.paper_ids)
        existing = d.get(LibraryCollection, identifier)
        if existing:
            if existing.owner != a["id"]:
                raise HTTPException(404, "集合不存在")
            if existing.name != body.name or existing.paper_ids != ids:
                raise HTTPException(409, "这个集合已被创建，请重新加载")
            return public(existing)
        if name_available(d, a["id"], body.name) >= 100:
            raise HTTPException(409, "最多创建 100 个集合")
        row = LibraryCollection(
            id=identifier, owner=a["id"], name=body.name, paper_ids=ids
        )
        d.add(row)
        d.commit()
        return public(row)

    @app.patch("/api/v1/library-collections/{id}")
    def update_collection(
        id: UUID, body: CollectionUpdate, a=Depends(auth), d=Depends(db)
    ):
        lock_owner(d, a["id"])
        row = owned(d, LibraryCollection, str(id), a)
        if row.revision != body.revision:
            raise HTTPException(409, "集合已被更新，请重新加载后修改")
        if body.name is not None:
            name_available(d, a["id"], body.name, row.id)
            row.name = body.name
        if body.paper_ids is not None:
            row.paper_ids = members(d, a["id"], body.paper_ids)
        row.revision += 1
        row.updated_at = now()
        d.commit()
        return public(row)

    @app.delete("/api/v1/library-collections/{id}")
    def delete_collection(
        id: UUID, revision: int = Query(ge=1), a=Depends(auth), d=Depends(db)
    ):
        lock_owner(d, a["id"])
        row = owned(d, LibraryCollection, str(id), a)
        if row.revision != revision:
            raise HTTPException(409, "集合已被更新，请重新加载后删除")
        d.delete(row)
        d.commit()
        return {"ok": True}
