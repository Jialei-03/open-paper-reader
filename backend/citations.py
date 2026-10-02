# ruff: noqa: B008
"""Explicit citation lookup using public identifiers, plus private saved cards."""

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from typing import Literal
from urllib.parse import quote

import httpx
from fastapi import Depends, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import JSON, ForeignKey, Integer, String, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, Paper, now, uid
from .schemas import Strict


class SavedCitation(Base):
    __tablename__ = "saved_citations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    key: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON)
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (UniqueConstraint("owner", "paper_id", "key"),)


class CitationInput(Strict):
    title: str = Field(min_length=1, max_length=1000)
    abstract: str = Field(default="", max_length=20000)
    authors: list[str] = Field(default_factory=list, max_length=100)
    year: int | None = Field(default=None, ge=1000, le=3000)
    doi: str = Field(default="", max_length=250)
    arxiv: str = Field(default="", max_length=100)
    s2_id: str = Field(default="", max_length=80)

    @field_validator("authors")
    @classmethod
    def authors_valid(cls, values):
        if any(not v.strip() or len(v) > 250 for v in values):
            raise ValueError("作者名称无效")
        return values

    @field_validator("doi", "arxiv", "s2_id")
    @classmethod
    def identifiers_valid(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError("文献标识无效")
        return value.strip()


def citation_identifier(paper):
    from .arxiv_import import identifier

    raw = paper.external_id.strip()
    match = re.fullmatch(
        r"(?:doi:|https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[^\s]+)", raw, re.IGNORECASE
    )
    if match:
        return "DOI:" + match.group(1)
    try:
        arxiv = identifier(raw)
        return "ARXIV:" + re.sub(r"v\d+$", "", arxiv)
    except ValueError:
        raise HTTPException(422, "请先在论文信息中填写 DOI 或 arXiv 标识") from None


_cache = OrderedDict()
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(2)


def fetch_relations(identifier, relation, offset):
    key = (identifier, relation, offset)
    with _lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < 900:
            return hit[1]
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "引用查询繁忙，请稍后重试")
    try:
        url = (
            "https://api.semanticscholar.org/graph/v1/paper/"
            + quote(identifier, safe="")
            + "/"
            + relation
        )
        with httpx.Client(timeout=20, follow_redirects=False) as client:  # noqa: SIM117
            with client.stream(
                "GET",
                url,
                params={
                    "offset": offset,
                    "limit": 50,
                    "fields": "title,authors,year,externalIds,abstract",
                },
            ) as response:
                if response.status_code == 404:
                    raise HTTPException(404, "公开引用库尚未收录这篇论文")
                if response.status_code != 200:
                    raise HTTPException(503, "引用服务暂不可用，请稍后重试")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 2 * 1024**2:
                        raise HTTPException(502, "引用服务返回内容过大")
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise TypeError("Invalid citation response")
        next_page = data.get("next")
        if next_page is not None and (
            isinstance(next_page, bool)
            or not isinstance(next_page, int)
            or next_page <= offset
            or next_page > 10000
        ):
            raise ValueError("Invalid citation cursor")
        rows = []
        for item in data.get("data", []):
            paper = (
                item.get("citedPaper" if relation == "references" else "citingPaper")
                or {}
            )
            if not paper.get("title"):
                continue
            ids = paper.get("externalIds") or {}
            rows.append(
                CitationInput(
                    title=paper["title"],
                    abstract=(paper.get("abstract") or "")[:20000],
                    authors=[
                        a["name"] for a in paper.get("authors", []) if a.get("name")
                    ][:100],
                    year=paper.get("year"),
                    doi=ids.get("DOI") or "",
                    arxiv=ids.get("ArXiv") or "",
                    s2_id=paper.get("paperId") or "",
                ).model_dump()
            )
        value = {
            "items": rows,
            "next": next_page,
            "source": "Semantic Scholar",
            "source_url": "https://www.semanticscholar.org/",
        }
        with _lock:
            _cache[key] = (time.monotonic(), value)
            while len(_cache) > 128:
                _cache.popitem(last=False)
        return value
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(503, "引用服务暂不可用，请稍后重试") from None
    finally:
        _slots.release()


def install_citation_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/papers/{id}/citations")
    def read(
        id: str,
        relation: Literal["saved", "references", "citations"] = "saved",
        offset: int = Query(0, ge=0, le=10000),
        a=Depends(auth),
        d=Depends(db),
    ):
        paper = owned(d, Paper, id, a)
        if relation == "saved":
            return {
                "items": [
                    {**row.data, "saved_id": row.id}
                    for row in d.scalars(
                        select(SavedCitation)
                        .where(
                            SavedCitation.owner == a["id"], SavedCitation.paper_id == id
                        )
                        .order_by(SavedCitation.created_at)
                    )
                ],
                "next": None,
                "source": "已保存",
            }
        identifier = citation_identifier(paper)
        return getattr(app.state, "citation_fetcher", fetch_relations)(
            identifier, relation, offset
        )

    @app.get("/api/v1/papers/{id}/citation-preview")
    def preview(
        id: str,
        excerpt: str = Query(min_length=1, max_length=2000),
        a=Depends(auth),
        d=Depends(db),
    ):
        # Only the source's public ID goes upstream; private PDF text stays here.
        paper = owned(d, Paper, id, a)
        identifier = citation_identifier(paper)

        def normalize(value):
            return "".join(c for c in value.casefold() if c.isalnum())

        text = normalize(excerpt)
        fetcher = getattr(app.state, "citation_fetcher", fetch_relations)
        offset = 0
        examined = 0
        for _ in range(4):
            result = fetcher(identifier, "references", offset)
            examined += len(result["items"])
            matches = [
                row
                for row in result["items"]
                if len(normalize(row["title"])) >= 12
                and normalize(row["title"]) in text
            ]
            if matches:
                return {
                    "items": matches,
                    "source": "Semantic Scholar",
                    "examined": examined,
                    "match": "title_in_reference",
                }
            if result["next"] is None:
                break
            offset = result["next"]
        return {
            "items": [],
            "source": "Semantic Scholar",
            "examined": examined,
            "message": "未能可靠匹配此处引用；可查看原文，不会猜测摘要。",
        }

    @app.post("/api/v1/papers/{id}/citations")
    def save(id: str, body: CitationInput, a=Depends(auth), d=Depends(db)):
        from .storage_budget import lock_owner, require_space

        lock_owner(d, a["id"])
        owned(d, Paper, id, a)
        data = body.model_dump()
        identifier = (
            body.doi.lower()
            or body.arxiv.lower()
            or body.s2_id
            or body.title.casefold()
        )
        key = hashlib.sha256(identifier.encode()).hexdigest()
        existing = d.scalar(
            select(SavedCitation).where(
                SavedCitation.owner == a["id"],
                SavedCitation.paper_id == id,
                SavedCitation.key == key,
            )
        )
        if existing:
            return {**existing.data, "saved_id": existing.id}
        if (
            d.scalar(
                select(func.count())
                .select_from(SavedCitation)
                .where(SavedCitation.owner == a["id"], SavedCitation.paper_id == id)
            )
            >= 1000
        ):
            raise HTTPException(409, "单篇论文最多保存 1000 张引用卡片")
        size = len(json.dumps(data, ensure_ascii=False).encode()) + 256
        require_space(d, settings, a["id"], size)
        row = SavedCitation(owner=a["id"], paper_id=id, key=key, data=data, size=size)
        d.add(row)
        d.commit()
        return {**data, "saved_id": row.id}

    @app.delete("/api/v1/papers/{id}/citations/{citation_id}")
    def remove(id: str, citation_id: str, a=Depends(auth), d=Depends(db)):
        owned(d, Paper, id, a)
        row = owned(d, SavedCitation, citation_id, a)
        if row.paper_id != id:
            raise HTTPException(404, "引用不存在")
        d.delete(row)
        d.commit()
        return {"ok": True}
