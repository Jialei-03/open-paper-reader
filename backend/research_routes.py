# ruff: noqa: B008
"""The research projects API: create, read, and pause, resume or stop a project."""

from pathlib import Path

from fastapi import Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from . import research_map
from .models import (
    AgentRun,
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    User,
    now,
)
from .translation_settings import read_config

LOCAL_ONLY = "研究功能目前只在本机版提供"
UPLOAD_BYTES = 200 * 1024 * 1024


class Budget(BaseModel):
    max_sprints: int | None = Field(default=None, ge=1, le=500)
    max_tokens: int | None = Field(default=None, ge=1000, le=10**9)
    max_job_seconds: int | None = Field(default=None, ge=60, le=10**7)
    # Evaluation runs: nobody is there to decide, and some must not learn or be taught.
    auto_decide: bool | None = None
    playbook: bool | None = None
    distill: bool | None = None


class DecisionInput(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=2000)


class ProjectInput(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    background: str = Field(default="", max_length=20000)
    model_config_id: str = Field(min_length=1, max_length=64)
    budget: Budget | None = None

    @field_validator("question")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("研究问题不能为空")
        return value.strip()


def project_out(p):
    return {
        "id": p.id,
        "question": p.question,
        "background": p.background,
        "model_config_id": p.model_config_id,
        "status": p.status,
        "end_reason": p.end_reason,
        "budget": p.budget,
        "spent": p.spent,
        "session_id": p.session_id,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def node_out(n):
    return {
        k: getattr(n, k)
        for k in (
            "id",
            "parent_id",
            "kind",
            "title",
            "status",
            "confidence",
            "kill_if",
            "budget_tokens",
            "evidence_for",
            "evidence_against",
            "doubts",
            "spent_tokens",
            "spent_job_seconds",
            "created_at",
            "updated_at",
        )
    }


def sprint_out(s):
    return {
        k: getattr(s, k)
        for k in (
            "id",
            "number",
            "role",
            "run_id",
            "status",
            "focus_node_id",
            "summary",
            "next_focus",
            "waiting_on",
            "tokens",
            "created_at",
            "updated_at",
        )
    }


def job_out(j):
    return {
        k: getattr(j, k)
        for k in (
            "id",
            "node_id",
            "sprint_id",
            "command",
            "status",
            "exit_code",
            "timeout_seconds",
            "started_at",
            "finished_at",
            "log_lines",
        )
    }


def event_out(e):
    return {
        k: getattr(e, k)
        for k in (
            "id",
            "node_id",
            "sprint_id",
            "actor",
            "action",
            "detail",
            "created_at",
        )
    }


def docker_state():
    """Whether experiments can run here; replaced by the sandbox's own check."""
    try:
        from .research_sandbox import docker_status
    except ImportError:
        return {"available": False, "reason": "未检测"}
    return docker_status()


def install_research_routes(app, settings, db, auth, human, owned):
    def allowed(a, d):
        """Research runs code and spends model budget: local edition, or admins."""
        human(a)
        if settings.mode == "local":
            return
        user = d.get(User, a["id"])
        if not user or not user.admin:
            raise HTTPException(403, LOCAL_ONLY)

    def project_of(d, id, a):
        allowed(a, d)
        return owned(d, ResearchProject, id, a)

    @app.post("/api/v1/research/projects")
    def create(body: ProjectInput, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        cfg = read_config(settings, a["id"], body.model_config_id)
        if not cfg.get("api_key") or not cfg.get("model"):
            raise HTTPException(409, "请先添加并选择可用模型")
        budget = (
            {k: v for k, v in body.budget.model_dump().items() if v is not None}
            if body.budget
            else None
        )
        p = research_map.create_project(
            d, a["id"], body.question, body.background, body.model_config_id, budget
        )
        d.commit()
        return project_out(p)

    @app.get("/api/v1/research/projects")
    def projects(a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        return [
            project_out(p)
            for p in d.scalars(
                select(ResearchProject)
                .where(ResearchProject.owner == a["id"])
                .order_by(ResearchProject.updated_at.desc())
            )
        ]

    @app.get("/api/v1/research/projects/{id}")
    def project(id: str, a=Depends(auth), d=Depends(db)):
        p = project_of(d, id, a)
        sprints = d.scalars(
            select(ResearchSprint)
            .where(ResearchSprint.project_id == p.id)
            .order_by(ResearchSprint.number.desc())
            .limit(50)
        )
        jobs = d.scalars(
            select(ResearchJob)
            .where(ResearchJob.project_id == p.id)
            .order_by(ResearchJob.started_at.desc())
            .limit(50)
        )
        return {
            "project": project_out(p),
            "nodes": [node_out(n) for n in research_map.nodes(d, p)],
            "sprints": [sprint_out(s) for s in sprints],
            "jobs": [job_out(j) for j in jobs],
            "docker": docker_state(),
        }

    @app.get("/api/v1/research/projects/{id}/metrics")
    def project_metrics(id: str, a=Depends(auth), d=Depends(db)):
        from .research_metrics import metrics

        return metrics(d, project_of(d, id, a))

    @app.get("/api/v1/research/projects/{id}/events")
    def events(id: str, after: str = "", a=Depends(auth), d=Depends(db)):
        p = project_of(d, id, a)
        query = select(ResearchEvent).where(ResearchEvent.project_id == p.id)
        if after:
            query = query.where(ResearchEvent.created_at > after)
        return [
            event_out(e)
            for e in d.scalars(
                query.order_by(ResearchEvent.created_at, ResearchEvent.id).limit(200)
            )
        ]

    @app.get("/api/v1/research/projects/{id}/jobs/{job_id}/log")
    def job_log(
        id: str,
        job_id: str,
        offset: int = 0,
        limit: int = 500,
        a=Depends(auth),
        d=Depends(db),
    ):
        p = project_of(d, id, a)
        job = d.get(ResearchJob, job_id)
        if not job or job.project_id != p.id:
            raise HTTPException(404, "Not found")
        from .research_sandbox import read_log

        try:
            return read_log(settings, job, max(0, offset), min(max(limit, 1), 500))
        except ValueError as e:
            raise HTTPException(409, str(e)) from None

    def decisions_of(d, p):
        rows = list(
            d.scalars(
                select(ResearchEvent)
                .where(
                    ResearchEvent.project_id == p.id,
                    ResearchEvent.action.in_(["decision_requested", "human_decision"]),
                )
                .order_by(ResearchEvent.created_at)
            )
        )
        answered = {
            r.detail.get("request_id") for r in rows if r.action == "human_decision"
        }
        return [
            {**event_out(r), "open": r.id not in answered}
            for r in rows
            if r.action == "decision_requested"
        ]

    @app.get("/api/v1/research/projects/{id}/decisions")
    def decisions(id: str, a=Depends(auth), d=Depends(db)):
        return decisions_of(d, project_of(d, id, a))

    @app.post("/api/v1/research/projects/{id}/decisions/{event_id}")
    def decide(
        id: str, event_id: str, body: DecisionInput, a=Depends(auth), d=Depends(db)
    ):
        from .research_advice import act

        project_of(d, id, a)
        # One answer at a time: a second click waits, then finds it answered.
        p = d.scalars(
            select(ResearchProject).where(ResearchProject.id == id).with_for_update()
        ).one()
        request = d.get(ResearchEvent, event_id)
        if (
            request is None
            or request.project_id != p.id
            or request.action != "decision_requested"
        ):
            raise HTTPException(404, "Not found")
        if not next(x for x in decisions_of(d, p) if x["id"] == event_id)["open"]:
            raise HTTPException(409, "这件事已经决定过了")
        applied = False
        if body.approve:
            node = d.get(ResearchNode, request.detail.get("node_id"))
            sprint = d.get(ResearchSprint, request.sprint_id)
            if (
                node is not None
                and sprint is not None
                and research_map.is_live(d, node)
            ):
                applied = act(
                    d,
                    p,
                    sprint,
                    node,
                    request.detail.get("proposal", "continue"),
                    {**request.detail, "reason": "研究者同意：" + body.note},
                )
        research_map.event(
            d,
            p,
            None,
            "human",
            "human_decision",
            {
                "request_id": request.id,
                "approve": body.approve,
                "note": body.note,
                "applied": applied,
            },
            request.sprint_id,
        )
        if p.status == "waiting" and not any(
            x["open"] for x in decisions_of(d, p) if x["id"] != event_id
        ):
            p.status = "active"
        p.updated_at = now()
        d.commit()
        return project_out(p)

    @app.get("/api/v1/research/projects/{id}/files")
    def workspace_files(id: str, a=Depends(auth), d=Depends(db)):
        """What the researcher put in the project's data folder."""
        from .research_sandbox import workdir

        p = project_of(d, id, a)
        root = workdir(settings, p.id)
        folder = root / "data"
        if not folder.is_dir():
            return []
        return [
            {"path": str(f.relative_to(root)), "size": f.stat().st_size}
            for f in sorted(folder.rglob("*"))
            if f.is_file() and not f.is_symlink()
        ]

    @app.post("/api/v1/research/projects/{id}/files")
    async def upload_file(id: str, file: UploadFile, a=Depends(auth), d=Depends(db)):
        """A data file for the experiments, kept at /work/data/<name>."""
        from .research_sandbox import WORKSPACE_BYTES, _size, workdir

        p = project_of(d, id, a)
        name = Path(file.filename or "").name.strip()
        if not name or name.startswith(".") or len(name) > 200:
            raise HTTPException(422, "文件名不合法")
        data = await file.read(UPLOAD_BYTES + 1)
        if len(data) > UPLOAD_BYTES:
            raise HTTPException(413, "单个文件最多 200 MB")
        root = workdir(settings, p.id)
        if _size(root) + len(data) > WORKSPACE_BYTES:
            raise HTTPException(413, "工作区空间不够")
        folder = root / "data"
        folder.mkdir(exist_ok=True)
        (folder / name).write_bytes(data)
        research_map.event(
            d,
            p,
            None,
            "human",
            "file_added",
            {"path": f"data/{name}", "size": len(data)},
        )
        d.commit()
        return {"path": f"data/{name}", "size": len(data)}

    @app.get("/api/v1/research/playbook")
    def playbook(a=Depends(auth), d=Depends(db)):
        from . import research_playbook

        allowed(a, d)
        book = research_playbook.load(settings)
        return {
            "version": book["version"],
            "rules": book["rules"],
            "history": book["history"][-50:],
        }

    @app.post("/api/v1/research/playbook/rules/{rule_id}")
    def review_rule(rule_id: str, body: DecisionInput, a=Depends(auth), d=Depends(db)):
        """A person admits a pending rule (it takes effect) or retires one."""
        from . import research_playbook

        allowed(a, d)
        book = research_playbook.load(settings)
        rule = next((r for r in book["rules"] if r["id"] == rule_id), None)
        if rule is None:
            raise HTTPException(404, "Not found")
        rule["status"] = "active" if body.approve else "retired"
        book["version"] += 1
        book["history"].append(
            {
                "version": book["version"],
                "project": None,
                "actor": "human",
                "at": now(),
                "rule": rule_id,
                "approve": body.approve,
                "note": body.note,
            }
        )
        research_playbook.save(settings, book)
        return rule

    def move(p, status, d, end_reason=None):
        p.status = status
        if end_reason is not None:
            p.end_reason = end_reason
        p.updated_at = now()
        research_map.event(
            d, p, None, "human", status, {"end_reason": end_reason or ""}
        )
        d.commit()
        return project_out(p)

    WAITING = "有待你拍板的事，先在研究页面上回答"

    @app.post("/api/v1/research/projects/{id}/pause")
    def pause(id: str, a=Depends(auth), d=Depends(db)):
        p = project_of(d, id, a)
        if p.status == "finished":
            raise HTTPException(409, "研究已结束")
        if p.status == "waiting":
            raise HTTPException(409, WAITING)
        return move(p, "paused", d)

    @app.post("/api/v1/research/projects/{id}/resume")
    def resume(id: str, a=Depends(auth), d=Depends(db)):
        p = project_of(d, id, a)
        if p.status == "finished":
            raise HTTPException(409, "研究已结束，不能继续")
        if p.status == "waiting":
            raise HTTPException(409, WAITING)
        return move(p, "active", d)

    @app.post("/api/v1/research/projects/{id}/stop")
    def stop(id: str, a=Depends(auth), d=Depends(db)):
        p = project_of(d, id, a)
        running = [
            s.run_id
            for s in d.scalars(
                select(ResearchSprint).where(
                    ResearchSprint.project_id == p.id,
                    ResearchSprint.status == "running",
                )
            )
        ]
        if running:
            d.execute(
                update(AgentRun)
                .where(
                    AgentRun.id.in_(running),
                    AgentRun.status.in_(["queued", "running"]),
                )
                .values(status="cancelled", updated_at=now())
            )
        from .research_sandbox import stop_jobs

        stop_jobs(settings, d, p.id)
        return move(p, "finished", d, "stopped")
