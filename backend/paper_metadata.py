# ruff: noqa: B008
"""What the public record says about a library paper: venue, year, DOI, counts.

The answer of ``scholar.lookup_checked`` is kept per paper so the library can
show it without asking again; a refresh asks again on request. Nothing here
changes the paper itself.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException
from sqlalchemy import JSON, ForeignKey, String, select
from sqlalchemy.orm import Mapped, mapped_column

from . import scholar
from .models import Base, Paper, now

MAX_PER_MINUTE = 12


class PaperMetadata(Base):
    __tablename__ = "paper_metadata"
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # "ok" with the record in `data`, or "missing": the sources did not know it.
    status: Mapped[str] = mapped_column(String(16), default="ok")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[str] = mapped_column(String(40), default=now)


def identifiers(paper):
    """The DOI or arXiv id a paper's ``external_id`` holds, else its title."""
    doi = scholar.clean_doi(paper.external_id)
    arxiv = "" if doi else scholar.clean_arxiv(paper.external_id)
    return {"doi": doi, "arxiv": arxiv, "title": "" if doi or arxiv else paper.title}


def present(row):
    return {
        "paper_id": row.paper_id,
        "status": row.status,
        "fetched_at": row.fetched_at,
        **row.data,
    }


_recent = defaultdict(deque)
_guard = threading.Lock()


def _allow(owner):
    now_s = time.monotonic()
    with _guard:
        calls = _recent[owner]
        while calls and now_s - calls[0] > 60:
            calls.popleft()
        if len(calls) >= MAX_PER_MINUTE:
            return False
        calls.append(now_s)
        return True


def install_metadata_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/paper-metadata")
    def all_metadata(a=Depends(auth), d=Depends(db)):
        rows = d.scalars(select(PaperMetadata).where(PaperMetadata.owner == a["id"]))
        return {row.paper_id: present(row) for row in rows}

    @app.get("/api/v1/papers/{id}/metadata")
    def read_metadata(id: str, a=Depends(auth), d=Depends(db)):
        owned(d, Paper, id, a)
        row = d.get(PaperMetadata, id)
        if not row or row.owner != a["id"]:
            return {"paper_id": id, "status": "none"}
        return present(row)

    @app.post("/api/v1/papers/{id}/metadata/refresh")
    def refresh_metadata(id: str, a=Depends(auth), d=Depends(db)):
        paper = owned(d, Paper, id, a)
        ids = identifiers(paper)
        if not (ids["doi"] or ids["arxiv"] or len(ids["title"].strip()) >= 8):
            raise HTTPException(422, "这篇论文没有可查询的标题或 DOI / arXiv 编号")
        if not _allow(a["id"]):
            raise HTTPException(429, "查询太频繁，请一分钟后再试")
        fetcher = getattr(app.state, "scholar_lookup", scholar.lookup_checked)
        try:
            found = fetcher(**ids)
        except scholar.ScholarUnavailable:
            raise HTTPException(
                503, "公开文献库暂时连不上，请稍后重试；已有的信息没有改动"
            ) from None
        row = d.get(PaperMetadata, id)
        if not row:
            row = PaperMetadata(paper_id=id, owner=a["id"])
            d.add(row)
        row.status = "ok" if found else "missing"
        if found:
            row.data = found
        row.fetched_at = now()
        d.commit()
        return present(row)
