"""A project's main Pi conversation and its historical read-only chats.

The lead reads the project, dispatches scoping researches and forwards guidance.
Each answer resumes the same Pi session; research rounds keep their own briefs.
"""

import base64
import json
from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import and_, case, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError

from . import research_map, research_workspaces
from .models import (
    AgentRun,
    AgentSession,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
    now,
)
from .translation_settings import read_config, read_store

RECENT_JOBS = 8
RECENT_ROUNDS = 3


def main_session(d, workspace):
    """A stable, initially empty Pi conversation, independent of historical chats."""
    session_id = workspace.session_id or str(
        uuid5(NAMESPACE_URL, f"ora:project:{workspace.id}:lead")
    )
    session = d.get(AgentSession, session_id)
    if session is None:
        try:
            with d.begin_nested():
                session = AgentSession(
                    id=session_id,
                    owner=workspace.owner,
                    title="项目导师",
                    kind="project_lead",
                    pinned_at=workspace.created_at or now(),
                    workspace_id=workspace.id,
                    model_config_id=workspace.model_config_id,
                )
                d.add(session)
                d.flush()
        except IntegrityError:
            session = d.get(AgentSession, session_id)
    if (
        session is None
        or session.owner != workspace.owner
        or session.workspace_id != workspace.id
    ):
        raise ValueError("项目主会话不可用")
    workspace.session_id = session.id
    session.kind = "project_lead"
    return session


def session_kind(d, session, project=None, workspace=None):
    project = project or d.scalar(
        select(ResearchProject).where(
            ResearchProject.session_id == session.id,
            ResearchProject.owner == session.owner,
        )
    )
    if project is not None:
        return "research"
    if session.kind in {"research", "artifact"}:
        return session.kind
    workspace = workspace or workspace_of(d, session)
    if workspace is not None and workspace.owner == session.owner:
        return "project_lead" if workspace.session_id == session.id else "project_chat"
    return "paper" if session.paper_id else session.kind


def session_out(d, session, project=None, workspace=None):
    project = project or d.scalar(
        select(ResearchProject).where(
            ResearchProject.session_id == session.id,
            ResearchProject.owner == session.owner,
        )
    )
    wid = project.workspace_id if project is not None else session.workspace_id
    workspace = workspace or (d.get(ResearchWorkspace, wid) if wid else None)
    if workspace is not None and workspace.owner != session.owner:
        workspace = None
    kind = session_kind(d, session, project, workspace)
    active = d.scalar(
        select(AgentRun)
        .where(
            AgentRun.session_id == session.id,
            AgentRun.status.in_(["queued", "running"]),
        )
        .order_by(AgentRun.created_at.desc(), AgentRun.id.desc())
    )
    last = active or d.scalar(
        select(AgentRun)
        .where(AgentRun.session_id == session.id)
        .order_by(AgentRun.created_at.desc(), AgentRun.id.desc())
    )
    archived_at = (
        (workspace.updated_at if workspace and workspace.archived else None)
        if kind == "project_lead"
        else session.archived_at
    )
    conversational = kind in {"project_lead", "project_chat", "chat", "paper"}
    available = not archived_at and not (workspace and workspace.archived)
    editable = kind not in {"research", "artifact"}
    active_job = (
        project is not None
        and d.scalar(
            select(ResearchJob.id)
            .where(
                ResearchJob.project_id == project.id,
                ResearchJob.status.in_(["queued", "running"]),
            )
            .limit(1)
        )
        is not None
    )
    progress = ""
    if project is not None:
        summary = research_workspaces.summary(d, project)
        progress = summary["progress"]
    elif last is not None:
        progress = (last.response or last.prompt or "")[:200]
    return {
        "id": session.id,
        "paper_id": session.paper_id,
        "title": (
            (project.title or project.question)
            if project is not None
            else session.title
        ),
        "workspace_id": workspace.id if workspace else None,
        "research_id": project.id if project is not None else None,
        "parent_id": project.parent_id if project is not None else None,
        "forked_from": (project.forked_from or {}) if project is not None else {},
        "merged": (project.merged or {}) if project is not None else {},
        "question": project.question if project is not None else "",
        "kind": kind,
        "source_session_id": session.source_session_id,
        "source_run_id": session.source_run_id,
        "pinned_at": session.pinned_at,
        "archived_at": archived_at,
        "model_config_id": (
            project.model_config_id if project is not None else session.model_config_id
        ),
        "status": (
            project.status
            if project is not None
            else (active.status if active else "idle")
        ),
        "last_run_status": last.status if last else None,
        "active_run_id": active.id if active else None,
        "stage": project.stage if project is not None else None,
        "planned": bool(project.plan) if project is not None else False,
        "end_reason": project.end_reason if project is not None else "",
        "progress": progress,
        "created_at": session.created_at,
        "updated_at": project.updated_at if project is not None else session.updated_at,
        "capabilities": {
            "send": conversational and available,
            "coordinate": kind == "project_lead" and available,
            "rename": editable,
            "pin": kind != "artifact",
            "archive": kind not in {"project_lead", "artifact"}
            and not active
            and (
                project is None
                or (
                    project.status == "finished"
                    and project.stage == "done"
                    and not active_job
                )
            ),
            "delete": kind in {"chat", "project_chat", "paper"} and not active,
            "clone": conversational and not active and available,
            "compact": conversational and not active and available,
            "steer": conversational and bool(active) and available,
        },
    }


def session_page(d, workspace, search="", cursor="", limit=40, archived=False):
    """One stable page of project threads, including research-owned sessions."""
    saved_pin = func.coalesce(AgentSession.pinned_at, "")
    touched = case(
        (ResearchProject.id.is_not(None), ResearchProject.updated_at),
        else_=AgentSession.updated_at,
    )
    archived_clause = AgentSession.archived_at.is_not(None)
    if workspace.session_id:
        archived_clause = (
            or_(AgentSession.id == workspace.session_id, archived_clause)
            if workspace.archived
            else and_(AgentSession.id != workspace.session_id, archived_clause)
        )
    stmt = (
        select(AgentSession, ResearchProject)
        .outerjoin(
            ResearchProject,
            and_(
                ResearchProject.session_id == AgentSession.id,
                ResearchProject.owner == workspace.owner,
            ),
        )
        .where(
            AgentSession.owner == workspace.owner,
            or_(
                and_(
                    ResearchProject.id.is_(None),
                    AgentSession.workspace_id == workspace.id,
                ),
                ResearchProject.workspace_id == workspace.id,
            ),
            AgentSession.kind != "artifact",
            archived_clause if archived else ~archived_clause,
        )
    )
    if search.strip():
        stmt = stmt.where(
            or_(
                AgentSession.title.icontains(search.strip(), autoescape=True),
                ResearchProject.question.icontains(search.strip(), autoescape=True),
            )
        )
    if cursor:
        try:
            boundary = json.loads(
                base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            )
            if (
                not isinstance(boundary, list)
                or len(boundary) != 3
                or not all(isinstance(v, str) for v in boundary)
            ):
                raise ValueError
        except (ValueError, TypeError, UnicodeError):
            raise ValueError("会话分页位置不合法") from None
        stmt = stmt.where(tuple_(saved_pin, touched, AgentSession.id) < tuple(boundary))
    rows = list(
        d.execute(
            stmt.order_by(
                saved_pin.desc(), touched.desc(), AgentSession.id.desc()
            ).limit(limit + 1)
        )
    )
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page:
        session, project = page[-1]
        boundary = [
            session.pinned_at or "",
            project.updated_at if project else session.updated_at,
            session.id,
        ]
        next_cursor = (
            base64.urlsafe_b64encode(json.dumps(boundary).encode()).decode().rstrip("=")
        )
    return {
        "items": [
            session_out(d, session, project, workspace) for session, project in page
        ],
        "next_cursor": next_cursor,
    }


def search_sessions(d, owner, search="", cursor="", limit=8):
    touched = case(
        (ResearchProject.id.is_not(None), ResearchProject.updated_at),
        else_=AgentSession.updated_at,
    )
    workspace_id = case(
        (ResearchProject.id.is_not(None), ResearchProject.workspace_id),
        else_=AgentSession.workspace_id,
    )
    stmt = (
        select(AgentSession, ResearchProject, ResearchWorkspace)
        .outerjoin(
            ResearchProject,
            and_(
                ResearchProject.session_id == AgentSession.id,
                ResearchProject.owner == owner,
            ),
        )
        .join(ResearchWorkspace, ResearchWorkspace.id == workspace_id)
        .where(
            AgentSession.owner == owner,
            ResearchWorkspace.owner == owner,
            ResearchWorkspace.archived.is_(False),
            AgentSession.archived_at.is_(None),
            AgentSession.kind != "artifact",
        )
    )
    if search.strip():
        stmt = stmt.where(
            or_(
                AgentSession.title.icontains(search.strip(), autoescape=True),
                ResearchProject.question.icontains(search.strip(), autoescape=True),
                ResearchWorkspace.name.icontains(search.strip(), autoescape=True),
            )
        )
    if cursor:
        try:
            boundary = json.loads(
                base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            )
            if (
                not isinstance(boundary, list)
                or len(boundary) != 2
                or not all(isinstance(v, str) for v in boundary)
            ):
                raise ValueError
        except (ValueError, TypeError, UnicodeError):
            raise ValueError("会话分页位置不合法") from None
        stmt = stmt.where(tuple_(touched, AgentSession.id) < tuple(boundary))
    rows = list(
        d.execute(
            stmt.order_by(touched.desc(), AgentSession.id.desc()).limit(limit + 1)
        )
    )
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page:
        session, project, _workspace = page[-1]
        boundary = [project.updated_at if project else session.updated_at, session.id]
        next_cursor = (
            base64.urlsafe_b64encode(json.dumps(boundary).encode()).decode().rstrip("=")
        )
    return {
        "items": [
            session_out(d, session, project, workspace)
            | {"workspace_name": workspace.name}
            for session, project, workspace in page
        ],
        "next_cursor": next_cursor,
    }


def new_session(d, owner, workspace, title="新对话"):
    research_workspaces.lock_workspace(d, workspace)
    if workspace.owner != owner or workspace.archived:
        raise ValueError("项目不可用")
    title = title.strip()
    if not title or len(title) > 100:
        raise ValueError("会话名称不能为空或过长")
    session = AgentSession(
        owner=owner,
        workspace_id=workspace.id,
        title=title,
        kind="project_chat",
        model_config_id=workspace.model_config_id,
    )
    d.add(session)
    d.flush()
    return session


def lock_session(d, session):
    d.execute(
        update(AgentSession)
        .where(AgentSession.id == session.id)
        .values(updated_at=AgentSession.updated_at)
    )
    d.refresh(session)


def update_session(d, session, title=None, pinned=None, archived=None):
    item = session_out(d, session)
    if title is not None and (not item["capabilities"]["rename"] or not title.strip()):
        raise ValueError("这个会话不能改名，或名称为空")
    if pinned is not None and not item["capabilities"]["pin"]:
        raise ValueError("这个会话不能置顶")
    if archived is not None:
        if item["kind"] == "project_lead":
            raise ValueError("项目主会话跟随项目归档")
        if item["kind"] == "artifact":
            raise ValueError("请在阅读资料里管理这个会话")
        if archived and not item["capabilities"]["archive"]:
            raise ValueError("请先停止当前回答或等待研究结束，再归档会话")
    if title is not None:
        session.title = title.strip()
    if pinned is not None:
        session.pinned_at = now() if pinned else None
    if archived is not None:
        session.archived_at = now() if archived else None
    session.updated_at = now()
    return session


def _numbers(metrics):
    return "，".join(
        f"{k}={v:.4g}" if isinstance(v, float) else f"{k}={v}"
        for k, v in (metrics or {}).items()
        if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "step"
    )[:300]


def _job_line(job, settings=None):
    line = f"- 作业 {job.id} [{job.status}]"
    tag = str((job.config or {}).get("tag") or "")[:80]
    if tag:
        line += f" {tag}"
    numbers = _numbers(job.metrics)
    if job.status == "running" and settings is not None:
        from .research_sandbox import series

        points = series(settings, job)
        if points:
            numbers = f"进行到第 {points[-1].get('step', len(points))} 步：" + _numbers(
                points[-1]
            )
    if numbers:
        line += "：" + numbers
    return line + f"\n  命令：{job.command[:160]}"


def _research_part(d, project, settings=None, full=False):
    summary = research_workspaces.summary(d, project)
    lines = [
        f"### 研究 {project.id}：{project.question}",
        f"阶段 {project.stage}，状态 {project.status}"
        + (f"（{project.end_reason}）" if project.end_reason else "")
        + f"，已进行 {summary['rounds']} 轮"
        + (f"，{summary['waiting']} 件事等研究者决定" if summary["waiting"] else "")
        + (f"，{summary['working']} 正在工作" if summary["working"] else ""),
    ]
    if summary["best"]:
        lines.append(
            f"目前最好：{summary['best']['name']} = {summary['best']['value']}"
        )
    rounds = (
        select(ResearchSprint)
        .where(ResearchSprint.project_id == project.id, ResearchSprint.summary != "")
        .order_by(ResearchSprint.number.desc())
    )
    for s in d.scalars(rounds if full else rounds.limit(RECENT_ROUNDS)):
        lines.append(f"第 {s.number} 轮交接：{s.summary[:400]}")
    jobs = (
        select(ResearchJob)
        .where(ResearchJob.project_id == project.id)
        .order_by(ResearchJob.started_at.desc())
    )
    lines += [
        _job_line(j, settings)
        for j in d.scalars(jobs if full else jobs.limit(RECENT_JOBS))
    ]
    return "\n".join(lines)


def overview(d, workspace, settings=None):
    """Every research of the project as it stands now, in a few lines each."""
    parts = [f"# 项目：{workspace.name}"]
    if workspace.description:
        parts.append(workspace.description)
    if workspace.instructions:
        parts.append("## 项目说明\n" + workspace.instructions)
    researches = research_workspaces.researches(d, workspace)
    if not researches:
        parts.append("这个项目里还没有研究。")
    parts += [_research_part(d, p, settings) for p in researches]
    return "\n\n".join(parts)


def _owned_research(d, research, research_id):
    project = d.get(ResearchProject, research_id)
    workspace = d.get(ResearchWorkspace, research.get("workspace_id"))
    if (
        workspace is None
        or project is None
        or project.workspace_id != workspace.id
        or project.owner != workspace.owner
    ):
        raise ValueError("这个研究不在这个项目里")
    return project


def read_research(d, research, research_id, settings=None):
    """One research in full: its map, rounds and experiments."""
    project = _owned_research(d, research, research_id)
    return (
        _research_part(d, project, settings, full=True)
        + "\n\n## 研究地图\n"
        + research_map.snapshot(d, project)
    )


def job_of(d, research, job_id):
    job = d.get(ResearchJob, job_id)
    if job is None:
        raise ValueError("没有这个作业")
    _owned_research(d, research, job.project_id)
    return job


def context(d, workspace, settings=None):
    from . import research_memory, research_notes

    return (
        "## 项目现状（系统在你回答前刚读取的，可以直接引用；要细节再用工具查）\n"
        + overview(d, workspace, settings)
        + research_notes.context(d, workspace)
        + research_memory.context(d, workspace, settings)
    )


def _model(settings, owner, workspace, model_config_id, session=None):
    chosen = (
        model_config_id
        or (session.model_config_id if session is not None else "")
        or workspace.model_config_id
        or read_store(settings, owner).get("active_id")
        or ""
    )
    config = read_config(settings, owner, chosen)
    if not chosen or not config.get("model"):
        raise ValueError("请先添加并选择可用模型")
    return chosen, config["model"]


def start_research(
    settings, d, owner, workspace, question, background="", model_config_id=""
):
    from . import research_settings, research_stages

    research_workspaces.lock_workspace(d, workspace)
    question = (question or "").strip()
    if not question or len(question) > 2000 or len(background) > 20000:
        raise ValueError("研究问题或背景不合法")
    if workspace.owner != owner or workspace.archived:
        raise ValueError("项目不可用")
    model_id, _ = _model(settings, owner, workspace, model_config_id)
    cfg = read_config(settings, owner, model_id)
    if not cfg.get("api_key"):
        raise ValueError("请先添加并选择可用模型")
    from .research_locations import compute_for

    compute_id = compute_for(settings, workspace)
    research_settings.compute(settings, compute_id)
    project = research_map.create_project(d, owner, question, background, model_id)
    project.workspace_id = workspace.id
    d.get(AgentSession, project.session_id).workspace_id = workspace.id
    project.compute_id = compute_id
    project.spawned_by = "lead"
    project.stage = "scoping"
    research_stages.say(d, project, "lead", question)
    from .research_workflows import snapshot

    snapshot(d, project)
    return project


def message_research(d, research, research_id, text):
    from . import research_stages

    project = _owned_research(d, research, research_id)
    workspace = d.get(ResearchWorkspace, project.workspace_id)
    research_workspaces.lock_workspace(d, workspace)
    d.refresh(project)
    if workspace.archived:
        raise ValueError("请先恢复这个项目")
    text = (text or "").strip()
    if not text or len(text) > 8000:
        raise ValueError("消息不能为空或过长")
    if project.status == "finished":
        raise ValueError("研究已结束")
    research_stages.say(d, project, "lead", text)
    return project


def ask(settings, d, owner, session, workspace, text, model_config_id="", command=None):
    """One message of the researcher's, answered by a run that reads the project
    ("/compact": Pi summarizes the conversation so far instead)."""
    if (
        workspace.owner != owner
        or session.owner != owner
        or session.workspace_id != workspace.id
    ):
        raise ValueError("项目不可用")
    if session_kind(d, session, workspace=workspace) not in {
        "project_chat",
        "project_lead",
    }:
        raise ValueError("请在研究页面里发送消息")
    text = (text or "").strip()
    if not text:
        raise ValueError("说点什么吧")
    # Serialize admission on both SQLite and PostgreSQL before checking the queue.
    lock_session(d, session)
    research_workspaces.lock_workspace(d, workspace)
    if session.archived_at or workspace.archived:
        raise ValueError("请先恢复这个会话")
    busy = d.scalar(
        select(AgentRun).where(
            AgentRun.session_id == session.id,
            AgentRun.status.in_(["queued", "running"]),
        )
    )
    if busy is not None:
        raise ValueError("上一个问题还在回答")
    config_id, model = _model(settings, owner, workspace, model_config_id, session)
    lead = session.id == workspace.session_id
    # The conversation goes on with the model this message chose.
    session.model_config_id = config_id
    run = AgentRun(
        owner=owner,
        session_id=session.id,
        model_config_id=config_id,
        model=model,
        prompt=text[:8000],
        context=context(d, workspace, settings),
        writable=lead,
        runtime={
            "research": {
                "role": "lead" if lead else "chat",
                "workspace_id": workspace.id,
                **(
                    {"session_id": session.id, "model_config_id": config_id}
                    if lead
                    else {}
                ),
            },
            **(
                {
                    "command": "compact",
                    "instructions": text.removeprefix("/compact").strip(),
                }
                if command == "compact"
                else {}
            ),
        },
    )
    d.add(run)
    session.updated_at = now()
    return run


def start(settings, d, owner, workspace, text, model_config_id=""):
    session = new_session(
        d,
        owner,
        workspace,
        (text or "").strip().splitlines()[0][:100] if text.strip() else "新对话",
    )
    ask(settings, d, owner, session, workspace, text, model_config_id)
    return session


def chats(d, workspace):
    return list(
        d.scalars(
            select(AgentSession)
            .where(
                AgentSession.workspace_id == workspace.id,
                AgentSession.kind.not_in(["research", "artifact"]),
                AgentSession.archived_at.is_(None),
                (
                    AgentSession.id != workspace.session_id
                    if workspace.session_id
                    else True
                ),
            )
            .order_by(AgentSession.updated_at.desc())
            .limit(100)
        )
    )


def workspace_of(d, session):
    return (
        d.get(ResearchWorkspace, session.workspace_id) if session.workspace_id else None
    )


def clone(d, session):
    """A copy of a conversation to go on with apart: its terminal turns and
    its Pi session, so the copy remembers what the original did."""
    from .models import AgentSessionEntry

    lock_session(d, session)
    workspace = workspace_of(d, session)
    if workspace is not None:
        research_workspaces.lock_workspace(d, workspace)
    item = session_out(d, session)
    if not item["capabilities"]["clone"]:
        raise ValueError("请先停止当前回答或恢复会话，再复制")
    if workspace is not None and workspace.archived:
        raise ValueError("请先恢复这个项目")
    last_run = d.scalar(
        select(AgentRun.id)
        .where(
            AgentRun.session_id == session.id,
            AgentRun.status.in_(["completed", "failed", "cancelled"]),
        )
        .order_by(AgentRun.created_at.desc(), AgentRun.id.desc())
    )
    copy = AgentSession(
        owner=session.owner,
        title=(session.title + "（副本）")[:100],
        workspace_id=session.workspace_id,
        paper_id=session.paper_id,
        model_config_id=session.model_config_id,
        kind=(
            "project_chat"
            if session.workspace_id
            else ("paper" if session.paper_id else "chat")
        ),
        source_session_id=session.id,
        source_run_id=last_run,
    )
    d.add(copy)
    d.flush()
    for run in d.scalars(
        select(AgentRun)
        .where(
            AgentRun.session_id == session.id,
            AgentRun.status.in_(["completed", "failed", "cancelled"]),
        )
        .order_by(AgentRun.created_at, AgentRun.id)
    ):
        runtime = {
            key: deepcopy(value)
            for key, value in (run.runtime or {}).items()
            if key
            not in {
                "phase",
                "since",
                "settled",
                "stop_requested_at",
                "abort_confirmed",
                "stop_forced",
                "resume_from",
                "resumed_by",
            }
        }
        d.add(
            AgentRun(
                **{
                    c.name: getattr(run, c.name)
                    for c in AgentRun.__table__.columns
                    if c.name not in {"id", "session_id", "runtime"}
                },
                session_id=copy.id,
                runtime=runtime,
            )
        )
    for row in d.scalars(
        select(AgentSessionEntry)
        .where(AgentSessionEntry.session_id == session.id)
        .order_by(AgentSessionEntry.seq)
    ):
        d.add(AgentSessionEntry(session_id=copy.id, seq=row.seq, entry=row.entry))
    return copy
