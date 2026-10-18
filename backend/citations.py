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
from fastapi import Depends, HTTPException, Query, Response
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


# --- Metadata of one cited work -------------------------------------------------
# Private, minimal lookup. The controller may swap `lookup` for `backend.scholar.lookup`
# (same signature and fields) when that module lands.

_FIELDS = (
    "title,authors,year,venue,abstract,citationCount,referenceCount,externalIds,url"
)
_DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.IGNORECASE)
_ARXIV = re.compile(
    r"(?:arxiv[:\s/]*(?:abs/)?|arxiv\.org/abs/)(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE
)
_meta_cache = OrderedDict()
_meta_lock = threading.Lock()
_meta_slots = threading.BoundedSemaphore(3)
_pdf_slots = threading.BoundedSemaphore(2)
_pace_lock = threading.Lock()
_pace_last = 0.0
# Seconds between two requests to the public services, and the timeout of one.
_SPACING = 0.6
_TIMEOUT = 8.0
FOUND_TTL = 24 * 3600
MISSING_TTL = 3600


def _norm(value):
    return "".join(c for c in (value or "").casefold() if c.isalnum())


def references_in(text):
    """The public identifiers an entry of a reference list prints: (doi, arxiv)."""
    doi = _DOI.search(text or "")
    arxiv = _ARXIV.search(text or "")
    return (
        doi.group(1).rstrip(".,;)]}") if doi else None,
        arxiv.group(1) if arxiv else None,
    )


def _get(url, params=None):
    """One bounded GET of a public service: the parsed JSON, or the text of a feed."""
    global _pace_last
    with _pace_lock:
        wait = _SPACING - (time.monotonic() - _pace_last)
        if wait > 0:
            time.sleep(wait)
        _pace_last = time.monotonic()
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=False) as client:  # noqa: SIM117
        with client.stream(
            "GET", url, params=params, headers={"User-Agent": "PaperWorkspace/1.0"}
        ) as response:
            if response.status_code == 404:
                return None
            if response.status_code != 200:
                raise httpx.HTTPError(f"HTTP {response.status_code}")
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > 2 * 1024**2:
                    raise httpx.HTTPError("too large")
    return json.loads(raw)


def _from_s2(row):
    ids = row.get("externalIds") or {}
    return {
        "title": row.get("title") or "",
        "authors": [a["name"] for a in row.get("authors") or [] if a.get("name")][:100],
        "year": row.get("year"),
        "venue": row.get("venue") or "",
        "abstract": (row.get("abstract") or "")[:20000],
        "citation_count": row.get("citationCount"),
        "reference_count": row.get("referenceCount"),
        "doi": ids.get("DOI") or "",
        "arxiv": ids.get("ArXiv") or "",
        "url": row.get("url") or "",
    }


def _from_openalex(row):
    index = row.get("abstract_inverted_index") or {}
    words = sorted((at, word) for word, places in index.items() for at in places)
    doi = (row.get("doi") or "").removeprefix("https://doi.org/")
    arxiv = ""
    match = re.fullmatch(r"10\.48550/arxiv\.(.+)", doi, re.IGNORECASE)
    if match:
        arxiv = match.group(1)
    source = ((row.get("primary_location") or {}).get("source") or {}).get(
        "display_name"
    )
    return {
        "title": row.get("title") or "",
        "authors": [
            (a.get("author") or {}).get("display_name")
            for a in row.get("authorships") or []
            if (a.get("author") or {}).get("display_name")
        ][:100],
        "year": row.get("publication_year"),
        "venue": source or "",
        "abstract": " ".join(word for _, word in words)[:20000],
        "citation_count": row.get("cited_by_count"),
        "reference_count": len(row.get("referenced_works") or []) or None,
        "doi": doi,
        "arxiv": arxiv,
        "url": row.get("id") or "",
    }


def _from_arxiv(arxiv):
    from .arxiv_import import metadata_api

    data = metadata_api(arxiv)
    return {
        "title": data["title"],
        "authors": [a.strip() for a in data["authors"].split(";") if a.strip()],
        "year": None,
        "venue": "arXiv",
        "abstract": data["abstract"],
        "citation_count": None,
        "reference_count": None,
        "doi": "",
        "arxiv": re.sub(r"v\d+$", "", data["arxiv_id"]),
        "url": "https://arxiv.org/abs/" + re.sub(r"v\d+$", "", data["arxiv_id"]),
    }


def _plausible(item, title):
    """A work found by title is only taken when its title is in the text that was asked about."""
    found, asked = _norm(item.get("title")), _norm(title)
    return len(found) >= 12 and (found in asked or asked in found)


def _sources(doi, arxiv, title):
    """The services to ask, in order: each returns an item, None (not there) or raises."""
    base = "https://api.semanticscholar.org/graph/v1/paper/"

    def s2():
        if doi or arxiv:
            ident = f"DOI:{doi}" if doi else f"ARXIV:{arxiv}"
            row = _get(base + quote(ident, safe=":/"), {"fields": _FIELDS})
            return _from_s2(row) if isinstance(row, dict) and row.get("title") else None
        data = _get(base + "search/match", {"query": title[:300], "fields": _FIELDS})
        rows = (data or {}).get("data") or []
        item = _from_s2(rows[0]) if rows and rows[0].get("title") else None
        return item if item and _plausible(item, title) else None

    def openalex():
        root = "https://api.openalex.org/works"
        if doi or arxiv:
            key = doi or f"10.48550/arXiv.{arxiv}"
            row = _get(f"{root}/https://doi.org/{quote(key, safe='/')}")
            return (
                _from_openalex(row)
                if isinstance(row, dict) and row.get("title")
                else None
            )
        data = _get(root, {"search": title[:300], "per-page": 1})
        rows = (data or {}).get("results") or []
        item = _from_openalex(rows[0]) if rows and rows[0].get("title") else None
        return item if item and _plausible(item, title) else None

    out = [s2, openalex]
    if arxiv:
        out.append(lambda: _from_arxiv(arxiv))
    return out


def lookup(*, doi=None, arxiv=None, title=None):
    """The work named by a DOI, an arXiv id or (failing those) a title, or None.

    Asks Semantic Scholar, then OpenAlex, then arXiv; keeps what it was told for a
    day. Raises HTTPException(503) when no service could be reached at all.
    """
    doi = (doi or "").strip().removeprefix("https://doi.org/") or None
    arxiv = re.sub(r"v\d+$", "", (arxiv or "").strip().lower()) or None
    title = (title or "").strip() or None
    if not (doi or arxiv or title):
        return None
    key = (
        ("doi", doi.lower())
        if doi
        else ("arxiv", arxiv)
        if arxiv
        else ("title", _norm(title))
    )
    with _meta_lock:
        hit = _meta_cache.get(key)
        if hit and time.monotonic() < hit[0]:
            _meta_cache.move_to_end(key)
            return hit[1]
    if not _meta_slots.acquire(blocking=False):
        raise HTTPException(429, "文献查询繁忙，请稍后重试")
    try:
        failed, item = 0, None
        sources = _sources(doi, arxiv, title or "")
        for ask in sources:
            try:
                item = ask()
            except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                failed += 1
                continue
            if item:
                break
        if not item and failed == len(sources):
            raise HTTPException(503, "文献服务暂时连不上，请稍后重试")
        # A DOI or arXiv id read from the entry is a fact even if the service omitted it.
        if item:
            item["doi"] = item.get("doi") or doi or ""
            item["arxiv"] = item.get("arxiv") or arxiv or ""
        with _meta_lock:
            _meta_cache[key] = (
                time.monotonic() + (FOUND_TTL if item else MISSING_TTL),
                item,
            )
            while len(_meta_cache) > 512:
                _meta_cache.popitem(last=False)
        return item
    finally:
        _meta_slots.release()


def install_citation_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/citations/lookup")
    def lookup_route(
        entry: str = Query("", max_length=2000),
        doi: str = Query("", max_length=250),
        arxiv: str = Query("", max_length=100),
        title: str = Query("", max_length=1000),
        a=Depends(auth),
    ):
        # An entry of a reference list is public bibliographic text; nothing else goes upstream.
        found_doi, found_arxiv = references_in(entry)
        doi, arxiv = doi or found_doi or "", arxiv or found_arxiv or ""
        title = title or ("" if doi or arxiv else entry)
        if not (doi or arxiv or title):
            raise HTTPException(422, "缺少要查询的文献")
        ask = getattr(app.state, "citation_lookup", lookup)
        return {"item": ask(doi=doi or None, arxiv=arxiv or None, title=title or None)}

    @app.get("/api/v1/citations/arxiv-pdf")
    def arxiv_pdf(id: str = Query(max_length=100), a=Depends(auth)):
        from .arxiv_import import ArxivNotFound, download, identifier

        try:
            ident = identifier(id)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        if not _pdf_slots.acquire(blocking=False):
            raise HTTPException(429, "预览繁忙，请稍后重试")
        try:
            data = download(f"/pdf/{ident}", 50 * 1024**2)
        except ArxivNotFound as error:
            raise HTTPException(404, str(error)) from None
        except (ValueError, httpx.HTTPError) as error:
            raise HTTPException(502, str(error)) from None
        finally:
            _pdf_slots.release()
        if not data.startswith(b"%PDF"):
            raise HTTPException(502, "arXiv 没有返回 PDF")
        return Response(
            data,
            media_type="application/pdf",
            headers={"Cache-Control": "private, max-age=3600"},
        )

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
