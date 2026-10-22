"""The research's conversation continues independently of its experiment loop."""

from sqlalchemy import func, select

from . import research_brief, research_map, research_stages
from .models import AgentRun, ResearchSprint, now
from .translation_settings import read_config


def post(settings, d, project, text):
    research_stages.say(d, project, "human", text)
    active = d.scalar(select(AgentRun.id).where(
        AgentRun.session_id == project.session_id,
        AgentRun.status.in_(("queued", "running")),
    ).limit(1))
    if active:
        return
    if project.stage == "scoping" and project.status != "finished":
        # Sending a message continues the discussion, never approves experiments.
        project.status = "active"
        return
    if project.status == "active":
        # Guidance reaches the next executor/advisor boundary.
        return
    answer(settings, d, project, text)


def answer(settings, d, project, text):
    """Queue an answer to recorded messages, without repeating their events."""
    cfg = read_config(settings, project.owner, project.model_config_id)
    if not cfg.get("model") or not cfg.get("api_key"):
        raise ValueError("请先选择可用模型")
    number = (d.scalar(select(func.max(ResearchSprint.number)).where(
        ResearchSprint.project_id == project.id,
    )) or 0) + 1
    sprint = ResearchSprint(project_id=project.id, number=number, role="discussion", run_id="")
    d.add(sprint)
    d.flush()
    brief = (
        f"# 当前研究\n{project.question}\n状态：{project.status} / {project.stage}\n"
        + research_map.snapshot(d, project)
        + "\n\n## 最近研究记录\n"
        + research_brief.scoping_brief(d, project, number, settings)
        + "\n\n本轮只回答研究者的提问。实验状态保持原样，不能批准计划、恢复实验或修改文件。"
    )
    run = AgentRun(
        owner=project.owner, session_id=project.session_id,
        model_config_id=project.model_config_id, model=cfg["model"],
        prompt=text.strip(), context=brief, writable=False, lane="research",
        runtime={"research": {
            "project_id": project.id, "sprint_id": sprint.id,
            "workspace_id": project.workspace_id, "role": "discussion",
        }},
    )
    d.add(run)
    d.flush()
    sprint.run_id = run.id
    research_map.event(d, project, None, "system", "sprint_planned", {
        "number": number, "role": "discussion",
    }, sprint.id)
    project.updated_at = now()


def settle(settings, maker):
    from . import research_chat, research_workspaces
    from .models import AgentSession, ResearchProject, ResearchWorkspace
    from .research_worker import _settle

    with maker() as d:
        ids = list(d.scalars(select(ResearchSprint.id).where(
            ResearchSprint.role == "discussion", ResearchSprint.status == "running",
        )))
    for id in ids:
        with maker() as d:
            sprint = d.get(ResearchSprint, id)
            project = d.get(ResearchProject, sprint.project_id)
            session = d.get(AgentSession, project.session_id)
            research_chat.lock_session(d, session)
            if project.workspace_id:
                workspace = d.get(ResearchWorkspace, project.workspace_id)
                research_workspaces.lock_workspace(d, workspace)
            d.refresh(project)
            d.refresh(sprint)
            if sprint.status == "running" and _settle(d, project, sprint):
                # Discussion must not snapshot another research's active files.
                waiting = research_stages.unanswered(d, project)
                if waiting and project.status in {"paused", "waiting", "finished"}:
                    answer(settings, d, project, "\n\n".join(waiting))
            d.commit()
