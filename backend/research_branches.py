"""Research forks start from a sealed round, never from today's map as history.

Round snapshots and inherited history are data, not runnable jobs or approvals.
The caller holds the source session and workspace locks before writing a boundary
or creating a fork. Git creates a separate branch/worktree from the exact commit.
"""

from copy import deepcopy
from subprocess import TimeoutExpired
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import research_map, research_repo
from .models import (
    AgentRun,
    AgentSession,
    ResearchCollection,
    ResearchDataset,
    ResearchEvent,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
    now,
    uid,
)

TERMINAL = {"completed", "failed", "cancelled"}
PROJECT_STATE = (
    "question",
    "background",
    "model_config_id",
    "status",
    "end_reason",
    "budget",
    "spent",
    "stage",
    "compute_id",
    "environment",
    "plan",
    "conclusion",
)


def _row(row):
    return {c.name: deepcopy(getattr(row, c.name)) for c in row.__table__.columns}


def capture_round(settings, d, project, sprint, *, allow_capture=True):
    """Seal a newly ended round in the current transaction, before another starts.

    Existing legacy rounds must not be passed with allow_capture=True. The
    scheduler/tools call this only on the transition out of running. A missing
    snapshot is deliberately not reconstructed by the background Git importer.
    """
    if sprint.snapshot:
        return bool(
            sprint.snapshot.get("version") == 1
            and sprint.snapshot.get("commit") == sprint.commit_sha
        )
    if not allow_capture or sprint.status not in {"ended", "abnormal"}:
        return False
    if not project.workspace_id or not research_repo.available():
        return False
    d.flush()
    later = d.scalar(
        select(ResearchSprint.id)
        .where(
            ResearchSprint.project_id == project.id,
            ResearchSprint.number > sprint.number,
        )
        .limit(1)
    )
    if later is not None:
        return False
    workspace = d.get(ResearchWorkspace, project.workspace_id)
    if workspace is None or workspace.owner != project.owner:
        return False
    if sprint.role == "discussion":
        if not (
            research_repo.thread_dir(settings, workspace.id, project.id) / ".git"
        ).exists():
            return False
    else:
        research_repo.adopt(settings, workspace, project)
    if sprint.role == "executor":
        from . import research_remote
        from .research_locations import execution_compute

        try:
            compute = execution_compute(settings, d, project)
        except ValueError:
            compute = None
        if (
            compute is not None
            and compute["kind"] == "ssh"
            and not compute.get("workspace_path")
        ):
            # A remote executor's authoritative files live on that machine.
            # Import its bounded code output before sealing the local commit.
            try:
                research_remote.pull(
                    settings, compute, project.id, small=True, timeout=60
                )
            except TimeoutExpired:
                raise ValueError(
                    "远程代码同步超时，本轮没有可用于分叉的检查点"
                ) from None
    if sprint.role == "discussion":
        commit = research_repo.head(
            research_repo.thread_dir(settings, workspace.id, project.id)
        )
        sprint.commit_sha = commit
    else:
        commit = research_repo.commit_round(settings, project, sprint)
    if not commit:
        return False
    history = project.inherited_history or {}
    events = list(
        d.scalars(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
            )
            .order_by(ResearchEvent.created_at, ResearchEvent.id)
        )
    )
    rounds = list(
        d.scalars(
            select(ResearchSprint)
            .where(
                ResearchSprint.project_id == project.id,
                ResearchSprint.number <= sprint.number,
            )
            .order_by(ResearchSprint.number)
        )
    )
    sprint.snapshot = {
        "version": 1,
        "commit": commit,
        "sprint_id": sprint.id,
        "number": sprint.number,
        "captured_at": now(),
        "project": {key: deepcopy(getattr(project, key)) for key in PROJECT_STATE},
        "nodes": [_row(n) for n in research_map.nodes(d, project)],
        "events": [*deepcopy(history.get("events", [])), *[_row(e) for e in events]],
        "sprints": [
            *deepcopy(history.get("sprints", [])),
            *[{k: v for k, v in _row(s).items() if k != "snapshot"} for s in rounds],
        ],
        "datasets": [
            _row(r)
            for r in d.scalars(
                select(ResearchDataset).where(
                    ResearchDataset.project_id == project.id,
                )
            )
        ],
    }
    return True


def _reason(d, sprint):
    if sprint.status not in {"ended", "abnormal"}:
        return "这一轮尚未结束"
    snapshot = sprint.snapshot or {}
    if snapshot.get("version") != 1:
        return "旧轮次没有可靠的历史快照"
    if not sprint.commit_sha or snapshot.get("commit") != sprint.commit_sha:
        return "轮次快照与代码检查点不匹配"
    if snapshot.get("sprint_id") != sprint.id or not snapshot.get("nodes"):
        return "轮次快照不完整"
    run = d.get(AgentRun, sprint.run_id)
    if run is None:
        return "原始轮次运行记录不可用"
    if run.status not in TERMINAL:
        return "这一轮仍在收尾"
    return ""


def options(settings, d, project):
    workspace = (
        d.get(ResearchWorkspace, project.workspace_id) if project.workspace_id else None
    )
    session = d.get(AgentSession, project.session_id)
    reason = ""
    if workspace is None or workspace.owner != project.owner:
        reason = "研究尚未关联项目"
    elif workspace.archived or session is None or session.archived_at:
        reason = "请先恢复项目或研究会话"
    elif not research_repo.available():
        reason = "Git 不可用"
    rows = list(
        d.scalars(
            select(ResearchSprint)
            .where(
                ResearchSprint.project_id == project.id,
            )
            .order_by(ResearchSprint.number.desc())
            .limit(100)
        )
    )
    rounds = []
    for sprint in rows:
        unavailable = reason or _reason(d, sprint)
        if not unavailable:
            try:
                research_repo.validate_checkpoint(
                    settings, workspace, project, sprint.commit_sha
                )
            except (ValueError, OSError, RuntimeError) as e:
                unavailable = str(e) or "代码检查点不可用"
        rounds.append(
            {
                "sprint_id": sprint.id,
                "number": sprint.number,
                "role": sprint.role,
                "status": sprint.status,
                "summary": sprint.summary,
                "commit_sha": sprint.commit_sha,
                "available": not unavailable,
                "reason": unavailable,
            }
        )
    can_fork = not reason and any(r["available"] for r in rounds)
    return {
        "can_fork": can_fork,
        "reason": reason or ("" if can_fork else "没有可分叉的轮次检查点"),
        "rounds": rounds,
    }


class ForkInput(BaseModel):
    sprint_id: str = Field(min_length=1, max_length=36)
    expected_commit: str = Field(min_length=7, max_length=64)
    change: str = Field(min_length=1, max_length=8000)
    client_id: UUID
    workflow_id: str = Field(default="research", min_length=1, max_length=64)


def _same_request(child, source, body):
    origin = child.forked_from or {}
    return (
        child.parent_id == source.id
        and origin.get("sprint_id") == body.sprint_id
        and origin.get("commit") == body.expected_commit
        and origin.get("change") == body.change.strip()
        and origin.get("workflow_id", "research") == body.workflow_id
    )


def _inherited_results(rows, research_id, node_id):
    """Keep verified excerpts and point log links at their original owner.

    A fork of a fork keeps the first evidence source, not a nonexistent child
    job. The normal result tool still accepts only the child's own new jobs.
    """
    results = deepcopy(rows)
    for entry in results:
        origin = entry.setdefault("source_research_id", research_id)
        entry.setdefault("source_node_id", node_id)
        for evidence in entry.get("evidence", []):
            evidence.setdefault("source_research_id", origin)
            if evidence.get("kind") == "log" and evidence.get("job_id"):
                evidence["source_log_url"] = (
                    f"/api/v1/research/projects/{evidence['source_research_id']}"
                    f"/jobs/{evidence['job_id']}/log"
                )
    return results


def fork(settings, d, source, body):
    """Create independent domain rows and files. No run or job is scheduled."""
    change = body.change.strip()
    if not change:
        raise ValueError("请说明分叉后要探索的方向")
    key = f"{source.owner}:{body.client_id}"
    existing = d.scalar(select(ResearchProject).where(ResearchProject.fork_key == key))
    if existing is not None:
        if not _same_request(existing, source, body):
            raise ValueError("这个请求编号已经用于另一次研究分叉")
        return existing
    from .research_workflows import definition

    workspace = (
        d.get(ResearchWorkspace, source.workspace_id) if source.workspace_id else None
    )
    workflow = definition(d, source.owner, body.workflow_id, workspace=workspace)
    session = d.get(AgentSession, source.session_id)
    if workspace is None or workspace.owner != source.owner:
        raise ValueError("研究尚未关联项目")
    if workspace.archived or session is None or session.archived_at:
        raise ValueError("请先恢复项目或研究会话")
    sprint = d.scalar(
        select(ResearchSprint)
        .where(
            ResearchSprint.id == body.sprint_id,
            ResearchSprint.project_id == source.id,
        )
        .with_for_update()
    )
    if sprint is None:
        raise ValueError("找不到这轮研究")
    d.refresh(sprint)
    reason = _reason(d, sprint)
    if reason:
        raise ValueError(reason)
    if sprint.commit_sha != body.expected_commit:
        raise ValueError("轮次检查点已经变化，请重新选择")
    commit = research_repo.validate_checkpoint(
        settings, workspace, source, body.expected_commit
    )
    snapshot = deepcopy(sprint.snapshot)
    state = snapshot["project"]
    title = (source.title or state["question"]).strip()[:95] + " · 分叉"
    collection_id = (
        d.scalar(
            select(ResearchCollection.id).where(
                ResearchCollection.id == source.collection_id,
                ResearchCollection.owner == source.owner,
                ResearchCollection.archived.is_(False),
            )
        )
        if source.collection_id
        else None
    )
    origin = {
        "research_id": source.id,
        "question": state["question"],
        "source_session_id": source.session_id,
        "sprint_id": sprint.id,
        "number": sprint.number,
        "commit": commit,
        "change": change,
        "at": now(),
        "source_stage": state["stage"],
        "source_spent": state["spent"],
        "datasets": snapshot.get("datasets", []),
        "workflow_id": workflow["id"],
        "workflow": workflow["name"],
    }
    child_session = AgentSession(
        owner=source.owner,
        title=title,
        kind="research",
        workspace_id=workspace.id,
        model_config_id=state["model_config_id"],
        source_session_id=source.session_id,
        source_run_id=sprint.run_id,
    )
    d.add(child_session)
    d.flush()
    plan = deepcopy(state.get("plan") or {})
    if plan:
        plan = {**plan, "approved_at": None, "inherited": True}
    child = ResearchProject(
        owner=source.owner,
        workspace_id=workspace.id,
        question=state["question"],
        title=title,
        collection_id=collection_id,
        background=state["background"],
        model_config_id=state["model_config_id"],
        status="paused",
        stage="scoping",
        spawned_by="fork",
        plan=plan,
        compute_id=state["compute_id"],
        environment={},
        budget={
            **deepcopy(state["budget"]),
            "auto_decide": False,
        },
        session_id=child_session.id,
        parent_id=source.id,
        forked_from=origin,
        fork_key=key,
        inherited_history={
            "events": snapshot["events"],
            "sprints": snapshot["sprints"],
        },
    )
    d.add(child)
    d.flush()
    from .research_workflows import snapshot as workflow_snapshot

    workflow_snapshot(d, child, body.workflow_id)
    # Snapshot activation must not schedule a fork before the owner resumes it.
    child.status = "paused"
    ids = {row["id"]: uid() for row in snapshot["nodes"]}
    child.forked_from = {**origin, "node_ids": ids}
    for row in snapshot["nodes"]:
        values = deepcopy(row)
        values.update(
            id=ids[row["id"]], project_id=child.id, parent_id=ids.get(row["parent_id"])
        )
        for key in ("evidence_for", "evidence_against"):
            values[key] = _inherited_results(values[key], source.id, row["id"])
        d.add(ResearchNode(**values))
    d.flush()
    research_map.event(d, child, None, "human", "research_forked", origin)
    from .research_stages import say

    say(
        d,
        child,
        "system",
        f"从「{origin['question']}」第 {sprint.number} 轮分叉（{commit[:12]}）。来源记录只读；本研究独立暂停，继续定题并批准新计划后才运行实验。",
    )
    say(d, child, "human", change)
    try:
        research_repo.fork_thread(settings, workspace, source, child, commit)
        d.commit()
    except BaseException:
        d.rollback()
        research_repo.remove_thread(settings, workspace, child)
        raise
    return child


def install_branch_routes(app, settings, db, auth, project_of, project_out):
    @app.get("/api/v1/research/projects/{id}/forks/options")
    def fork_options(id: str, a=Depends(auth), d=Depends(db)):
        return options(settings, d, project_of(d, id, a))

    @app.post("/api/v1/research/projects/{id}/forks")
    def create_fork(id: str, body: ForkInput, a=Depends(auth), d=Depends(db)):
        source = project_of(d, id, a, writable=True)
        try:
            child = fork(settings, d, source, body)
        except IntegrityError:
            raise HTTPException(409, "这个请求编号已经用于另一次研究分叉") from None
        except (ValueError, OSError, RuntimeError) as e:
            raise HTTPException(409, str(e) or "无法创建研究分叉") from None
        return project_out(child)
