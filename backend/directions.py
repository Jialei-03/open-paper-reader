"""Rename and merge research labels without deleting their linked content."""

import hashlib
import json
from collections import Counter
from fastapi import Depends, Request, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from .models import Paper, Item, ResearchProfile, DiscoveryCandidate, now


class DirectionEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: list[str] = Field(default_factory=list, max_length=100)
    target: str = Field(min_length=1, max_length=80)


def install_direction_routes(app, db, auth, snapshot, idem, save):
    def state(d, a):
        models = (Paper, Item, ResearchProfile, DiscoveryCandidate)
        rows = {m: list(d.scalars(select(m).where(m.owner == a["id"]))) for m in models}
        counts = Counter(t for p in rows[Paper] for t in p.tags)
        labels = (
            set(counts)
            | {t for i in rows[Item] for t in i.tags}
            | {t for p in rows[ResearchProfile] for t in p.interests}
        )
        stamp = [
            (m.__name__, x.id, getattr(x, "revision", x.updated_at))
            for m in models
            for x in rows[m]
        ]
        revision = hashlib.sha256(json.dumps(sorted(stamp)).encode()).hexdigest()
        return rows, {
            "revision": revision,
            "items": [{"name": t, "papers": counts[t]} for t in sorted(labels)],
        }

    @app.get("/api/v1/research-directions")
    def get_directions(a=Depends(auth), d=Depends(db)):
        return state(d, a)[1]

    @app.post("/api/v1/research-directions")
    def edit(body: DirectionEdit, request: Request, a=Depends(auth), d=Depends(db)):
        key, fp, old = idem(d, a, request, body.model_dump())
        if old is not None:
            return old
        rows, current = state(d, a)
        if request.headers.get("if-match", "").strip('"') != current["revision"]:
            raise HTTPException(409, "研究方向已变化，请刷新后重试")
        target = body.target.strip()
        if not target:
            raise HTTPException(422, "研究方向不能为空")
        sources = set(body.sources)
        if not sources <= {x["name"] for x in current["items"]}:
            raise HTTPException(422, "源方向不存在")

        def replace(values):
            return list(dict.fromkeys(target if t in sources else t for t in values))

        for model in (Paper, Item, ResearchProfile):
            for obj in rows[model]:
                changed = False
                for field in (
                    ("interests", "excluded") if model == ResearchProfile else ("tags",)
                ):
                    values = replace(getattr(obj, field))
                    if values != getattr(obj, field):
                        setattr(obj, field, values)
                        changed = True
                if changed:
                    obj.revision += 1
                    obj.updated_at = now()
                    snapshot(d, obj, a)
        for obj in rows[DiscoveryCandidate]:
            data = dict(obj.data)
            for field in ("matched", "feedback_terms"):
                if field in data:
                    data[field] = replace(data[field])
            if data != obj.data:
                obj.data = data
                obj.updated_at = now()
        if not sources:
            p = next(iter(rows[ResearchProfile]), None)
            if p is None:
                p = ResearchProfile(
                    owner=a["id"], body="", interests=[], excluded=[], tracking=True
                )
                d.add(p)
                d.flush()
            if target not in p.interests:
                if len(p.interests) >= 12:
                    raise HTTPException(
                        422, "最多保留 12 个明确关注方向，请先合并已有方向"
                    )
                p.interests = [*p.interests, target]
                p.revision += 1
                p.updated_at = now()
                snapshot(d, p, a)
        d.flush()
        return save(d, a, key, fp, state(d, a)[1])
