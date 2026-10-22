# ruff: noqa: B008
"""Papers worth reading next, from what the person already has in the library.

The library papers that carry a DOI or arXiv id are the seeds. Semantic
Scholar's recommendation service is asked with each seed (so every suggestion
knows which library papers it relates to); when it cannot be reached, OpenAlex's
"related works" of the same seeds stand in. Only public identifiers leave the
machine. The answer is kept per person and renewed at most once a day, or when
asked for (not more than once a minute); papers already in the library and
papers marked "not interested" are left out when it is read, not when it is kept.
"""

import json
import os
import re
import threading
import time
from collections import defaultdict
from urllib.parse import quote

import httpx
from fastapi import Body, Depends, HTTPException, Query
from sqlalchemy import JSON, ForeignKey, String, select
from sqlalchemy.orm import Mapped, mapped_column

from . import scholar
from .models import Base, Paper, now

SEEDS = 5
PER_SEED = 20
KEEP = 60
DAY = 24 * 3600
REFRESH_GAP = 60
DEADLINE = 25
S2_RECOMMEND = "https://api.semanticscholar.org/recommendations/v1/papers/"
OPENALEX = "https://api.openalex.org/works"
S2_FIELDS = (
    "title,authors,year,venue,abstract,citationCount,externalIds,url,"
    "publicationVenue,journal"
)


class RecommendationCache(Base):
    __tablename__ = "recommendation_cache"
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[str] = mapped_column(String(40), default=now)
    # time.time() of the fetch, for the daily rule and the one-minute rule.
    stamp: Mapped[str] = mapped_column(String(32), default="0")


class RecommendationDismissal(Base):
    __tablename__ = "recommendation_dismissals"
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now)


def normal(text):
    return "".join(c for c in (text or "").casefold() if c.isalnum())


def keys_of(item):
    """Every way a work can be recognised: DOI, arXiv id, title."""
    keys = []
    doi = scholar.clean_doi(item.get("doi") or "")
    arxiv = scholar.clean_arxiv(item.get("arxiv") or "")
    if doi:
        keys.append("doi:" + doi)
    if arxiv:
        keys.append("arxiv:" + arxiv)
        # arXiv papers also have a DOI under DataCite's prefix.
        keys.append("doi:10.48550/arxiv." + arxiv)
    title = normal(item.get("title"))
    if len(title) >= 12:
        keys.append("title:" + title[:200])
    return keys


def primary_key(item):
    """The one key a recommendation is dismissed by."""
    return keys_of(item)[0] if keys_of(item) else ""


def paper_item(paper, record=None):
    """A library paper as ``keys_of`` reads it: from its id field, else the public record."""
    raw = paper.external_id or ""
    doi = scholar.clean_doi(raw)
    arxiv = "" if doi else scholar.clean_arxiv(raw)
    if record:
        doi = doi or record.get("doi") or ""
        arxiv = arxiv or record.get("arxiv") or ""
    return {"doi": doi, "arxiv": arxiv, "title": paper.title}


def library(d, owner):
    from .paper_metadata import PaperMetadata

    records = {
        row.paper_id: (row.data if row.status == "ok" else {})
        for row in d.scalars(select(PaperMetadata).where(PaperMetadata.owner == owner))
    }
    papers = list(
        d.scalars(select(Paper).where(Paper.owner == owner).order_by(Paper.updated_at.desc()))
    )
    return papers, records


def seeds_of(papers, records):
    """Up to SEEDS papers with a public id, favourites first, then the latest touched."""
    found = []
    for paper in papers:
        if paper.archived:
            continue
        item = paper_item(paper, records.get(paper.id))
        ident = (
            "DOI:" + item["doi"] if item["doi"] else "ARXIV:" + item["arxiv"] if item["arxiv"] else ""
        )
        if ident:
            found.append((not paper.favorite, len(found), paper, ident))
    found.sort(key=lambda row: (row[0], row[1]))
    return [(paper, ident) for _, _, paper, ident in found[:SEEDS]]


# ---- upstream -------------------------------------------------------------


def _post(url, params, body):
    """One POST with the same guards as scholar's GETs: pacing, a timeout, a size cap."""
    host = httpx.URL(url).host
    if os.environ.get("SCHOLAR_OFFLINE"):
        raise scholar.ScholarUnavailable("offline")
    scholar._wait_turn(host)
    if not scholar._slots.acquire(timeout=10):
        raise scholar.ScholarUnavailable("busy")
    try:
        with httpx.Client(  # noqa: SIM117
            timeout=scholar.TIMEOUT,
            follow_redirects=False,
            headers={"User-Agent": scholar.USER_AGENT, "Accept": "application/json"},
        ) as client:
            with client.stream("POST", url, params=params, json=body) as response:
                if response.status_code != 200:
                    raise scholar.ScholarUnavailable(f"{host} answered {response.status_code}")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > scholar.MAX_BYTES:
                        raise scholar.ScholarUnavailable("response too large")
        data = json.loads(raw)
    except httpx.HTTPError as error:
        raise scholar.ScholarUnavailable(f"{host} unreachable: {type(error).__name__}") from None
    except ValueError:
        raise scholar.ScholarUnavailable("invalid response") from None
    finally:
        scholar._slots.release()
    if not isinstance(data, dict):
        raise scholar.ScholarUnavailable("invalid response")
    return data


def _shown(item):
    keep = ("title", "authors", "year", "venue", "abstract", "citation_count", "doi", "arxiv", "url")
    value = {k: item.get(k) for k in keep}
    value["abstract"] = (value["abstract"] or "")[:1500]
    return value


def semantic_scholar(ident):
    data = _post(
        S2_RECOMMEND,
        {"fields": S2_FIELDS, "limit": PER_SEED},
        {"positivePaperIds": [ident]},
    )
    rows = data.get("recommendedPapers")
    if not isinstance(rows, list):
        raise scholar.ScholarUnavailable("invalid response")
    return [
        _shown(scholar._from_s2(row))
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("title"), str) and row["title"].strip()
    ]


def openalex(ident):
    if ident.startswith("DOI:"):
        doi = ident[4:]
    else:
        doi = "10.48550/arxiv." + ident[6:]
    work = scholar._json(f"{OPENALEX}/https://doi.org/{quote(doi, safe='/')}")
    related = [
        r.rsplit("/", 1)[-1]
        for r in (work or {}).get("related_works") or []
        if isinstance(r, str) and re.fullmatch(r".*/W\d+", r)
    ][:PER_SEED]
    if not related:
        return []
    found = scholar._json(OPENALEX, {"filter": "openalex:" + "|".join(related), "per-page": PER_SEED})
    rows = (found or {}).get("results")
    return [
        _shown(scholar._from_openalex(row))
        for row in rows or []
        if isinstance(row, dict) and (row.get("title") or row.get("display_name"))
    ]


def gather(seeds):
    """Suggestions for the seeds, each with the library papers it came from.

    Raises ScholarUnavailable when no source answered for any seed.
    """
    started = time.monotonic()
    best = {}
    answered = False
    failure = None
    source = ""
    for ask, name in ((semantic_scholar, "Semantic Scholar"), (openalex, "OpenAlex")):
        for paper, ident in seeds:
            if time.monotonic() - started > DEADLINE:
                break
            try:
                rows = ask(ident)
            except scholar.ScholarUnavailable as error:
                failure = error
                if str(error) == "offline":
                    raise
                continue
            answered = True
            for rank, row in enumerate(rows):
                key = primary_key(row)
                if not key:
                    continue
                entry = best.setdefault(key, {**row, "key": key, "why": [], "score": 0.0})
                if not any(w["paper_id"] == paper.id for w in entry["why"]):
                    entry["why"].append({"paper_id": paper.id, "title": paper.title})
                entry["score"] += 1.0 - rank / (PER_SEED + 1)
        if best:
            source = name
            break  # the fallback is only for when the first source gave nothing
    if not answered:
        raise scholar.ScholarUnavailable(str(failure or "no source"))
    ranked = sorted(best.values(), key=lambda e: (-e["score"], -(e.get("citation_count") or 0)))
    for entry in ranked:
        entry.pop("score", None)
    return ranked[:KEEP], source


# ---- keeping and serving --------------------------------------------------

_owner_locks = defaultdict(threading.Lock)


def serve(d, owner, *, refresh=False, fetch=None):
    """The answer the screen shows, in one of the states: ok, no_seeds, offline, unavailable."""
    papers, records = library(d, owner)
    seeds = seeds_of(papers, records)
    if not seeds:
        return {"state": "no_seeds", "items": []}

    row = d.get(RecommendationCache, owner)
    age = time.time() - float(row.stamp) if row else None
    if refresh and age is not None and age < REFRESH_GAP:
        raise HTTPException(429, "刚刚更新过，请稍等一分钟再试")
    problem = ""
    with _owner_locks[owner]:
        d.expire_all()
        row = d.get(RecommendationCache, owner)
        age = time.time() - float(row.stamp) if row else None
        if row is None or age >= DAY or refresh:
            if os.environ.get("SCHOLAR_OFFLINE"):
                problem = "offline"
            else:
                try:
                    items, source = (fetch or gather)(seeds)
                except scholar.ScholarUnavailable as error:
                    problem = "offline" if str(error) == "offline" else "unavailable"
                else:
                    data = {"items": items, "source": source, "seeds": [p.id for p, _ in seeds]}
                    if row is None:
                        row = RecommendationCache(owner=owner)
                        d.add(row)
                    row.data, row.fetched_at, row.stamp = data, now(), str(time.time())
                    d.commit()
                    problem = ""
    if row is None or (problem and not row.data):
        return {"state": problem or "unavailable", "items": []}

    known = set()
    for paper in papers:
        known.update(keys_of(paper_item(paper, records.get(paper.id))))
    dismissed = set(
        d.scalars(
            select(RecommendationDismissal.key).where(RecommendationDismissal.owner == owner)
        )
    )
    titles = {p.id: p.title for p in papers}
    items = []
    for entry in row.data.get("items", []):
        if entry["key"] in dismissed or known.intersection(keys_of(entry)):
            continue
        why = [{"paper_id": w["paper_id"], "title": titles[w["paper_id"]]} for w in entry["why"] if w["paper_id"] in titles]
        items.append({**entry, "why": why})
    return {
        "state": "ok",
        "items": items,
        "source": row.data.get("source", ""),
        "fetched_at": row.fetched_at,
        # What could not be renewed says so, while the older list still serves.
        "stale": problem or None,
        "seeds": len(row.data.get("seeds", [])),
    }


def install_recommendation_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/discover/recommendations")
    def recommendations(
        refresh: bool = Query(False),
        limit: int = Query(30, ge=1, le=60),
        a=Depends(auth),
        d=Depends(db),
    ):
        fetch = getattr(app.state, "recommendation_fetcher", None)
        answer = serve(d, a["id"], refresh=refresh, fetch=fetch)
        return {**answer, "items": answer["items"][:limit]}

    @app.post("/api/v1/discover/dismissed")
    def dismiss(body: dict = Body(...), a=Depends(auth), d=Depends(db)):
        key = str(body.get("key") or "").strip()
        if not re.fullmatch(r"(doi|arxiv|title):.{1,290}", key):
            raise HTTPException(422, "推荐标识无效")
        if not d.get(RecommendationDismissal, (a["id"], key)):
            d.add(
                RecommendationDismissal(
                    owner=a["id"], key=key, title=str(body.get("title") or "")[:500]
                )
            )
            d.commit()
        return {"ok": True}

    @app.delete("/api/v1/discover/dismissed")
    def restore(key: str = Query(max_length=300), a=Depends(auth), d=Depends(db)):
        row = d.get(RecommendationDismissal, (a["id"], key))
        if row:
            d.delete(row)
            d.commit()
        return {"ok": True}
