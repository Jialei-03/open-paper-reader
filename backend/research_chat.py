"""Conversations inside a research project.

A project holds researches, which run on their own; a conversation is where
the researcher asks about them (how far has it got, what did ResNet do, is
the GPU busy) without touching them. The assistant there reads the project:
every research's map, rounds, experiments and their numbers, and job logs.
It cannot change anything, start anything or speak to a research's agents,
so asking never interrupts the work.

A conversation is an AgentSession with the project's id; each message is an
AgentRun whose runtime says {"research": {"role": "chat", "workspace_id"}}.
Its runs carry the session's earlier turns, unlike a research round's.
"""

from sqlalchemy import select

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


def _research_part(d, project, settings=None):
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
    rounds = list(
        d.scalars(
            select(ResearchSprint)
            .where(
                ResearchSprint.project_id == project.id, ResearchSprint.summary != ""
            )
            .order_by(ResearchSprint.number.desc())
            .limit(RECENT_ROUNDS)
        )
    )
    for s in rounds:
        lines.append(f"第 {s.number} 轮交接：{s.summary[:400]}")
    jobs = list(
        d.scalars(
            select(ResearchJob)
            .where(ResearchJob.project_id == project.id)
            .order_by(ResearchJob.started_at.desc())
            .limit(RECENT_JOBS)
        )
    )
    lines += [_job_line(j, settings) for j in jobs]
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
    if project is None or project.workspace_id != research.get("workspace_id"):
        raise ValueError("这个研究不在这个项目里")
    return project


def read_research(d, research, research_id, settings=None):
    """One research in full: its map, its last rounds, its experiments."""
    project = _owned_research(d, research, research_id)
    return (
        _research_part(d, project, settings)
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
    return (
        "## 项目现状（系统在你回答前刚读取的，可以直接引用；要细节再用工具查）\n"
        + overview(d, workspace, settings)
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


def ask(settings, d, owner, session, workspace, text, model_config_id="", command=None):
    """One message of the researcher's, answered by a run that reads the project
    ("/compact": Pi summarizes the conversation so far instead)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("说点什么吧")
    busy = d.scalar(
        select(AgentRun).where(
            AgentRun.session_id == session.id,
            AgentRun.status.in_(["queued", "running"]),
        )
    )
    if busy is not None:
        raise ValueError("上一个问题还在回答")
    config_id, model = _model(settings, owner, workspace, model_config_id, session)
    # The conversation goes on with the model this message chose.
    session.model_config_id = config_id
    run = AgentRun(
        owner=owner,
        session_id=session.id,
        model_config_id=config_id,
        model=model,
        prompt=text[:8000],
        context=context(d, workspace, settings),
        writable=False,
        runtime={
            "research": {"role": "chat", "workspace_id": workspace.id},
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
    session = AgentSession(
        owner=owner,
        title=(text or "").strip().splitlines()[0][:100] if text.strip() else "新对话",
        workspace_id=workspace.id,
    )
    d.add(session)
    d.flush()
    ask(settings, d, owner, session, workspace, text, model_config_id)
    return session


def chats(d, workspace):
    return list(
        d.scalars(
            select(AgentSession)
            .where(AgentSession.workspace_id == workspace.id)
            .order_by(AgentSession.updated_at.desc())
            .limit(100)
        )
    )


def workspace_of(d, session):
    return (
        d.get(ResearchWorkspace, session.workspace_id) if session.workspace_id else None
    )
