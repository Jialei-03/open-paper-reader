# ruff: noqa: B008
"""Local schedules deliver messages; the existing research agent does the work."""

from datetime import datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import delete, select, update

from .models import (
    AgentSession,
    ResearchProject,
    ResearchSchedule,
    ResearchScheduleRun,
    ResearchWorkspace,
    now,
)
from .schemas import Strict

UTC = timezone.utc
TIMING = ("frequency", "local_time", "weekday", "interval_hours", "timezone")
FIELDS = (
    "title",
    "prompt",
    "workspace_id",
    "destination",
    "research_id",
    "workflow_id",
    *TIMING,
    "paused",
)


class ScheduleInput(Strict):
    title: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=8000)
    workspace_id: str = Field(min_length=1, max_length=36)
    destination: Literal["new", "existing"] = "new"
    research_id: str | None = Field(default=None, max_length=36)
    workflow_id: str = Field(default="research", min_length=1, max_length=64)
    frequency: Literal["daily", "weekly", "interval"] = "daily"
    local_time: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    weekday: int = Field(default=0, ge=0, le=6)
    interval_hours: int = Field(default=4, ge=1, le=8760)
    timezone: str = Field(min_length=1, max_length=100)
    paused: bool = False

    @field_validator("title", "prompt", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("时区无效") from None
        return value


class SchedulePatch(Strict):
    title: str | None = None
    prompt: str | None = None
    workspace_id: str | None = None
    destination: Literal["new", "existing"] | None = None
    research_id: str | None = None
    workflow_id: str | None = None
    frequency: Literal["daily", "weekly", "interval"] | None = None
    local_time: str | None = None
    weekday: int | None = None
    interval_hours: int | None = None
    timezone: str | None = None
    paused: bool | None = None


def stamp(at):
    return at.astimezone(UTC).isoformat(timespec="microseconds")


def next_time(spec, after, previous=None):
    """One future occurrence, skipping missed intervals and repeated DST hours."""
    after = after.astimezone(UTC)
    if spec.frequency == "interval":
        step = timedelta(hours=spec.interval_hours)
        anchor = datetime.fromisoformat(previous) if previous else after
        return stamp(anchor + max(1, (after - anchor) // step + 1) * step)
    zone = ZoneInfo(spec.timezone)
    day = after.astimezone(zone).date()
    hour, minute = map(int, spec.local_time.split(":"))
    for offset in range(8):
        date = day + timedelta(days=offset)
        if spec.frequency == "weekly" and date.weekday() != spec.weekday:
            continue
        # A spring gap moves forward by the DST gap; a fall fold runs only once.
        candidate = datetime.combine(date, time(hour, minute), tzinfo=zone).astimezone(
            UTC
        )
        if candidate > after:
            return stamp(candidate)
    raise ValueError("无法计算下次执行时间")


def schedule_out(item):
    return {
        key: getattr(item, key)
        for key in ("id", *FIELDS, "next_run_at", "created_at", "updated_at")
    }


def run_out(item):
    return {
        key: getattr(item, key)
        for key in (
            "id",
            "trigger",
            "scheduled_for",
            "started_at",
            "finished_at",
            "status",
            "research_id",
            "error",
        )
    } | {
        "conversation_url": (
            f"#research/{item.research_id}" if item.research_id else None
        )
    }


def history(d, item):
    return [
        run_out(run)
        for run in d.scalars(
            select(ResearchScheduleRun)
            .where(ResearchScheduleRun.schedule_id == item.id)
            .order_by(
                ResearchScheduleRun.started_at.desc(), ResearchScheduleRun.id.desc()
            )
            .limit(20)
        )
    ]


def deliver(settings, d, item):
    from . import (
        research_chat,
        research_dialogue,
        research_map,
        research_settings,
        research_stages,
        research_workspaces,
    )
    from .research_locations import bind, compute_for
    from .translation_settings import read_config, read_store

    workspace = d.get(ResearchWorkspace, item.workspace_id)
    if not workspace or workspace.owner != item.owner:
        raise ValueError("项目不存在")
    if item.destination == "existing":
        project = d.get(ResearchProject, item.research_id)
        if (
            not project
            or project.owner != item.owner
            or project.workspace_id != workspace.id
        ):
            raise ValueError("对话不属于这个项目")
        session = d.get(AgentSession, project.session_id)
        if not session or session.owner != item.owner:
            raise ValueError("对话不存在")
        research_chat.lock_session(d, session)
        research_workspaces.lock_workspace(d, workspace)
        d.refresh(project)
        if workspace.archived or session.archived_at:
            raise ValueError("请先恢复项目或对话")
        # post records through research_stages.say and preserves approval boundaries.
        research_dialogue.post(settings, d, project, item.prompt, actor="system")
        return project.id
    research_workspaces.lock_workspace(d, workspace)
    if workspace.archived:
        raise ValueError("请先恢复这个项目")
    model = (
        workspace.model_config_id
        or read_store(settings, item.owner).get("active_id", "")
        or "none"
    )
    cfg = read_config(settings, item.owner, model)
    if not cfg.get("api_key") or not cfg.get("model"):
        raise ValueError("请先添加并选择可用模型")
    compute = compute_for(settings, workspace)
    research_settings.compute(settings, compute)
    project = research_map.create_project(d, item.owner, item.prompt[:2000], "", model)
    project.workspace_id = workspace.id
    project.compute_id = compute
    project.stage = "scoping"
    project.spawned_by = "schedule"
    project.title = item.title
    d.get(AgentSession, project.session_id).workspace_id = workspace.id
    bind(settings, workspace, project)
    research_stages.say(d, project, "human", item.prompt)
    from .research_workflows import snapshot

    snapshot(d, project, item.workflow_id)
    # The worker's repository step adopts the conversation before planning it.
    return project.id


def run(settings, d, item, at, *, manual=False):
    from .team_timers import run_legacy

    record = run_legacy(settings, d, item, at, manual=manual)
    d.commit()
    return record


def tick(settings, maker, at=None):
    from .team_timers import tick as dispatch_rules

    dispatch_rules(settings, maker, at)


def install_schedule_routes(
    app, settings, db, auth, allowed, owned, workspace_of, project_of
):
    def schedule_of(d, id, a, *, writable=False):
        allowed(a, d)
        item = owned(d, ResearchSchedule, id, a)
        if writable:
            locked = d.execute(
                update(ResearchSchedule)
                .where(ResearchSchedule.id == id)
                .values(updated_at=ResearchSchedule.updated_at)
            )
            if not locked.rowcount:
                raise HTTPException(404, "Not found")
            d.refresh(item)
        return item

    def validate_target(d, body, a):
        workspace = workspace_of(d, body.workspace_id, a)
        if workspace.archived:
            raise HTTPException(409, "请先恢复这个项目")
        if body.destination == "existing":
            if not body.research_id:
                raise HTTPException(422, "请选择对话")
            project = project_of(d, body.research_id, a, writable=True)
            if project.workspace_id != workspace.id:
                raise HTTPException(422, "对话不属于这个项目")
        else:
            body.research_id = None
            from .research_workflows import definition

            definition(d, a["id"], body.workflow_id)

    @app.get("/api/v1/research/schedules")
    def schedules(a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        from .team_timers import center_rows

        rules = center_rows(d, a["id"])
        by_id = {r["rule"]: r for r in rules}
        result = []
        for item in d.scalars(
            select(ResearchSchedule)
            .where(ResearchSchedule.owner == a["id"])
            .order_by(
                ResearchSchedule.paused,
                ResearchSchedule.next_run_at,
                ResearchSchedule.id,
            )
        ):
            rule = by_id.get(f"schedule:{item.id}")
            value = schedule_out(item)
            if rule:
                value.update(
                    {k: rule[k] for k in ("rule", "cron", "editor_url", "paused")}
                )
            result.append(value)
        result.extend(r for r in rules if not r["rule"].startswith("schedule:"))
        d.commit()
        return result

    @app.post("/api/v1/research/schedules")
    def create_schedule(body: ScheduleInput, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        validate_target(d, body, a)
        item = ResearchSchedule(
            owner=a["id"],
            **body.model_dump(),
            next_run_at=next_time(body, datetime.now(UTC)),
        )
        d.add(item)
        d.flush()
        from .team_timers import sync

        sync(d, item)
        d.commit()
        return schedule_out(item)

    @app.get("/api/v1/research/schedules/{id}")
    def schedule(id: str, a=Depends(auth), d=Depends(db)):
        item = schedule_of(d, id, a)
        return schedule_out(item) | {"runs": history(d, item)}

    @app.patch("/api/v1/research/schedules/{id}")
    def edit_schedule(id: str, patch: SchedulePatch, a=Depends(auth), d=Depends(db)):
        from pydantic import ValidationError

        item = schedule_of(d, id, a, writable=True)
        try:
            body = ScheduleInput.model_validate(
                {key: getattr(item, key) for key in FIELDS}
                | patch.model_dump(exclude_unset=True)
            )
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from None
        if patch.model_fields_set != {"paused"} or not body.paused:
            validate_target(d, body, a)
        if any(getattr(item, key) != getattr(body, key) for key in TIMING) or (
            item.paused and not body.paused
        ):
            item.next_run_at = next_time(body, datetime.now(UTC))
        from .team_timers import sync

        if item.workspace_id != body.workspace_id:
            sync(d, item, remove=True)
        for key, value in body.model_dump().items():
            setattr(item, key, value)
        sync(d, item)
        item.updated_at = now()
        d.commit()
        return schedule_out(item) | {"runs": history(d, item)}

    @app.delete("/api/v1/research/schedules/{id}")
    def delete_schedule(id: str, a=Depends(auth), d=Depends(db)):
        item = schedule_of(d, id, a, writable=True)
        d.execute(
            delete(ResearchScheduleRun).where(
                ResearchScheduleRun.schedule_id == item.id
            )
        )
        from .team_timers import sync

        sync(d, item, remove=True)
        d.delete(item)
        d.commit()
        return {"deleted": True}

    @app.post("/api/v1/research/schedules/{id}/run")
    def run_schedule(id: str, a=Depends(auth), d=Depends(db)):
        item = schedule_of(d, id, a, writable=True)
        record = run(settings, d, item, datetime.now(UTC), manual=True)
        return run_out(record)
