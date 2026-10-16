"""User-owned research profile and on-demand external paper discovery."""

import re
import threading
import time
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from .models import DiscoveryCandidate, Paper, ResearchProfile, now, public


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(default="", max_length=12000)
    interests: list[str] = Field(default_factory=list, max_length=12)
    excluded: list[str] = Field(default_factory=list, max_length=12)
    tracking: bool = True

    @field_validator("interests", "excluded")
    @classmethod
    def terms(cls, terms):
        if any(not t.strip() or len(t) > 80 for t in terms):
            raise ValueError("关键词长度须为 1–80")
        return list(dict.fromkeys(t.strip() for t in terms))


class DiscoveryAction(BaseModel):
    action: Literal["dismiss", "not_interested", "reset", "import"]


def arxiv_id(value):
    match = re.search(
        r"(?:arxiv:|arxiv.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5})(?:v\d+)?", value, re.I
    )
    return match.group(1) if match else value.strip().lower()


def title_key(value):
    return re.sub(r"\W", "", value).casefold()


_fetch_lock = threading.Lock()
_last_fetch = 0.0


def fetch_arxiv(terms):
    global _last_fetch
    # Only keywords leave the workspace; never send the profile body or reading notes.
    safe = [re.sub(r"[^\w\s-]", " ", term).strip() for term in terms[:4]]
    query = " OR ".join('(ti:"' + t + '" OR abs:"' + t + '")' for t in safe if t)
    if not query:
        return []
    with _fetch_lock:
        time.sleep(max(0, 3 - (time.monotonic() - _last_fetch)))
        try:
            r = httpx.get(
                "https://export.arxiv.org/api/query",
                params={
                    "search_query": query,
                    "max_results": 40,
                    "sortBy": "relevance",
                },
                timeout=20,
                headers={"User-Agent": "PaperWorkspace/1.0"},
            )
            r.raise_for_status()
            if len(r.content) > 2_000_000:
                raise ValueError("Feed too large")
            root = ET.fromstring(r.content)
        finally:
            _last_fetch = time.monotonic()
    ns = {"a": "http://www.w3.org/2005/Atom"}
    rows = []
    for entry in root.findall("a:entry", ns):
        identifier = arxiv_id(entry.findtext("a:id", "", ns))
        if not re.fullmatch(r"\d{4}\.\d{4,5}", identifier):
            continue
        rows.append(
            {
                "external_id": "arxiv:" + identifier,
                "title": " ".join(entry.findtext("a:title", "", ns).split()),
                "abstract": " ".join(entry.findtext("a:summary", "", ns).split()),
                "authors": "; ".join(
                    a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)
                ),
                "published": entry.findtext("a:published", "", ns)[:10],
                "url": "https://arxiv.org/abs/" + identifier,
            }
        )
    return rows


def install_discovery_routes(
    app, db, auth, human, owned, snapshot, idem, save, check_revision
):
    def profile(d, a):
        obj = d.scalar(select(ResearchProfile).where(ResearchProfile.owner == a["id"]))
        if obj is None:
            obj = ResearchProfile(
                owner=a["id"], body="", interests=[], excluded=[], tracking=True
            )
            d.add(obj)
            d.flush()
        return obj

    def context(d, a, p):
        papers = list(d.scalars(select(Paper).where(Paper.owner == a["id"])))
        candidates = list(
            d.scalars(
                select(DiscoveryCandidate).where(DiscoveryCandidate.owner == a["id"])
            )
        )
        scores = Counter()
        signals = []
        if p.tracking:
            for paper in papers:
                if paper.archived:
                    continue
                reason = (
                    "收藏"
                    if paper.favorite
                    else "阅读"
                    if paper.reading_status in {"reading", "read"}
                    else "入库线索（待确认）"
                )
                weight = 3 if paper.favorite else 2 if reason == "阅读" else 1
                scores.update({t: weight for t in paper.tags})
                if paper.tags:
                    signals.append(
                        {
                            "title": paper.title,
                            "reason": reason,
                            "tags": paper.tags,
                            "updated_at": paper.updated_at,
                        }
                    )
        negatives = Counter()
        for candidate in candidates:
            if candidate.action == "not_interested" and p.tracking:
                negatives.update(
                    candidate.data.get(
                        "feedback_terms", candidate.data.get("matched", [])
                    )
                )
        inferred = [t for t, _ in scores.most_common() if t not in p.excluded]
        terms = list(dict.fromkeys(p.interests + inferred))[:4]
        return papers, candidates, signals, terms, negatives

    def profile_result(d, a, p):
        _, candidates, signals, terms, _ = context(d, a, p)
        feedback = [
            {
                "id": c.id,
                "title": c.data.get("title", ""),
                "action": c.action,
                "updated_at": c.updated_at,
            }
            for c in candidates
            if c.action in {"dismiss", "not_interested"}
        ]
        lines = [
            "# 研究偏好",
            "",
            "## 用户描述（本人维护）",
            p.body or "尚未填写",
            "",
            "## 明确关注",
            ", ".join(p.interests) or "尚未填写",
            "",
            "## 明确排除",
            ", ".join(p.excluded) or "无",
            "",
            "## 行为线索（系统观察，非本人确认）",
        ]
        lines += [
            f"- {s['reason']}：{s['title']}；标签：{', '.join(s['tags'])}；{s['updated_at']}"
            for s in signals
        ]
        lines += ["", "## 推荐反馈"] + [
            f"- {f['action']}：{f['title']}；{f['updated_at']}" for f in feedback
        ]
        return {
            **public(p),
            "signals": signals,
            "terms": terms,
            "feedback": feedback,
            "document": "\n".join(lines),
        }

    @app.get("/api/v1/research-profile")
    def get_profile(a=Depends(auth), d=Depends(db)):
        p = profile(d, a)
        result = profile_result(d, a, p)
        d.commit()
        return result

    @app.put("/api/v1/research-profile")
    def update_profile(
        body: ProfileInput, request: Request, a=Depends(auth), d=Depends(db)
    ):
        p = profile(d, a)
        if a["agent"] and (body.body != p.body or body.tracking != p.tracking):
            raise HTTPException(
                403, "Agent 可维护方向关键词，不可覆盖用户描述或追踪开关"
            )
        key, fp, old = idem(d, a, request, body.model_dump())
        if old is not None:
            return old
        check_revision(request, p)
        for k, v in body.model_dump().items():
            setattr(p, k, v)
        p.revision += 1
        p.updated_at = now()
        snapshot(d, p, a)
        return save(d, a, key, fp, profile_result(d, a, p))

    def results(d, a):
        p = profile(d, a)
        papers, candidates, _, terms, negatives = context(d, a, p)
        imported_ids = {arxiv_id(x.external_id) for x in papers}
        titles = {title_key(x.title) for x in papers}
        rows = []
        for candidate in candidates:
            data = candidate.data
            text = (data["title"] + " " + data["abstract"]).casefold()
            matched = [t for t in terms if t.casefold() in text]
            if (
                candidate.action
                or arxiv_id(candidate.external_id) in imported_ids
                or title_key(data["title"]) in titles
                or any(t.casefold() in text for t in p.excluded)
                or not matched
            ):
                continue
            score = sum(
                (3 if t in p.interests else 1) - min(2, negatives[t]) for t in matched
            )
            rows.append(
                {
                    "id": candidate.id,
                    **data,
                    "matched": matched,
                    "score": score,
                    "reasons": [
                        ("明确关注：" if t in p.interests else "文库线索：") + t
                        for t in matched
                    ],
                }
            )
        return {
            "items": sorted(
                rows, key=lambda r: (r["score"], r.get("published", "")), reverse=True
            )[:20],
            "terms": terms,
            "profile_revision": p.revision,
        }

    @app.get("/api/v1/discovery")
    def get_discovery(a=Depends(auth), d=Depends(db)):
        result = results(d, a)
        d.commit()
        return result

    @app.post("/api/v1/discovery/refresh")
    def refresh(request: Request, a=Depends(auth), d=Depends(db)):
        human(a)
        p = profile(d, a)
        _, existing, _, terms, _ = context(d, a, p)
        if not terms:
            raise HTTPException(422, "先填写关注关键词，或导入带标签的论文。")
        key, fp, old = idem(d, a, request, {})
        if old is not None:
            return old
        try:
            rows = getattr(app.state, "discovery_fetcher", fetch_arxiv)(terms)
        except (httpx.HTTPError, ET.ParseError, ValueError):
            raise HTTPException(502, "arXiv 暂时不可用，已保留上次结果，请稍后重试。")
        by_id = {c.external_id: c for c in existing}
        for row in rows:
            text = (row["title"] + " " + row["abstract"]).casefold()
            row = {
                **row,
                "matched": [t for t in terms if t.casefold() in text],
                "fetched_at": now(),
            }
            c = by_id.get(row["external_id"])
            if c:
                c.data = {
                    **row,
                    **(
                        {"feedback_terms": c.data["feedback_terms"]}
                        if "feedback_terms" in c.data
                        else {}
                    ),
                }
            else:
                c = DiscoveryCandidate(
                    owner=a["id"], external_id=row["external_id"], data=row
                )
                d.add(c)
                by_id[row["external_id"]] = c
        d.flush()
        return save(d, a, key, fp, results(d, a))

    @app.post("/api/v1/discovery/{id}/feedback")
    def feedback(
        id: str, body: DiscoveryAction, request: Request, a=Depends(auth), d=Depends(db)
    ):
        human(a)
        c = owned(d, DiscoveryCandidate, id, a)
        key, fp, old = idem(d, a, request, body.model_dump())
        if old is not None:
            return old
        from .import_progress import tracking

        token = (
            request.headers.get("X-Import-ID", "") if body.action == "import" else ""
        )
        with tracking(app.state.settings, a["id"], token):
            result = {"ok": True}
            imported_file = None
            if body.action == "import":
                papers = list(d.scalars(select(Paper).where(Paper.owner == a["id"])))
                p = next(
                    (
                        p
                        for p in papers
                        if arxiv_id(p.external_id) == arxiv_id(c.external_id)
                        or title_key(p.title) == title_key(c.data["title"])
                    ),
                    None,
                )
                from .translations import import_arxiv_paper

                p, imported_file = import_arxiv_paper(
                    d,
                    app.state.settings,
                    a,
                    c.data["url"],
                    snapshot,
                    existing=p,
                    tags=c.data.get("matched", []),
                )
                result["paper_id"] = p.id
            if body.action == "not_interested":
                c.data = {**c.data, "feedback_terms": c.data.get("matched", [])}
            c.action = "" if body.action == "reset" else body.action
            c.updated_at = now()
            try:
                return save(d, a, key, fp, result)
            except Exception:
                if imported_file is not None:
                    (Path(app.state.settings.storage) / imported_file.id).unlink(
                        missing_ok=True
                    )
                raise
