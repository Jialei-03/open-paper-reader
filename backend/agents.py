# ruff: noqa: B008
"""Human-facing agent control plane. Model credentials never enter these responses."""

from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from . import agent_limits, direct_runs
from .agent_attachments import attachments, install_attachment_routes
from .agent_response import clean_response
from .agent_state import presentation
from .model_options import task_of, task_options
from .models import (
    AgentQuota,
    AgentRun,
    AgentSession,
    File,
    Paper,
    ReadingArtifact,
    User,
    now,
    public,
)
from .reader_context import ReaderContextInput, freeze_context, restore_input
from .schemas import Strict
from .translation_settings import read_config


class SessionInput(Strict):
    title: str = Field(default="新会话", min_length=1, max_length=100)


class CreateSessionInput(SessionInput):
    paper_id: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")


class RunInput(Strict):
    prompt: str = Field(min_length=1, max_length=12000)
    model_config_id: str = Field(min_length=1, max_length=36)
    context: str = Field(default="", max_length=200)
    reader_context: ReaderContextInput | None = None
    writable: bool = True
    resume_run_id: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")
    attachment_ids: list[str] = Field(default_factory=list, max_length=5)


def paper_session_id(owner, paper_id):
    return str(uuid5(NAMESPACE_URL, f"paper-discussion:{owner}:{paper_id}"))


def install_agent_routes(app, settings, db, auth, human, owned):
    install_attachment_routes(app, settings, db, auth, human, owned)

    def output(r, d):
        return {
            **public(r),
            "response": clean_response(r.response),
            "runtime": presentation(r),
            "attachments": attachments(d, r.owner, r.attachment_ids),
        }

    @app.get("/api/v1/agent/files/{id}/image")
    def image(
        id: str,
        page: int = Query(1, ge=1, le=3000),
        asset: str = Query("", max_length=500),
        rect: str | None = Query(None, max_length=150),
        a=Depends(auth),
    ):
        human(a)
        from .agent_images import image_bytes, inspect, owned_file

        try:
            f = owned_file(app, a["id"], id)
            value = inspect(settings, f.id, page=page, asset=asset, rect=rect)
        except ValueError as e:
            raise HTTPException(
                404 if str(e).startswith("404:") else 422, str(e)
            ) from None
        return Response(
            image_bytes(value),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/v1/agent/capabilities")
    def capabilities(a=Depends(auth)):
        human(a)
        from .agent_tools import TOOLS

        return {
            "tools": [
                {k: t[k] for k in ("name", "label", "description", "write")}
                for t in TOOLS
            ],
            "limits": agent_limits.describe(),
            "run": {
                "model_turns": agent_limits.MODEL_TURNS,
                "tool_calls": agent_limits.TOOL_CALLS,
                "seconds": agent_limits.EXECUTION_SECONDS,
            },
        }

    def conversational_sessions(owner):
        # Business-generated guides/quizzes must not become user chat clutter.
        # Keep historical/deleted-artifact runs hidden too, without a schema flag.
        artifact_sessions = select(ReadingArtifact.session_id).where(
            ReadingArtifact.owner == owner
        )
        generated_sessions = select(AgentRun.session_id).where(
            AgentRun.owner == owner,
            AgentRun.runtime["reading_artifact_id"].as_string().is_not(None),
        )
        return (
            AgentSession.owner == owner,
            AgentSession.id.not_in(artifact_sessions),
            AgentSession.id.not_in(generated_sessions),
        )

    def paper_session_ids(d, owner):
        # Derive membership from owned papers, never a client-supplied route.
        return {
            paper_session_id(owner, paper_id)
            for paper_id in d.scalars(select(Paper.id).where(Paper.owner == owner))
        }

    @app.get("/api/v1/agent/sessions")
    def sessions(paper_id: str | None = None, a=Depends(auth), d=Depends(db)):
        human(a)
        if paper_id:
            owned(d, Paper, paper_id, a)
        return [
            public(s)
            for s in d.scalars(
                select(AgentSession)
                .where(*conversational_sessions(a["id"]))
                .where(
                    (AgentSession.paper_id == paper_id)
                    | (AgentSession.id == paper_session_id(a["id"], paper_id))
                    if paper_id
                    else True
                )
                .order_by(AgentSession.updated_at.desc())
                .limit(100)
            )
        ]

    @app.post("/api/v1/papers/{paper_id}/discussion")
    def paper_discussion(paper_id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        paper = owned(d, Paper, paper_id, a)
        # Resolve directly, independent of the capped recent-session list. The
        # deterministic primary key also arbitrates concurrent first opens.
        session_id = paper_session_id(a["id"], paper.id)
        session = d.get(AgentSession, session_id)
        if not session:
            session = AgentSession(
                id=session_id, owner=a["id"], title=paper.title[:100], paper_id=paper.id
            )
            d.add(session)
            try:
                d.commit()
            except IntegrityError:
                d.rollback()
                session = d.get(AgentSession, session_id)
                if not session:
                    raise
        if session.owner != a["id"]:
            raise HTTPException(404, "Not found")
        return public(session)

    @app.post("/api/v1/agent/sessions")
    def create(body: CreateSessionInput, a=Depends(auth), d=Depends(db)):
        human(a)
        d.scalar(select(User).where(User.id == a["id"]).with_for_update())
        generic_ids = set(
            d.scalars(select(AgentSession.id).where(*conversational_sessions(a["id"])))
        ) - paper_session_ids(d, a["id"])
        if len(generic_ids) >= 100:
            raise HTTPException(409, "最多保留 100 个会话，请删除不需要的会话")
        if body.paper_id:
            owned(d, Paper, body.paper_id, a)
        s = AgentSession(owner=a["id"], title=body.title, paper_id=body.paper_id)
        d.add(s)
        d.commit()
        return public(s)

    @app.patch("/api/v1/agent/sessions/{id}")
    def rename(id: str, body: SessionInput, a=Depends(auth), d=Depends(db)):
        human(a)
        s = owned(d, AgentSession, id, a)
        s.title = body.title
        s.updated_at = now()
        d.commit()
        return public(s)

    @app.delete("/api/v1/agent/sessions/{id}")
    def remove(id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        d.scalar(select(User).where(User.id == a["id"]).with_for_update())
        s = owned(d, AgentSession, id, a)
        if d.scalar(
            select(AgentRun).where(
                AgentRun.session_id == id, AgentRun.status.in_(["queued", "running"])
            )
        ):
            raise HTTPException(409, "请先停止正在运行的任务")
        d.execute(delete(AgentRun).where(AgentRun.session_id == id))
        d.delete(s)
        d.commit()
        return {"ok": True}

    @app.get("/api/v1/agent/sessions/{id}/runs")
    def runs(id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        owned(d, AgentSession, id, a)
        return [
            output(r, d)
            for r in d.scalars(
                select(AgentRun)
                .where(AgentRun.session_id == id)
                .order_by(AgentRun.created_at)
            )
        ]

    @app.post("/api/v1/agent/sessions/{id}/runs")
    def enqueue(id: str, body: RunInput, a=Depends(auth), d=Depends(db)):
        return create_run(id, body, a, d)

    def create_run(id, body, a, d, reading_artifact=None):
        human(a)
        d.scalar(select(User).where(User.id == a["id"]).with_for_update())
        s = owned(d, AgentSession, id, a)
        source = None
        if body.resume_run_id:
            source = owned(d, AgentRun, body.resume_run_id, a)
            if source.session_id != id or source.status not in {"failed", "cancelled"}:
                raise HTTPException(409, "只能继续当前会话中未完成的任务")
            if (
                source.status == "cancelled"
                and source.runtime.get("since")
                and not source.runtime.get("settled")
            ):
                raise HTTPException(409, "正在停止上一轮工具，请稍后继续")
            child_id = (source.runtime or {}).get("resumed_by")
            if child_id:
                child = owned(d, AgentRun, child_id, a)
                return output(child, d)
            body.prompt = source.prompt
            body.context = source.context
            body.attachment_ids = source.attachment_ids
            body.reader_context = restore_input(
                (source.runtime or {}).get("reader_context")
            )
        reader_context = freeze_context(d, a["id"], body.reader_context)
        if source and reader_context:
            # Recheck access, but keep the exact evidence from the interrupted turn.
            reader_context = source.runtime["reader_context"]
        attachments(d, a["id"], body.attachment_ids)
        cfg = read_config(settings, a["id"], body.model_config_id)
        if not cfg.get("api_key") or not cfg.get("model"):
            raise HTTPException(409, "请先添加并选择可用模型")
        task = task_of(
            artifact=reading_artifact.kind if reading_artifact else None,
            action=(reader_context or {}).get("action"),
        )
        page_translation = bool(
            reading_artifact and reading_artifact.kind == "page_translation"
        )
        # Translating needs no tools, so it skips the agent: one model call over
        # the text (and, for a box, the picture) the server already holds.
        pages = d.get(File, reading_artifact.file_id).pages if reading_artifact else 0
        direct = (
            page_translation
            or bool(
                reading_artifact
                and reading_artifact.kind in direct_runs.WHOLE_PAPER
                and (pages or 0) <= direct_runs.DIRECT_PAGES
            )
        ) or (
            task == "translate"
            and (reader_context or {}).get("source") in {"selection", "page", "region"}
        )
        lane = "translation" if page_translation else ""
        # Limits on a user's tasks are off unless the settings turn them on. Bulk
        # page translation has its own concurrency limit and no daily allowance.
        limit = (
            settings.translation_active_limit if lane else settings.agent_active_limit
        )
        if (
            limit
            and d.scalar(
                select(func.count())
                .select_from(AgentRun)
                .where(
                    AgentRun.owner == a["id"],
                    AgentRun.status.in_(["queued", "running"]),
                    AgentRun.lane == lane,
                )
            )
            >= limit
        ):
            raise HTTPException(
                409,
                f"最多同时翻译 {limit} 页，请稍候"
                if lane
                else "你已有一个 Agent 任务，请等待完成或先停止它"
                if limit == 1
                else f"你已有 {limit} 个 Agent 任务，请等待完成或先停止其中一个",
            )
        quota = None
        if settings.agent_daily_runs and not lane:
            today = datetime.now(timezone.utc).date().isoformat()
            quota = d.get(AgentQuota, a["id"])
            if quota is None:
                quota = AgentQuota(owner=a["id"], day=today, runs=0, imports=0)
                d.add(quota)
            if quota.day != today:
                quota.day, quota.runs, quota.imports = today, 0, 0
            if quota.runs >= settings.agent_daily_runs:
                raise HTTPException(
                    429, f"已达到每日 {settings.agent_daily_runs} 次任务额度"
                )
        if (
            d.scalar(
                select(func.count())
                .select_from(AgentRun)
                .where(AgentRun.status.in_(["queued", "running"]))
            )
            >= settings.agent_queue_limit
        ):
            raise HTTPException(429, "任务队列已满，请稍后重试")
        # Paper discussions are durable; the worker still sends only the latest
        # eight rounds to the model. Execution quotas above apply to every run.
        if (
            d.scalar(
                select(func.count())
                .select_from(AgentRun)
                .where(AgentRun.session_id == id)
            )
            >= 50
            and not s.paper_id
            and id not in paper_session_ids(d, a["id"])
        ):
            raise HTTPException(409, "此会话已有 50 轮，请新建会话")
        if quota:
            quota.runs += 1
        r = AgentRun(
            owner=a["id"],
            session_id=id,
            model=cfg["model"],
            lane=lane,
            **body.model_dump(exclude={"resume_run_id", "reader_context"}),
            runtime={
                **({"resume_from": source.id} if source else {}),
                "model_options": task_options(cfg, task),
                **({"direct": True} if direct else {}),
                **(
                    {"reading_artifact_id": reading_artifact.id}
                    if reading_artifact
                    else {}
                ),
                **({"reader_context": reader_context} if reader_context else {}),
            },
        )
        if s.title == "新会话":
            s.title = body.prompt[:40]
        s.updated_at = now()
        d.add(r)
        d.flush()
        if reading_artifact:
            reading_artifact.run_id = r.id
            reading_artifact.session_id = id
        if source:
            source.runtime = {**(source.runtime or {}), "resumed_by": r.id}
        d.commit()
        return output(r, d)

    app.state.create_agent_run = create_run

    @app.post("/api/v1/agent/runs/{id}/cancel")
    def cancel(id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        r = owned(d, AgentRun, id, a)
        if r.status in {"queued", "running"}:
            r.status = "cancelled"
            r.updated_at = now()
            d.commit()
        return output(r, d)
