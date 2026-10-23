"""A team's message log and one durable inbox per member."""

import json
import re
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import or_, select, update

from .models import (
    AgentControl,
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
    TeamChannel,
    TeamDelivery,
    TeamMember,
    TeamMessage,
    now,
)

ROLES = {
    "human": ("研究者", "Researcher"),
    "advisor": ("导师", "Advisor"),
    "executor": ("执行者", "Executor"),
    "librarian": ("文献员", "Librarian"),
    "reviewer": ("评审", "Reviewer"),
    "writer": ("写手", "Writer"),
    "distiller": ("提炼者", "Distiller"),
}
CHANNELS = {
    "review": "综述",
    "experiments": "实验",
    "writing": "写作",
    "general": "闲聊",
}
ACTIVE = {"queued", "running"}


def normalize(text):
    return str(text or "").replace("\\n", "\n")


def stable(workspace, key):
    return str(uuid5(NAMESPACE_URL, f"ora-team:{workspace.id}:{key}"))


def ensure(d, workspace):
    # The workspace lock serializes lazy adoption and simultaneous sends.
    d.execute(
        update(ResearchWorkspace)
        .where(ResearchWorkspace.id == workspace.id)
        .values(updated_at=ResearchWorkspace.updated_at)
    )
    d.refresh(workspace)
    members = list(
        d.scalars(select(TeamMember).where(TeamMember.workspace_id == workspace.id))
    )
    if not members:
        for role, names in ROLES.items():
            member = TeamMember(
                id=stable(workspace, role),
                workspace_id=workspace.id,
                role=role,
                name=names[0],
            )
            if role != "human":
                session = AgentSession(
                    owner=workspace.owner,
                    workspace_id=workspace.id,
                    kind="team_member",
                    title=names[0],
                )
                d.add(session)
                d.flush()
                member.session_id = session.id
            d.add(member)
            members.append(member)
        d.flush()
        for key, name in CHANNELS.items():
            d.add(
                TeamChannel(
                    id=stable(workspace, key),
                    workspace_id=workspace.id,
                    key=key,
                    name=name,
                )
            )
        for member in members:
            if member.role != "human":
                d.add(
                    TeamChannel(
                        id=stable(workspace, f"dm:{member.role}"),
                        workspace_id=workspace.id,
                        key=f"dm:{member.role}",
                        name=member.name,
                        member_id=member.id,
                    )
                )
        d.flush()
    from .agent_files import discover_team, ensure_member
    from .team_workflows import adopt

    for member in members:
        ensure_member(member)
    discover_team(d, workspace, members)
    adopt(d, workspace)
    return members


def channel_of(d, workspace, channel_id):
    channel = d.get(TeamChannel, channel_id)
    if channel is None or channel.workspace_id != workspace.id:
        raise ValueError("频道不存在 / Channel not found")
    return channel


def root_of(d, workspace, channel, thread_id):
    if not thread_id:
        return None
    if thread_id.startswith("research:"):
        project = d.get(ResearchProject, thread_id[9:])
        if (
            project is None
            or project.workspace_id != workspace.id
            or project.owner != workspace.owner
            or channel.key != "experiments"
        ):
            raise ValueError("研究线程不存在 / Research thread not found")
        return project
    if thread_id.startswith(("legacy:", "legacy-user:")):
        run = d.get(AgentRun, thread_id.split(":", 1)[1])
        session = d.get(AgentSession, run.session_id) if run else None
        if (
            not session
            or session.workspace_id != workspace.id
            or session.owner != workspace.owner
            or session.kind not in {"project_lead", "project_chat"}
            or channel.key != "dm:advisor"
        ):
            raise ValueError("线程不存在 / Thread not found")
        human = thread_id.startswith("legacy-user:")
        return TeamMessage(
            id=thread_id,
            channel_id=channel.id,
            author_id=stable(workspace, "human" if human else "advisor"),
            text=run.prompt if human else run.response,
            kind="legacy",
            mentions=[],
            data={},
            created_at=run.created_at,
            thread_id=None,
        )
    root = d.get(TeamMessage, thread_id)
    if root is None or root.channel_id != channel.id or root.thread_id:
        raise ValueError("线程不存在 / Thread not found")
    return root


def active_run(d, member, statuses=ACTIVE):
    workspace = d.get(ResearchWorkspace, member.workspace_id)
    sessions = [member.session_id]
    if member.role == "advisor":
        sessions += [
            s.id
            for s in d.scalars(
                select(AgentSession).where(
                    AgentSession.workspace_id == workspace.id,
                    AgentSession.kind.in_(["project_lead", "project_chat"]),
                )
            )
        ]
    own = d.scalar(
        select(AgentRun)
        .where(AgentRun.session_id.in_(sessions), AgentRun.status.in_(statuses))
        .order_by(AgentRun.created_at)
    )
    if own:
        return own
    assigned = d.scalar(
        select(AgentRun)
        .where(
            AgentRun.owner == workspace.owner,
            AgentRun.status.in_(statuses),
            or_(
                AgentRun.runtime["team"]["member_id"].as_string() == member.id,
                AgentRun.runtime["research"]["member_id"].as_string() == member.id,
            ),
        )
        .order_by(AgentRun.created_at)
    )
    if assigned:
        return assigned
    roles = {
        "advisor": ["advisor", "scoping", "discussion", "review"],
        "executor": ["executor", "workflow"],
        "distiller": ["distiller"],
    }.get(member.role, [])
    return (
        d.scalar(
            select(AgentRun)
            .join(ResearchSprint, ResearchSprint.run_id == AgentRun.id)
            .join(ResearchProject, ResearchProject.id == ResearchSprint.project_id)
            .where(
                ResearchProject.workspace_id == workspace.id,
                ResearchSprint.role.in_(roles),
                AgentRun.status.in_(statuses),
            )
            .order_by(AgentRun.created_at)
        )
        if roles
        else None
    )


def mentions(d, workspace, text):
    found = []
    for member in ensure(d, workspace):
        names = {*ROLES.get(member.role, ()), member.role, member.name, member.id}
        if not member.enabled or member.deleted:
            continue
        positions = [
            match.start()
            for name in names
            if (
                match := re.search(
                    r"@" + re.escape(name) + r"(?![\w-])", text, re.IGNORECASE
                )
            )
        ]
        if positions:
            found.append((min(positions), member.id))
    return [identifier for _, identifier in sorted(found)]


def addressed(d, workspace, names, author=None):
    """Members an agent explicitly asks to act; names may carry a leading @."""
    found = []
    for name in names:
        found += mentions(d, workspace, "@" + str(name).strip().removeprefix("@"))
    return [i for i in dict.fromkeys(found) if i != getattr(author, "id", None)]


def language_part(d, workspace):
    from .research_map import researcher_language

    latest = d.scalar(
        select(TeamMessage)
        .join(TeamMember, TeamMember.id == TeamMessage.author_id)
        .where(TeamMessage.workspace_id == workspace.id, TeamMember.role == "human")
        .order_by(TeamMessage.created_at.desc(), TeamMessage.id.desc())
        .limit(1)
    )
    if researcher_language(latest.text if latest else workspace.name) == "zh":
        return "## 语言\n用中文写调用工具前的说明、回复、交接和记录。代码、变量名、论文标题和报错原文保留原样。\n\n"
    return "## Language\nWrite tool preambles, replies, handoffs and records in English. Preserve code, identifiers, paper titles and original errors.\n\n"


def post(
    d,
    workspace,
    channel,
    text,
    *,
    thread_id=None,
    author=None,
    mode="queue",
    relay=0,
    data=None,
    source_key=None,
    kind="text",
    trigger="message",
):
    if workspace.archived or channel.archived:
        raise ValueError("团队或频道已归档 / Team or channel archived")
    text = normalize(text).strip()
    if not text or len(text) > 12000:
        raise ValueError("消息为空或过长 / Empty or oversized message")
    root = root_of(d, workspace, channel, thread_id)
    members = ensure(d, workspace)
    author = author or next(m for m in members if m.role == "human")
    if author.workspace_id != workspace.id:
        raise ValueError("成员不属于团队 / Member outside team")
    tagged = mentions(d, workspace, text)
    message = TeamMessage(
        workspace_id=workspace.id,
        channel_id=channel.id,
        thread_id=thread_id,
        author_id=author.id,
        text=text,
        kind=kind,
        mentions=tagged,
        relay=relay,
        data={
            **(
                {"routing_scope": root.data["routing_scope"]}
                if isinstance(root, TeamMessage) and root.data.get("routing_scope")
                else {}
            ),
            **(data or {}),
        },
        source_key=source_key,
    )
    d.add(message)
    d.flush()
    from .team_workflows import route_message

    message.data = {**message.data, "mode": mode}
    route_message(d, workspace, message, trigger=trigger)
    workspace.updated_at = now()
    return message


def run_out(run):
    return {
        k: getattr(run, k)
        for k in (
            "id",
            "status",
            "response",
            "error",
            "steps",
            "runtime",
            "created_at",
            "updated_at",
        )
    }


def message_out(d, message):
    out = {
        k: getattr(message, k)
        for k in (
            "id",
            "channel_id",
            "thread_id",
            "author_id",
            "text",
            "kind",
            "mentions",
            "data",
            "created_at",
        )
    }
    out["text"] = normalize(out["text"])
    if message.kind == "sprint_reference":
        sprint = d.get(ResearchSprint, message.data.get("sprint_id"))
        out["text"] = normalize(sprint.summary) if sprint else ""
    if message.kind == "event_reference":
        event = d.get(ResearchEvent, message.data.get("event_id"))
        out["text"] = normalize(event.detail.get("text", "")) if event else ""
    run = (
        d.get(AgentRun, message.data.get("run_id"))
        if message.data.get("run_id")
        else None
    )
    if run:
        out["run"] = run_out(run)
        out["text"] = normalize(message.text or run.response)
        if (
            run.status not in ACTIVE
            and run.status != "cancelled"
            and not out["text"]
            and not run.error
            and not message.data.get("links")
        ):
            out["run"]["error"] = "成员未返回回答 / Member returned no answer"
            out["run"]["status"] = "failed"
            out["run"]["runtime"] = {**(run.runtime or {}), "no_answer": True}
    out["replies"] = len(
        list(
            d.scalars(select(TeamMessage.id).where(TeamMessage.thread_id == message.id))
        )
    )
    return out


def research_root(project, channel, d):
    inherited = project.inherited_history or {}
    sprints = {s["id"] for s in inherited.get("sprints", [])}
    sprints.update(
        d.scalars(
            select(ResearchSprint.id).where(ResearchSprint.project_id == project.id)
        )
    )
    events = [
        e
        for e in inherited.get("events", [])
        if e.get("action") == "message" and e.get("sprint_id") not in sprints
    ]
    messages = len(
        list(
            d.scalars(
                select(ResearchEvent.id).where(
                    ResearchEvent.project_id == project.id,
                    ResearchEvent.action == "message",
                    ResearchEvent.sprint_id.is_(None),
                )
            )
        )
    )
    replies = [
        m
        for m in d.scalars(
            select(TeamMessage).where(TeamMessage.thread_id == f"research:{project.id}")
        )
        if not m.data.get("research_forwarded")
    ]
    return dict(
        id=f"research:{project.id}",
        channel_id=channel.id,
        thread_id=None,
        author_id=None,
        text=project.question,
        kind="research",
        mentions=[],
        created_at=project.created_at,
        data={
            "research_id": project.id,
            "status": project.status,
            "title": project.title or project.question,
        },
        replies=len(sprints) + len(events) + messages + len(replies),
    )


def history(d, workspace, channel, thread_id=None):
    root = root_of(d, workspace, channel, thread_id)
    rows = [
        message_out(d, m)
        for m in d.scalars(
            select(TeamMessage)
            .where(
                TeamMessage.channel_id == channel.id, TeamMessage.thread_id == thread_id
            )
            .order_by(TeamMessage.created_at, TeamMessage.id)
        )
    ]
    if not thread_id and channel.key == "experiments":
        rows += [
            research_root(p, channel, d)
            for p in d.scalars(
                select(ResearchProject).where(
                    ResearchProject.workspace_id == workspace.id,
                    ResearchProject.owner == workspace.owner,
                )
            )
        ]
    if not thread_id and channel.key == "dm:advisor":
        sessions = select(AgentSession.id).where(
            AgentSession.workspace_id == workspace.id,
            AgentSession.kind.in_(["project_chat", "project_lead"]),
        )
        for run in d.scalars(
            select(AgentRun)
            .where(AgentRun.session_id.in_(sessions))
            .order_by(AgentRun.created_at)
        ):
            base = dict(
                channel_id=channel.id,
                thread_id=None,
                mentions=[],
                kind="legacy",
                data={},
                replies=0,
            )
            rows.append(
                dict(
                    base,
                    id=f"legacy-user:{run.id}",
                    author_id=stable(workspace, "human"),
                    text=normalize(run.prompt),
                    created_at=run.created_at,
                )
            )
            if run.response or run.error or run.status in ACTIVE:
                rows.append(
                    dict(
                        base,
                        id=f"legacy:{run.id}",
                        author_id=stable(workspace, "advisor"),
                        text=normalize(run.response or run.error),
                        created_at=run.updated_at,
                        run=run_out(run),
                    )
                )
    research = None
    if isinstance(root, ResearchProject):
        from .models import public
        from .research_map import nodes
        from .research_routes import job_out, node_out, project_out, sprint_out

        inherited = root.inherited_history or {}
        research = dict(
            project=project_out(root),
            events=[
                *inherited.get("events", []),
                *[
                    public(e)
                    for e in d.scalars(
                        select(ResearchEvent)
                        .where(ResearchEvent.project_id == root.id)
                        .order_by(ResearchEvent.created_at)
                    )
                ],
            ],
            sprints=[
                *inherited.get("sprints", []),
                *[
                    sprint_out(s)
                    for s in d.scalars(
                        select(ResearchSprint).where(
                            ResearchSprint.project_id == root.id
                        )
                    )
                ],
            ],
            jobs=[
                job_out(j)
                for j in d.scalars(
                    select(ResearchJob).where(ResearchJob.project_id == root.id)
                )
            ],
            nodes=[node_out(n) for n in nodes(d, root)],
        )
    return {
        "research": research,
        "messages": sorted(rows, key=lambda m: (m["created_at"], m["id"])),
        "root": (
            research_root(root, channel, d)
            if isinstance(root, ResearchProject)
            else message_out(d, root)
            if root
            else None
        ),
        "research_id": root.id if isinstance(root, ResearchProject) else None,
    }


def overview(d, workspace):
    members = ensure(d, workspace)
    channels = list(
        d.scalars(
            select(TeamChannel).where(
                TeamChannel.workspace_id == workspace.id,
                TeamChannel.archived.is_(False),
            )
        )
    )
    from .team_members import config, file_out

    queued = set(
        d.scalars(
            select(TeamDelivery.member_id).where(
                TeamDelivery.member_id.in_([member.id for member in members]),
                TeamDelivery.status == "queued",
            )
        )
    )
    statuses = []
    for member in members:
        run = (
            active_run(d, member, {"running"}) or active_run(d, member)
            if member.role != "human"
            else None
        )
        waiting = (
            member.role != "human"
            and member.max_tokens
            and member.tokens >= member.max_tokens
        )
        if member.role == "human":
            waiting = waiting or any(
                scope.get("waiting")
                for scope in workspace.workflow_state.get("threads", {}).values()
            )
        # A mention of the researcher is a notification; members wait on the
        # researcher only through team_wait_for_owner (thread scope above).
        if member.role == "advisor":
            from .research_workspaces import _open_requests

            waiting = waiting or any(
                _open_requests(d, p)
                for p in d.scalars(
                    select(ResearchProject).where(
                        ResearchProject.workspace_id == workspace.id
                    )
                )
            )
        statuses.append(
            dict(
                id=member.id,
                role=member.role,
                **config(member),
                **(file_out(member) if member.role != "human" else {}),
                library_id=member.library_id,
                builtin=member.role in ROLES,
                enabled=member.enabled and not member.deleted,
                deleted=member.deleted,
                overrides=member.overrides,
                subscriptions=member.subscriptions,
                status="working"
                if run and run.status == "running"
                else "waiting"
                if waiting
                else "queued"
                if run or member.id in queued
                else "idle",
                active_run_id=run.id if run else None,
                tokens=member.tokens,
                max_tokens=member.max_tokens,
            )
        )
    messages = list(
        d.scalars(
            select(TeamMessage)
            .where(TeamMessage.workspace_id == workspace.id)
            .order_by(TeamMessage.created_at)
        )
    )
    human = stable(workspace, "human")
    participating = {m.thread_id or m.id for m in messages if m.author_id == human}
    unread = []
    for channel in channels:
        count = 0
        for message in messages:
            if (
                message.channel_id != channel.id
                or message.author_id == human
                or message.data.get("read")
            ):
                continue
            count += 1
            if (
                human in message.mentions
                or message.thread_id in participating
                or channel.member_id
            ):
                unread.append(message_out(d, message))
        channel.unread_count = count
    from .team_budgets import limits, tokens

    return dict(
        workspace_id=workspace.id,
        workflow=workspace.workflow,
        runtime={
            "members": {m["id"]: m["status"] for m in statuses},
            "fired": [
                f
                for f in workspace.workflow_state.get("fired", [])
                if f["workflow"] == workspace.workflow["id"]
            ],
        },
        members=statuses,
        channels=[
            dict(
                id=c.id,
                key=c.key,
                name=c.name,
                member_id=c.member_id,
                unread=c.unread_count,
            )
            for c in channels
        ],
        notifications=unread[-100:],
        tokens=tokens(d, workspace=workspace),
        max_tokens=limits(workspace)["max_tokens"],
        budget=limits(workspace),
    )


def context(d, workspace, message):
    from .research_chat import context as project_context

    channel = channel_of(d, workspace, message.channel_id)
    recent = history(d, workspace, channel, message.thread_id)["messages"][-40:]
    board = []
    for c in d.scalars(
        select(TeamChannel).where(
            TeamChannel.workspace_id == workspace.id,
            TeamChannel.member_id.is_(None),
            TeamChannel.archived.is_(False),
        )
    ):
        tail = list(
            d.scalars(
                select(TeamMessage)
                .where(TeamMessage.channel_id == c.id)
                .order_by(TeamMessage.created_at.desc())
                .limit(4)
            )
        )
        board.append(
            {
                "channel_id": c.id,
                "name": c.name,
                "recent": [normalize(m.text)[-800:] for m in reversed(tail)],
            }
        )
    return (
        language_part(d, workspace)
        + project_context(d, workspace)[:16000]
        + "\n\nTeam blackboard:\n"
        + json.dumps(board, ensure_ascii=False)
        + "\n\nConversation (latest 40, bounded):\n"
        + json.dumps(recent, ensure_ascii=False, default=str)[-20000:]
        + f"\nChannel: {channel.id}; Thread: {message.thread_id or message.id}\n"
        + "Members: "
        + json.dumps(
            [
                {"id": m.id, "role": m.role, "name": m.name}
                for m in ensure(d, workspace)
            ],
            ensure_ascii=False,
        )
        + "\nTo have members act, name them in team_send_message's `to`;"
        " @Name in text only refers to them.\n"
    )


def dispatch(settings, d, workspace, delivery):
    member = d.get(TeamMember, delivery.member_id)
    message = d.get(TeamMessage, delivery.message_id)
    text = message_out(d, message)["text"]
    attachment_ids = [a["id"] for a in message.data.get("attachments", [])]
    for identifier in delivery.action.get("merged_messages", []):
        extra = d.get(TeamMessage, identifier)
        if extra:
            text += "\n\n" + extra.text
            attachment_ids.extend(a["id"] for a in extra.data.get("attachments", []))
    if delivery.action.get("instruction"):
        text += "\n\n" + delivery.action["instruction"]
    if delivery.status != "queued":
        return
    if not member.enabled or member.deleted:
        delivery.status, delivery.error = "cancelled", "成员已停用 / Member disabled"
        return
    run = active_run(d, member)
    if run:
        if delivery.mode == "immediate":
            control = AgentControl(
                owner=workspace.owner,
                session_id=run.session_id,
                run_id=run.id,
                client_id=f"team:{delivery.id}",
                kind="steer",
                text=text,
            )
            d.add(control)
            d.flush()
            delivery.run_id, delivery.control_id, delivery.status = (
                run.id,
                control.id,
                "steering",
            )
        return
    if workspace.archived:
        delivery.status, delivery.error = "cancelled", "团队已归档 / Team archived"
        return
    from .team_budgets import limits, notice, tokens, working

    budget = limits(workspace)
    reason = (
        "member_total_tokens"
        if member.max_tokens and member.tokens >= member.max_tokens
        else "team_tokens"
        if budget["max_tokens"]
        and tokens(d, workspace=workspace) >= budget["max_tokens"]
        else "concurrent"
        if budget["max_concurrent"]
        and working(d, workspace) >= budget["max_concurrent"]
        else None
    )
    if reason:
        notice(
            d, workspace, message, reason, source_key=f"budget:{delivery.id}:{reason}"
        )
        return
    channel = channel_of(d, workspace, message.channel_id)
    project = root_of(d, workspace, channel, message.thread_id)
    if isinstance(project, ResearchProject) and member.role in {
        "advisor",
        "executor",
        "distiller",
    }:
        from .research_dialogue import post as research_post

        author = d.get(TeamMember, message.author_id) if message.author_id else None
        pending = list((project.workflow_state or {}).get("pending_actions", []))
        project.workflow_state = {
            **(project.workflow_state or {}),
            "pending_actions": [*pending, delivery.action],
        }
        if member.role == "distiller":
            project.stage, project.status = "retrospective", "finished"
            message.data = {**message.data, "research_forwarded": True}
            delivery.status = "applied"
            return
        if author and author.role == "human":
            if (
                member.role == "executor"
                and project.stage == "experiments"
                and project.status in {"paused", "waiting"}
            ):
                project.status = "active"
            research_post(settings, d, project, text)
        else:
            from .research_dialogue import answer
            from .research_stages import say

            if message.kind not in {"event_reference", "sprint_reference"}:
                say(d, project, author.role if author else "system", text)
            if (
                project.status in {"paused", "waiting", "finished"}
                and member.role == "advisor"
            ):
                answer(settings, d, project, text)
        message.data = {**message.data, "research_forwarded": True}
        delivery.status = "applied"
        return
    from .research_chat import _model
    from .team_budgets import snapshot
    from .team_members import description

    chosen, model = _model(settings, workspace.owner, workspace, member.model_config_id)
    author = d.get(TeamMember, message.author_id) if message.author_id else None
    relay = 0
    language = language_part(d, workspace)
    team = dict(
        workspace_id=workspace.id,
        member_id=member.id,
        channel_id=channel.id,
        thread_id=message.thread_id or message.id,
        message_id=message.id,
        relay=relay,
        routing_scope=message.data.get("routing_scope")
        or [
            workspace.id,
            channel.id,
            delivery.action.get("thread", message.thread_id or message.id),
        ],
        **delivery.action,
    )
    message.data = {**message.data, "routing_scope": team["routing_scope"]}
    run = AgentRun(
        owner=workspace.owner,
        session_id=member.session_id,
        model_config_id=chosen,
        model=model,
        prompt=text,
        context=language
        + description(member)
        + "\n\n"
        + context(d, workspace, message).removeprefix(language),
        attachment_ids=list(dict.fromkeys(attachment_ids)),
        lane="research",
        runtime={"team": team, **snapshot(member)},
    )
    d.add(run)
    d.flush()
    delivery.run_id, delivery.status = run.id, "running"
    response = TeamMessage(
        workspace_id=workspace.id,
        channel_id=channel.id,
        thread_id=team["thread_id"],
        author_id=member.id,
        data={
            "run_id": run.id,
            **{
                k: delivery.action[k]
                for k in ("rule", "workflow", "workflow_version")
                if k in delivery.action
            },
        },
        source_key=f"run:{run.id}",
        relay=relay,
    )
    d.add(response)
    d.flush()


def settle(settings, maker):
    with maker() as d:
        ids = list(
            d.scalars(
                select(ResearchWorkspace.id).where(
                    ResearchWorkspace.archived.is_(False)
                )
            )
        )
    for identifier in ids:
        with maker() as d:
            workspace = d.get(ResearchWorkspace, identifier)
            ensure(d, workspace)
            for delivery in d.scalars(
                select(TeamDelivery)
                .join(TeamMember)
                .where(TeamMember.workspace_id == identifier)
                .order_by(TeamDelivery.created_at, TeamDelivery.id)
            ):
                if delivery.status == "steering":
                    control = d.get(AgentControl, delivery.control_id)
                    run = d.get(AgentRun, delivery.run_id)
                    if control.status == "rejected":
                        delivery.status, delivery.error = control.status, control.error
                    elif control.status == "applied" and run.status not in ACTIVE:
                        delivery.status = "applied"
                        incoming = d.get(TeamMessage, delivery.message_id)
                        origin = (run.runtime or {}).get("team") or {}
                        if (origin.get("channel_id"), origin.get("thread_id")) != (
                            incoming.channel_id,
                            incoming.thread_id,
                        ):
                            d.add(
                                TeamMessage(
                                    workspace_id=workspace.id,
                                    channel_id=incoming.channel_id,
                                    thread_id=incoming.thread_id or incoming.id,
                                    author_id=delivery.member_id,
                                    data={"run_id": run.id},
                                    source_key=f"steer:{delivery.id}",
                                )
                            )
                elif delivery.status == "running":
                    run = d.get(AgentRun, delivery.run_id)
                    if run.status not in ACTIVE:
                        delivery.status = (
                            "applied"
                            if run.status == "completed"
                            else "cancelled"
                            if run.status == "cancelled"
                            else "failed"
                        )
                        delivery.error = run.error
                        response = d.scalar(
                            select(TeamMessage).where(
                                TeamMessage.source_key == f"run:{run.id}"
                            )
                        )
                        if response:
                            # The placeholder becomes a reply at the run's terminal time.
                            response.created_at = run.updated_at
                            response.data = {**response.data, "read": False}
                            if run.runtime.get("time_limit_reached") or run.runtime.get(
                                "budget_limit"
                            ):
                                response.mentions = list(
                                    dict.fromkeys(
                                        [*response.mentions, stable(workspace, "human")]
                                    )
                                )
                            from .team_workspace import seal

                            try:
                                seal(settings, workspace, run, response)
                            except (ValueError, OSError, RuntimeError) as error:
                                response.data = {
                                    **response.data,
                                    "file_error": str(error)[:500],
                                }
                        if run.status == "completed" and response:
                            response.text = response.text or normalize(run.response)
                            response.mentions = mentions(d, workspace, response.text)
                            response.data = {
                                **response.data,
                                "routing_scope": run.runtime["team"].get(
                                    "routing_scope"
                                ),
                            }
                            from .team_workflows import route_message

                            if response.text and not response.data.get("routed"):
                                route_message(
                                    d,
                                    workspace,
                                    response,
                                    trigger=response.data.get("trigger", "message"),
                                )
            # Posts are messages too. Persist a pending event marker and consume
            # one durable batch per tick so post -> post rules cannot recurse.
            pending_posts = list(
                d.scalars(
                    select(TeamMessage)
                    .where(
                        TeamMessage.workspace_id == identifier,
                        TeamMessage.data["rule_event_pending"].as_boolean().is_(True),
                    )
                    .order_by(TeamMessage.created_at, TeamMessage.id)
                )
            )
            for posted in pending_posts:
                from .team_workflows import route_message

                posted.data = {**posted.data, "rule_event_pending": False}
                posted.mentions = mentions(d, workspace, posted.text)
                route_message(d, workspace, posted)
            d.flush()
            for delivery in d.scalars(
                select(TeamDelivery)
                .join(TeamMember)
                .where(
                    TeamMember.workspace_id == identifier,
                    TeamDelivery.status == "queued",
                )
                .order_by(TeamDelivery.created_at, TeamDelivery.id)
            ):
                try:
                    dispatch(settings, d, workspace, delivery)
                except ValueError as error:
                    delivery.status, delivery.error = "failed", str(error)[:500]
            research_mentions(d, workspace)
            notify_jobs(d, workspace)
            d.commit()


def notify_jobs(d, workspace):
    channel = d.scalar(
        select(TeamChannel).where(
            TeamChannel.workspace_id == workspace.id, TeamChannel.key == "experiments"
        )
    )
    for job in d.scalars(
        select(ResearchJob)
        .join(ResearchProject)
        .where(
            ResearchProject.workspace_id == workspace.id,
            ResearchJob.status.not_in(["queued", "running"]),
            ResearchJob.finished_at
            > workspace.workflow_state.get(
                "job_notifications_after", workspace.created_at
            ),
        )
    ):
        key = f"job:{job.id}"
        if not d.scalar(select(TeamMessage.id).where(TeamMessage.source_key == key)):
            message = TeamMessage(
                workspace_id=workspace.id,
                channel_id=channel.id,
                thread_id=f"research:{job.project_id}",
                kind="job",
                text=f"{job.command}\n{job.status} · exit {job.exit_code}",
                data={
                    "job_id": job.id,
                    "status": job.status,
                    "metrics": job.metrics,
                },
                source_key=key,
            )
            d.add(message)
            d.flush()
            # Native research job continuation is consumed once by the worker,
            # after all waiting_on jobs finish. The message is still published now.
            from .research_workflows import is_native

            project = d.get(ResearchProject, job.project_id)
            if not is_native(project):
                from .team_workflows import event

                event(d, workspace, message, trigger="job_finished", kind="result")
            else:
                latest = d.scalar(
                    select(ResearchSprint)
                    .where(ResearchSprint.project_id == project.id)
                    .order_by(ResearchSprint.number.desc())
                    .limit(1)
                )
                # waiting_on is one continuation barrier: the worker emits its
                # job_finished event after the whole group completes. Other jobs
                # publish their own event here, even if a later round is active.
                if not latest or job.id not in (latest.waiting_on or []):
                    from .team_workflows import provenance, research_event

                    pending = list(
                        (project.workflow_state or {}).get("pending_actions", [])
                    )
                    actions = research_event(d, project, "job_finished", kind="result")
                    project.workflow_state = {
                        **project.workflow_state,
                        "pending_actions": [
                            *pending,
                            *project.workflow_state.get("pending_actions", []),
                        ],
                    }
                    if actions:
                        message.data = {
                            **message.data,
                            **provenance(project.workflow, actions[0]),
                        }


def charge(maker, team, tokens):
    if tokens <= 0:
        return
    with maker() as d:
        d.execute(
            update(TeamMember)
            .where(TeamMember.id == team["member_id"])
            .values(tokens=TeamMember.tokens + tokens)
        )
        d.commit()


def available(d, project, role):
    if not project.workspace_id:
        return True
    members = ensure(d, d.get(ResearchWorkspace, project.workspace_id))
    role = {
        "scoping": "advisor",
        "discussion": "advisor",
        "workflow": "executor",
        "review": "advisor",
    }.get(role, role)
    member = next((m for m in members if m.role == role), None)
    from .team_budgets import limits, notice, tokens, working

    workspace = d.get(ResearchWorkspace, project.workspace_id)
    budget = limits(workspace)
    if member is None:
        return True
    if not member.enabled or member.deleted or active_run(d, member):
        return False
    reason = (
        "member_total_tokens"
        if member.max_tokens and member.tokens >= member.max_tokens
        else "team_tokens"
        if budget["max_tokens"]
        and tokens(d, workspace=workspace) >= budget["max_tokens"]
        else "concurrent"
        if budget["max_concurrent"]
        and working(d, workspace) >= budget["max_concurrent"]
        else None
    )
    if reason:
        from types import SimpleNamespace

        latest = d.scalar(
            select(ResearchSprint.id)
            .where(ResearchSprint.project_id == project.id)
            .order_by(ResearchSprint.number.desc())
            .limit(1)
        )
        notice(
            d,
            workspace,
            SimpleNamespace(
                channel_id=stable(workspace, "experiments"),
                thread_id=f"research:{project.id}",
            ),
            reason,
            source_key=f"budget:research:{latest or project.id}:{reason}",
        )
    return reason is None


def research_context(d, research, owner):
    project = d.get(ResearchProject, research.get("project_id"))
    if not project or project.owner != owner or not project.workspace_id:
        return None
    workspace = d.get(ResearchWorkspace, project.workspace_id)
    if not workspace or workspace.owner != owner or workspace.archived:
        return None
    role = {
        "scoping": "advisor",
        "discussion": "advisor",
        "workflow": "executor",
        "review": "advisor",
    }.get(research.get("role"), research.get("role"))
    member = (
        d.get(TeamMember, research.get("member_id"))
        if research.get("member_id")
        else next((m for m in ensure(d, workspace) if m.role == role), None)
    )
    if not member:
        return None
    return dict(
        workspace_id=workspace.id,
        member_id=member.id,
        channel_id=stable(workspace, "experiments"),
        thread_id=f"research:{project.id}",
        relay=0,
        research_round=True,
    )


def research_mentions(d, workspace):
    channel = d.get(TeamChannel, stable(workspace, "experiments"))
    events = d.scalars(
        select(ResearchEvent)
        .join(ResearchProject)
        .where(
            ResearchProject.workspace_id == workspace.id,
            ResearchEvent.created_at >= channel.created_at,
            ResearchEvent.action == "message",
            ResearchEvent.actor.not_in(["human", "system", "lead"]),
        )
        .order_by(ResearchEvent.created_at, ResearchEvent.id)
    )
    for event in events:
        key = f"research-event:{event.id}"
        if d.scalar(select(TeamMessage.id).where(TeamMessage.source_key == key)):
            continue
        text = normalize(event.detail.get("text", ""))
        tagged = mentions(d, workspace, text)
        role = {
            "scoping": "advisor",
            "discussion": "advisor",
            "workflow": "executor",
            "review": "advisor",
        }.get(event.actor, event.actor)
        if not tagged or role not in ROLES:
            continue
        member = d.get(TeamMember, stable(workspace, role))
        thread_id = f"research:{event.project_id}"
        reference = post(
            d,
            workspace,
            channel,
            text,
            author=member,
            thread_id=thread_id,
            data={"event_id": event.id, "research_forwarded": True},
            source_key=key,
        )
        reference.kind, reference.text = "event_reference", ""
        d.flush()

    spoken = select(ResearchEvent.sprint_id).where(
        ResearchEvent.action == "message",
        ResearchEvent.actor.not_in(["human", "system"]),
        ResearchEvent.sprint_id.is_not(None),
    )
    for sprint in d.scalars(
        select(ResearchSprint)
        .join(ResearchProject)
        .where(
            ResearchProject.workspace_id == workspace.id,
            ResearchSprint.created_at >= channel.created_at,
            ResearchSprint.status != "running",
            ResearchSprint.id.not_in(spoken),
        )
    ):
        key = f"research-sprint:{sprint.id}"
        role = {
            "scoping": "advisor",
            "discussion": "advisor",
            "workflow": "executor",
            "review": "advisor",
        }.get(sprint.role, sprint.role)
        text = normalize(sprint.summary)
        if (
            role not in ROLES
            or not mentions(d, workspace, text)
            or d.scalar(select(TeamMessage.id).where(TeamMessage.source_key == key))
        ):
            continue
        thread_id = f"research:{sprint.project_id}"
        reference = post(
            d,
            workspace,
            channel,
            text,
            author=d.get(TeamMember, stable(workspace, role)),
            thread_id=thread_id,
            data={
                "sprint_id": sprint.id,
                "research_forwarded": True,
                **(
                    (d.get(AgentRun, sprint.run_id).runtime or {}).get("rule", {})
                    if d.get(AgentRun, sprint.run_id)
                    else {}
                ),
            },
            source_key=key,
        )
        reference.kind, reference.text = "sprint_reference", ""
        d.flush()


def comparison_members(d, projects):
    """Count each adapted research turn and each native team message once."""
    from collections import Counter

    from .models import ModelUsage

    result = {}
    roles = {
        "scoping": "advisor",
        "discussion": "advisor",
        "workflow": "executor",
        "review": "advisor",
        "lead": "advisor",
    }
    for project in projects:
        if not project.workspace_id:
            continue
        workspace = d.get(ResearchWorkspace, project.workspace_id)
        members = ensure(d, workspace)
        counts, tokens = Counter(), Counter()
        sprint_ids = set()
        message_events = list(
            d.scalars(
                select(ResearchEvent).where(
                    ResearchEvent.project_id == project.id,
                    ResearchEvent.action == "message",
                )
            )
        )
        spoken = Counter(
            e.sprint_id for e in message_events if e.actor != "system" and e.sprint_id
        )
        for sprint in d.scalars(
            select(ResearchSprint).where(ResearchSprint.project_id == project.id)
        ):
            sprint_ids.add(sprint.id)
            run = d.get(AgentRun, sprint.run_id)
            identifier = (
                (run.runtime or {}).get("research", {}).get("member_id")
                if run
                else None
            ) or stable(workspace, roles.get(sprint.role, sprint.role))
            tokens[identifier] += sprint.tokens
            if sprint.summary or sprint.status != "running":
                counts[identifier] += 1
        for e in d.scalars(
            select(ResearchEvent).where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "message",
            )
        ):
            if e.actor == "system" or e.sprint_id in sprint_ids:
                continue
            counts[stable(workspace, roles.get(e.actor, e.actor))] += 1
        seen_runs = set()
        for message in d.scalars(
            select(TeamMessage).where(
                TeamMessage.thread_id == f"research:{project.id}",
                TeamMessage.workspace_id == workspace.id,
            )
        ):
            if (
                not message.author_id
                or message.data.get("research_forwarded")
                or message.kind in {"event_reference", "sprint_reference"}
            ):
                continue
            run_id = message.data.get("run_id")
            if run_id and run_id in seen_runs:
                continue
            counts[message.author_id] += 1
            if run_id:
                seen_runs.add(run_id)
                tokens[message.author_id] += sum(
                    u.total_tokens or 0
                    for u in d.scalars(
                        select(ModelUsage).where(ModelUsage.task_id == run_id)
                    )
                )
        result[project.id] = [
            {
                "id": m.id,
                "name": m.name,
                "messages": counts[m.id],
                "tokens": tokens[m.id],
            }
            for m in members
            if counts[m.id] or tokens[m.id]
        ]
    return result
