# ruff: noqa: B008
"""The research projects API: create, read, and pause, resume or stop a project."""

from pathlib import Path

from fastapi import Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from . import research_datasets, research_map
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
    advisor: bool | None = None


class DecisionInput(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=2000)


class ProjectInput(BaseModel):
    # Either a first message (the plan is then talked through), or a question
    # given outright (evaluation runs, which start experimenting at once).
    message: str = Field(default="", max_length=8000)
    question: str = Field(default="", max_length=2000)
    background: str = Field(default="", max_length=20000)
    model_config_id: str = Field(min_length=1, max_length=64)
    budget: Budget | None = None
    datasets: list[str] = Field(default_factory=list, max_length=5)
    compute_id: str = Field(default="", max_length=64)

    @field_validator("message", "question")
    @classmethod
    def trimmed(cls, value):
        return value.strip()


class MessageInput(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class PrepareInput(BaseModel):
    model_config_id: str = Field(default="", max_length=64)
    needs: str = Field(default="", max_length=2000)
    allow_sudo: bool = False


class ComputeInput(BaseModel):
    compute_id: str = Field(min_length=1, max_length=64)


class PlanApproval(BaseModel):
    version: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)


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
        "stage": p.stage,
        "compute_id": p.compute_id,
        "plan": p.plan or {},
        "conclusion_record": p.conclusion or {},
        "environment": p.environment or {},
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
            "value",
            "cost",
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
            "compute_id",
            "config",
            "metrics",
            "points",
            "tracker_url",
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


def input_needed(d, p):
    """What the advisor said the project waits for, while it waits for it."""
    if p.status != "waiting":
        return ""
    last = d.scalars(
        select(ResearchEvent)
        .where(ResearchEvent.project_id == p.id, ResearchEvent.action == "input_needed")
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    return last.detail.get("summary", "") if last else ""


def conclusion(d, p):
    """How a finished project was answered, in the advisor's words; "" if it was not."""
    if p.status != "finished":
        return ""
    last = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == p.id,
            ResearchEvent.action.in_(("concluded", "input_needed")),
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    return last.detail.get("summary", "") if last else ""


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
        from . import research_datasets, research_settings, research_stages

        allowed(a, d)
        if not body.message and not body.question:
            raise HTTPException(422, "说说你想研究什么")
        cfg = read_config(settings, a["id"], body.model_config_id)
        if not cfg.get("api_key") or not cfg.get("model"):
            raise HTTPException(409, "请先添加并选择可用模型")
        budget = (
            {k: v for k, v in body.budget.model_dump().items() if v is not None}
            if body.budget
            else None
        )
        try:
            compute_id = (
                body.compute_id or research_settings.load(settings)["default_compute"]
            )
            research_settings.compute(settings, compute_id)
            p = research_map.create_project(
                d,
                a["id"],
                body.question or body.message[:2000],
                body.background,
                body.model_config_id,
                budget,
            )
            p.compute_id = compute_id
            research_datasets.request(d, p, body.datasets)
            if body.message:
                # The plan is talked through first; nothing runs until it is approved.
                p.stage = "scoping"
                research_stages.say(d, p, "human", body.message)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        d.commit()
        return project_out(p)

    @app.post("/api/v1/research/projects/{id}/messages")
    def message(id: str, body: MessageInput, a=Depends(auth), d=Depends(db)):
        from . import research_stages

        p = project_of(d, id, a)
        if p.stage == "done":
            raise HTTPException(409, "研究已经结束")
        research_stages.say(d, p, "human", body.text)
        d.commit()
        return project_out(p)

    @app.post("/api/v1/research/projects/{id}/compute")
    def move_compute(id: str, body: ComputeInput, a=Depends(auth), d=Depends(db)):
        """Where the next experiments run; a job already running stays where it is."""
        from . import research_settings

        p = project_of(d, id, a)
        try:
            research_settings.compute(settings, body.compute_id)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        if body.compute_id != p.compute_id:
            old = research_settings.compute(settings, p.compute_id)
            if old["kind"] == "ssh":
                from .research_remote import pull

                try:
                    pull(settings, old, p.id)
                except ValueError as e:
                    raise HTTPException(
                        409, "没能把远程工作区拿回来：" + str(e)
                    ) from None
            research_map.event(
                d,
                p,
                None,
                "human",
                "compute_changed",
                {"from": p.compute_id, "to": body.compute_id},
            )
            p.compute_id = body.compute_id
            p.updated_at = now()
        d.commit()
        return project_out(p)

    @app.post("/api/v1/research/projects/{id}/plan/approve")
    def approve_plan(id: str, body: PlanApproval, a=Depends(auth), d=Depends(db)):
        from . import research_stages

        p = project_of(d, id, a)
        try:
            research_stages.approve_plan(settings, d, p, body.version, body.note)
        except ValueError as e:
            raise HTTPException(409, str(e)) from None
        d.commit()
        return project_out(p)

    @app.get("/api/v1/research/projects/{id}/jobs/{job_id}/series")
    def job_series(id: str, job_id: str, a=Depends(auth), d=Depends(db)):
        from .research_sandbox import series

        p = project_of(d, id, a)
        job = d.get(ResearchJob, job_id)
        if not job or job.project_id != p.id:
            raise HTTPException(404, "Not found")
        return series(settings, job)

    @app.get("/api/v1/research/settings")
    def research_settings_get(a=Depends(auth), d=Depends(db)):
        from . import research_datasets, research_settings

        allowed(a, d)
        return research_settings.public(research_settings.load(settings)) | {
            "datasets": research_datasets.catalog()
        }

    @app.put("/api/v1/research/settings")
    def research_settings_put(body: dict, a=Depends(auth), d=Depends(db)):
        from . import research_settings

        allowed(a, d)
        try:
            return research_settings.public(research_settings.update(settings, body))
        except (ValueError, TypeError) as e:
            raise HTTPException(422, str(e)) from None

    @app.get("/api/v1/research/runs/{run_id}")
    def research_run(run_id: str, a=Depends(auth), d=Depends(db)):
        """One agent run of research (a sprint, a scoping turn, a preparation), as it goes."""
        allowed(a, d)
        run = d.get(AgentRun, run_id)
        if run is None or run.owner != a["id"] or run.lane != "research":
            raise HTTPException(404, "Not found")
        runtime = run.runtime or {}
        return {
            "id": run.id,
            "status": run.status,
            "response": run.response or "",
            "error": run.error or "",
            "steps": run.steps or [],
            "role": (runtime.get("research") or {}).get("role", ""),
            "runtime": {
                k: runtime.get(k)
                for k in ("phase", "execution_seconds", "waiting_seconds")
                if k in runtime
            },
            "created_at": run.created_at,
            "updated_at": run.updated_at,
        }

    @app.post("/api/v1/research/environments/{env_id}/prepare")
    def prepare_environment(
        env_id: str, body: PrepareInput, a=Depends(auth), d=Depends(db)
    ):
        """An agent logs in to the machine and prepares it; see research_environment."""
        from . import research_environment
        from .translation_settings import read_store

        allowed(a, d)
        model = body.model_config_id or read_store(settings, a["id"]).get(
            "active_id", ""
        )
        try:
            run = research_environment.start(
                settings, d, a["id"], env_id, model, body.needs, body.allow_sudo
            )
        except ValueError as e:
            raise HTTPException(409, str(e)) from None
        d.commit()
        return research_environment.progress(settings, d, env_id) | {"run_id": run.id}

    @app.get("/api/v1/research/environments/{env_id}/progress")
    def environment_progress(env_id: str, a=Depends(auth), d=Depends(db)):
        from . import research_environment

        allowed(a, d)
        return research_environment.progress(settings, d, env_id)

    @app.post("/api/v1/research/computes/{compute_id}/test")
    def test_compute(compute_id: str, a=Depends(auth), d=Depends(db)):
        """Reaches the compute and reports what it offers (Python, packages, GPUs)."""
        import subprocess

        from . import research_remote, research_sandbox, research_settings

        allowed(a, d)
        try:
            item = research_settings.compute(settings, compute_id)
            if item["kind"] == "ssh":
                return research_remote.probe(item)
            status = research_sandbox.docker_status()
            if not status["available"]:
                raise ValueError(status["reason"])
            done = research_sandbox.run(
                [
                    "docker",
                    "run",
                    "--rm",
                    *research_sandbox.limits(item),
                    "--mount",
                    f"type=bind,source={research_sandbox.ORA_DIR},target=/opt/ora,readonly",
                    research_sandbox.IMAGE,
                    "python3",
                    "/opt/ora/probe.py",
                ],
                capture_output=True,
                text=True,
                timeout=90,
            )
            import json as _json

            return _json.loads((done.stdout or "{}").strip().splitlines()[-1])
        except (ValueError, OSError, IndexError, subprocess.TimeoutExpired) as e:
            raise HTTPException(409, str(e) or "检测失败") from None

    @app.get("/api/v1/research/projects")
    def projects(a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        return [
            project_out(p) | {"conclusion": conclusion(d, p)[:300]}
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
            "input_needed": input_needed(d, p),
            "datasets": [
                research_datasets.out(r) for r in research_datasets.of(d, p.id)
            ],
        }

    @app.get("/api/v1/research/projects/{id}/metrics")
    def project_metrics(id: str, a=Depends(auth), d=Depends(db)):
        from .research_metrics import metrics

        return metrics(d, project_of(d, id, a))

    @app.get("/api/v1/research/projects/{id}/report")
    def project_report(id: str, lang: str = "zh", a=Depends(auth), d=Depends(db)):
        from .research_report import report

        p = project_of(d, id, a)
        return Response(
            report(d, p, lang),
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="research-{p.id[:8]}.md"'
            },
        )

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
        from . import research_stages

        applied = False
        if research_stages.decide(d, p, request, body.approve, body.note):
            applied = True
        elif body.approve:
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
        research_datasets.record_upload(d, p, f"data/{name}", data)
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
        if any(x["open"] for x in decisions_of(d, p)):
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
