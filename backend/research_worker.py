"""Plans research sprints: one at a time per project, from its map, within budget.

Each sprint is an ordinary agent run in the "research" lane, executed by the
agent worker. This worker only decides when the next one starts, closes the
ones that ended without a handoff, and collects finished experiments.
"""

import json
import signal
import threading
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select

from . import research_sandbox
from .config import Settings, database
from .filelock import lock_nowait
from .models import (
    AgentRun,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    now,
)
from .parent_watch import watch_parent
from .research_brief import advisor_brief, executor_brief
from .research_map import event
from .translation_settings import read_config

INTERVAL = 2
DONE = {"completed", "failed", "cancelled"}


def fallback_summary(run):
    """What a sprint did, from its steps, when it ended without writing a handoff."""
    lines = []
    for step in (run.steps or [])[-10:]:
        result = step.get("error") or (step.get("result") or {}).get("summary") or ""
        lines.append(f"- {step.get('name')}: {step.get('status')} {str(result)[:160]}")
    reason = run.error or run.status
    return f"本轮在没有交接的情况下结束（{reason}）。最后的步骤：\n" + (
        "\n".join(lines) or "- （没有调用任何工具）"
    )


def charge(maker, research, tokens):
    """Model tokens, to the sprint, the node in focus at the time, and the project."""
    if tokens <= 0:
        return
    from .models import ResearchNode

    with maker() as d:
        sprint = d.get(ResearchSprint, research["sprint_id"])
        project = d.get(ResearchProject, research["project_id"])
        if sprint is None or project is None:
            return
        sprint.tokens += tokens
        if sprint.focus_node_id:
            node = d.get(ResearchNode, sprint.focus_node_id)
            if node is not None:
                node.spent_tokens += tokens
        project.spent = {
            **project.spent,
            "tokens": project.spent.get("tokens", 0) + tokens,
        }
        d.commit()


def _over_budget(project):
    budget, spent = project.budget, project.spent
    return (
        spent.get("sprints", 0) >= budget.get("max_sprints", 0)
        or spent.get("tokens", 0) >= budget.get("max_tokens", 0)
        or spent.get("job_seconds", 0) >= budget.get("max_job_seconds", 0)
    )


def _settle(d, project, sprint):
    """A sprint whose run is over but which never handed over is closed by the system."""
    run = d.get(AgentRun, sprint.run_id)
    if run is None or run.status not in DONE:
        return False
    sprint.status = "abnormal"
    sprint.summary = fallback_summary(run)
    sprint.updated_at = now()
    event(
        d,
        project,
        None,
        "system",
        "sprint_abnormal",
        {"run_status": run.status},
        sprint.id,
    )
    if sprint.role == "advisor":
        # An advisor that said nothing changes nothing; the executor carries on.
        event(d, project, None, "system", "advisor_silent", {}, sprint.id)
    return True


ADVISOR_EVERY = 3
PROGRESS = {"add_node", "update_node", "record_result"}
MARKS = (0.5, 0.8)


def _events(d, sprint):
    return list(
        d.scalars(select(ResearchEvent).where(ResearchEvent.sprint_id == sprint.id))
    )


def _progressed(d, sprint):
    return any(row.action in PROGRESS for row in _events(d, sprint))


def next_role(d, project, history):
    """Who works next: the advisor when a judgment is due, else the executor.

    A judgment is due every few executor sprints, after a result that may
    meet a kill condition, after a claimed finding, when the budget crosses
    half and four fifths, and when two sprints in a row moved nothing on the
    map. Never two advisor sprints in a row.
    """
    if not history or history[-1].role == "advisor":
        return "executor"
    since = []
    for sprint in reversed(history):
        if sprint.role == "advisor":
            break
        since.append(sprint)
    if len(since) >= ADVISOR_EVERY:
        return "advisor"
    for row in _events(d, history[-1]):
        if row.action == "record_result" and row.detail.get("kill_triggered") in {
            "yes",
            "unsure",
        }:
            return "advisor"
        if row.action == "add_node" and row.detail.get("kind") == "finding":
            return "advisor"
    budget, spent = project.budget, project.spent
    ratio = max(
        spent.get("sprints", 0) / max(budget.get("max_sprints", 1), 1),
        spent.get("tokens", 0) / max(budget.get("max_tokens", 1), 1),
    )
    marked = {
        row.detail.get("mark")
        for row in d.scalars(
            select(ResearchEvent).where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "budget_mark",
            )
        )
    }
    for mark in MARKS:
        if ratio >= mark and mark not in marked:
            event(d, project, None, "system", "budget_mark", {"mark": mark})
            return "advisor"
    if len(since) >= 2 and all(
        not s.waiting_on and not _progressed(d, s) for s in since[:2]
    ):
        return "advisor"
    return "executor"


def _plan(app, d, project):
    latest = d.scalars(
        select(ResearchSprint)
        .where(ResearchSprint.project_id == project.id)
        .order_by(ResearchSprint.number.desc())
    ).first()
    if (
        latest is not None
        and latest.status == "running"
        and not _settle(d, project, latest)
    ):
        return
    if latest is not None and latest.waiting_on:
        waiting = d.scalars(
            select(ResearchJob).where(
                ResearchJob.id.in_(latest.waiting_on), ResearchJob.status == "running"
            )
        ).first()
        if waiting is not None:
            return
    if _over_budget(project):
        project.status, project.end_reason = "finished", "budget"
        project.updated_at = now()
        event(d, project, None, "system", "finished", {"end_reason": "budget"})
        return
    config = read_config(app.state.settings, project.owner, project.model_config_id)
    if not config.get("model"):
        project.status = "paused"
        event(d, project, None, "system", "paused", {"reason": "模型配置不可用"})
        return
    history = list(
        d.scalars(
            select(ResearchSprint)
            .where(ResearchSprint.project_id == project.id)
            .order_by(ResearchSprint.number)
        )
    )
    role = next_role(d, project, history)
    number = (latest.number if latest else 0) + 1
    sprint = ResearchSprint(project_id=project.id, number=number, role=role, run_id="")
    d.add(sprint)
    d.flush()
    run = AgentRun(
        owner=project.owner,
        session_id=project.session_id,
        model_config_id=project.model_config_id,
        model=config["model"],
        prompt=(advisor_brief if role == "advisor" else executor_brief)(
            d, project, number
        ),
        context="research/" + project.id,
        writable=True,
        lane="research",
        runtime={
            "research": {
                "project_id": project.id,
                "sprint_id": sprint.id,
                "role": role,
            }
        },
    )
    d.add(run)
    d.flush()
    sprint.run_id = run.id
    project.spent = {**project.spent, "sprints": project.spent.get("sprints", 0) + 1}
    project.updated_at = now()
    event(
        d,
        project,
        None,
        "system",
        "sprint_planned",
        {"number": number, "role": role},
        sprint.id,
    )


def tick(app):
    """One round of planning over every active project."""
    research_sandbox.sweep(app.state.settings, app.state.maker)
    with app.state.maker() as d:
        ids = list(
            d.scalars(
                select(ResearchProject.id).where(ResearchProject.status == "active")
            )
        )
    for id in ids:
        with app.state.maker() as d:
            project = d.get(ResearchProject, id)
            if project is None or project.status != "active":
                continue
            try:
                _plan(app, d, project)
                d.commit()
            except (ValueError, OSError) as e:
                d.rollback()
                print(
                    json.dumps({"research_worker": id, "error": str(e)[:300]}),
                    flush=True,
                )


def main():
    watch_parent()
    settings = Settings.env()
    _, maker = database(settings)
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker))
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    path = Path(settings.storage).parent / "research-worker.lock"
    with path.open("a") as lock:
        lock_nowait(lock)
        while not stopping.is_set():
            try:
                tick(app)
            except Exception as e:  # noqa: BLE001 — the scheduler outlives one bad round
                print(
                    json.dumps({"research_worker": "tick", "error": str(e)[:300]}),
                    flush=True,
                )
            stopping.wait(INTERVAL)


if __name__ == "__main__":
    main()
