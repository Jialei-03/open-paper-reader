"""Plans research sprints: one at a time per project, from its map, within budget.

Each sprint is an ordinary agent run in the "research" lane, executed by the
agent worker. This worker only decides when the next one starts, closes the
ones that ended without a handoff, and collects finished experiments.
"""

import json
import signal
import threading
import time
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select

from . import research_datasets, research_sandbox, research_stages, research_tracker
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
from .research_brief import (
    advisor_brief,
    distiller_brief,
    executor_brief,
    scoping_brief,
)
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
    if sprint.role == "scoping":
        # A turn of the conversation: its reply is what the advisor said.
        reply = (run.response or "").strip()
        proposed = any(e.action == "plan_proposed" for e in _events(d, sprint))
        sprint.status = "ended" if run.status == "completed" else "abnormal"
        sprint.summary = reply[:4000]
        sprint.updated_at = now()
        if reply:
            research_stages.say(d, project, "advisor", reply, sprint.id)
        elif proposed:
            research_stages.say(
                d, project, "advisor", "计划卡片已更新，你看看。", sprint.id
            )
        else:
            research_stages.say(
                d,
                project,
                "system",
                "导师这次没能回复（"
                + (run.error or run.status)[:200]
                + "）。可以再说一次。",
                sprint.id,
            )
        return True
    if (
        sprint.role == "executor"
        and run.status == "completed"
        and (run.response or "").strip()
    ):
        # It handed over in words instead of with end_sprint: those words are the handoff.
        sprint.status = "ended"
        sprint.summary = run.response.strip()[:4000]
        sprint.updated_at = now()
        event(d, project, None, "system", "handoff_from_reply", {}, sprint.id)
        return True
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
    if _outage(run):
        # The model service failed before anything was done: the sprint is given back.
        project.spent = {
            **project.spent,
            "sprints": max(0, project.spent.get("sprints", 0) - 1),
        }
        event(
            d,
            project,
            None,
            "system",
            "model_outage",
            {"error": run.error[:300], "at": _now()},
            sprint.id,
        )
    return True


OUTAGE_LIMIT = 5
OUTAGE_BACKOFF = 60
OUTAGE_BACKOFF_MAX = 1800


def _now_real():
    return time.time()


# Through one name, so tests can move the clock.
_now = _now_real


def _outage(run):
    """The run failed without doing anything: the model service, not the research."""
    return run is not None and run.status == "failed" and not run.steps


def _outages(d, project, history):
    """How many of the last sprints in a row failed on the model service.

    Counting starts again when a person resumes the project.
    """
    resumed = d.scalars(
        select(ResearchEvent.created_at)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.actor == "human",
            ResearchEvent.action == "active",
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    count = 0
    for sprint in reversed(history):
        if resumed and sprint.created_at <= resumed:
            break
        if not _outage(d.get(AgentRun, sprint.run_id)):
            break
        count += 1
    return count


def _waiting_out(d, project, count):
    """Whether the pause after `count` outages in a row is still running."""
    last = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.action == "model_outage",
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    if last is None:
        return False
    delay = min(OUTAGE_BACKOFF * 2 ** (count - 1), OUTAGE_BACKOFF_MAX)
    return _now() < float(last.detail.get("at", 0)) + delay


def _last_human_message(d, project):
    return d.scalars(
        select(ResearchEvent.created_at)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.actor == "human",
            ResearchEvent.action == "message",
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()


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
    meet a kill condition, after a claimed finding, when the executor says it
    needs something only a person can provide, when the budget crosses
    half and four fifths, and when two sprints in a row moved nothing on the
    map. Never two advisor sprints in a row.
    """
    if project.budget.get("advisor") is False:
        # An ablation run: the executor works alone.
        return "executor"
    # Talking the plan through is not research work to be reviewed.
    history = [s for s in history if s.role != "scoping"]
    said = _last_human_message(d, project)
    if (
        said is not None
        and research_stages.unanswered(d, project)
        and (not history or history[-1].created_at < said)
    ):
        # The person spoke: the advisor answers before anything else moves.
        return "advisor"
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
        if row.action == "end_sprint" and row.detail.get("needs_input"):
            # Only a person can unblock it: the advisor decides now whether to stop and ask.
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
    if project.stage == "scoping":
        _converse(app, d, project, latest)
        return
    if research_datasets.pending(d, project) is not None:
        return
    failed = next(
        (r for r in research_datasets.of(d, project.id) if r.status == "failed"), None
    )
    if failed is not None:
        project.status = "paused"
        event(
            d,
            project,
            None,
            "system",
            "paused",
            {"reason": f"数据集 {failed.name} 下载失败：{failed.note[:200]}"},
        )
        return
    if _over_budget(project):
        research_stages.set_stage(d, project, "retrospective")
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
    outages = _outages(d, project, history)
    if outages >= OUTAGE_LIMIT:
        last = d.get(AgentRun, history[-1].run_id)
        project.status = "paused"
        project.updated_at = now()
        event(
            d,
            project,
            None,
            "system",
            "paused",
            {
                "reason": "模型服务连续出错，研究已暂停："
                + (last.error if last else "")[:200]
            },
        )
        return
    if outages and _waiting_out(d, project, outages):
        return
    role = next_role(d, project, history)
    if (
        role == "executor"
        and _local(app, project)
        and not research_sandbox.docker_status()["available"]
    ):
        # The executor's work is experiments: without Docker a sprint only spends tokens.
        reason = research_sandbox.docker_status()["reason"]
        said = d.scalars(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "docker_unavailable",
            )
            .order_by(ResearchEvent.created_at.desc())
        ).first()
        if said is None or (history and said.created_at < history[-1].created_at):
            event(d, project, None, "system", "docker_unavailable", {"reason": reason})
        return
    _start(app, d, project, latest, role, config)


def _local(app, project):
    """Whether the project's experiments run in this machine's Docker."""
    from . import research_settings

    try:
        item = research_settings.compute(app.state.settings, project.compute_id)
    except ValueError:
        return True
    return item["kind"] == "docker"


BRIEFS = {
    "advisor": advisor_brief,
    "executor": executor_brief,
    "scoping": scoping_brief,
}


def _converse(app, d, project, latest):
    """While scoping, the advisor answers each thing the person says."""
    if not research_stages.unanswered(d, project):
        return
    config = read_config(app.state.settings, project.owner, project.model_config_id)
    if not config.get("model"):
        research_stages.say(
            d, project, "system", "模型配置不可用，先在设置里选一个模型。"
        )
        return
    _start(app, d, project, latest, "scoping", config)


def _start(app, d, project, latest, role, config):
    number = (latest.number if latest else 0) + 1
    sprint = ResearchSprint(project_id=project.id, number=number, role=role, run_id="")
    d.add(sprint)
    d.flush()
    run = AgentRun(
        owner=project.owner,
        session_id=project.session_id,
        model_config_id=project.model_config_id,
        model=config["model"],
        prompt=BRIEFS[role](d, project, number, app.state.settings),
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
    if role != "scoping":
        # Talking the plan through is not a research sprint of the budget.
        project.spent = {
            **project.spent,
            "sprints": project.spent.get("sprints", 0) + 1,
        }
    if role == "executor" and not any(
        e.action == "playbook_version"
        for e in d.scalars(
            select(ResearchEvent).where(ResearchEvent.project_id == project.id)
        )
    ):
        # Which playbook this project ran with, for comparing runs later.
        from . import research_playbook

        book = research_playbook.load(app.state.settings)
        event(
            d,
            project,
            None,
            "system",
            "playbook_version",
            {
                "version": book["version"],
                "active": [r["id"] for r in research_playbook.active(book)],
            },
            sprint.id,
        )
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


def _distill(app, d, project):
    """Once a project is over, one distiller sprint turns it into playbook rules."""
    history = list(
        d.scalars(
            select(ResearchSprint)
            .where(ResearchSprint.project_id == project.id)
            .order_by(ResearchSprint.number)
        )
    )
    if project.budget.get("distill") is False:
        research_stages.set_stage(d, project, "done")
        return
    mine = [s for s in history if s.role == "distiller"]
    if mine:
        sprint = mine[-1]
        if sprint.status == "running" and _settle(d, project, sprint):
            event(d, project, None, "system", "distiller_silent", {}, sprint.id)
        if sprint.status != "running":
            research_stages.set_stage(d, project, "done")
        return
    if not any(s.role == "executor" for s in history):
        research_stages.set_stage(d, project, "done")
        return
    config = read_config(app.state.settings, project.owner, project.model_config_id)
    if not config.get("model"):
        return
    number = history[-1].number + 1
    sprint = ResearchSprint(
        project_id=project.id, number=number, role="distiller", run_id=""
    )
    d.add(sprint)
    d.flush()
    run = AgentRun(
        owner=project.owner,
        session_id=project.session_id,
        model_config_id=project.model_config_id,
        model=config["model"],
        prompt=distiller_brief(d, project, number, app.state.settings),
        context="research/" + project.id,
        writable=True,
        lane="research",
        runtime={
            "research": {
                "project_id": project.id,
                "sprint_id": sprint.id,
                "role": "distiller",
            }
        },
    )
    d.add(run)
    d.flush()
    sprint.run_id = run.id
    event(
        d,
        project,
        None,
        "system",
        "sprint_planned",
        {"number": number, "role": "distiller"},
        sprint.id,
    )


def tick(app):
    """One round of planning over every active project."""
    for name, step in (
        ("sweep", research_sandbox.sweep),
        ("datasets", research_datasets.fetch_pending),
        ("tracker", research_tracker.sync_pending),
    ):
        try:
            step(app.state.settings, app.state.maker)
        except Exception as e:  # noqa: BLE001 — housekeeping must not stop planning
            print(
                json.dumps({"research_worker": name, "error": str(e)[:300]}),
                flush=True,
            )
    with app.state.maker() as d:
        ids = list(
            d.scalars(
                select(ResearchProject.id).where(ResearchProject.status == "active")
            )
        )
    with app.state.maker() as d:
        done = list(
            d.scalars(
                select(ResearchProject.id).where(ResearchProject.status == "finished")
            )
        )
    for id in done:
        with app.state.maker() as d:
            project = d.get(ResearchProject, id)
            try:
                _distill(app, d, project)
                d.commit()
            except (ValueError, OSError) as e:
                d.rollback()
                print(
                    json.dumps({"research_worker": id, "error": str(e)[:300]}),
                    flush=True,
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
