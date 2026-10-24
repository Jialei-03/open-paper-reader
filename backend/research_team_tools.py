"""Member capabilities, scoped to the team that admitted the run."""

import asyncio

from sqlalchemy import select

from . import research_team as team
from .models import AgentRun, ResearchWorkspace, TeamMember, TeamMessage
from .tool_spec import LABELS, tool

LABELS.update(
    team_send_message="发消息",
    team_read_channel="读频道",
    team_read_thread="读线程",
    team_overview="读团队",
    team_review_result="提交评审",
    team_wait_for_owner="等负责人",
    team_search_papers="学术检索",
    team_import_paper="导入论文",
)
TEXT = {"type": "string", "maxLength": 12000}
TEAM_TOOLS = [
    tool(
        "team_search_papers",
        "Search arXiv, OpenAlex and Semantic Scholar by keywords. Returns titles, authors, years, abstracts, links, citation counts and import IDs. Network failures are explicit.",
        {
            "query": {"type": "string", "maxLength": 300},
            "source": {
                "type": "string",
                "enum": ["all", "arxiv", "openalex", "semantic_scholar"],
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        ["query"],
    ),
    tool(
        "team_import_paper",
        "Import one search result into the researcher's library, including its metadata. Uses the id returned by team_search_papers.",
        {"id": {"type": "string"}},
        ["id"],
        write=True,
    ),
    tool(
        "team_wait_for_owner",
        "Ask the owner a question that requires their decision and pause this thread until they reply.",
        {"text": TEXT},
        ["text"],
        write=True,
    ),
    tool(
        "team_send_message",
        "Send a message to a channel or thread in this team. `wake`: members who must now do more work on it; they are woken. Leave `wake` empty when you report results or answer. @Name in text only refers to someone. Omit channel_id/thread_id to reply here. Set also_channel=true to share a thread conclusion in its channel too.",
        {
            "text": TEXT,
            "wake": {"type": "array", "items": {"type": "string"}},
            # Older agent files still say `to`.
            "to": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Same as wake.",
            },
            "kind": {
                "type": "string",
                "enum": ["text", "result", "plan", "conclusion", "draft", "review"],
            },
            "channel_id": {"type": "string"},
            "thread_id": {"type": "string"},
            "also_channel": {"type": "boolean"},
        },
        ["text"],
        write=True,
    ),
    tool(
        "team_review_result",
        "Return the result of the review that woke this member. One result per review run.",
        {"pass": {"type": "boolean"}, "notes": TEXT},
        ["pass", "notes"],
        write=True,
    ),
    tool(
        "team_read_channel",
        "Read recent messages in a team channel.",
        {"channel_id": {"type": "string"}},
        ["channel_id"],
    ),
    tool(
        "team_read_thread",
        "Read a thread, including its research map and rounds.",
        {"channel_id": {"type": "string"}, "thread_id": {"type": "string"}},
        ["channel_id", "thread_id"],
    ),
    tool("team_overview", "Read team members, channels, research and budgets."),
]

for spec in TEAM_TOOLS:
    spec["team"] = True


def definitions(role, all_tools, member=None):
    from .agent_worker import PI_NAMES, RESEARCH_BASE

    names = (
        {t["name"] for t in TEAM_TOOLS}
        | RESEARCH_BASE
        | {"project_overview", "research_read"}
    )
    if role in {"advisor", "executor"} or role.startswith("custom_"):
        names |= {"start_research", "message_research"}
    names |= (
        PI_NAMES
        if role in {"executor", "writer"} or role.startswith("custom_")
        else {"read", "ls", "find", "grep"}
    )
    if member and member.permissions:
        names |= PI_NAMES | {"start_research", "message_research"}
    from .team_members import allowed

    return [
        t
        for t in all_tools
        if t["name"] in names and (member is None or allowed(member, t))
    ]


def _call(app, owner, info, name, args):
    from .research_chat import overview, read_research

    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, info["workspace_id"])
        member = d.get(TeamMember, info["member_id"])
        if (
            workspace is None
            or workspace.owner != owner
            or member is None
            or member.workspace_id != workspace.id
            or workspace.archived
        ):
            raise ValueError("团队不可用 / Team unavailable")
        team.ensure(d, workspace)
        channel = team.channel_of(
            d, workspace, args.get("channel_id") or info["channel_id"]
        )
        thread_id = args.get("thread_id")
        if name == "team_search_papers":
            from .academic_search import search
            from .models import DiscoveryCandidate
            from .recommendations import primary_key

            result = search(
                args["query"], args.get("source", "all"), args.get("limit", 10)
            )
            for paper in result["papers"]:
                key = primary_key(paper) or paper["url"]
                candidate = d.scalar(
                    select(DiscoveryCandidate).where(
                        DiscoveryCandidate.owner == owner,
                        DiscoveryCandidate.external_id == key,
                    )
                )
                if candidate is None:
                    candidate = DiscoveryCandidate(
                        owner=owner, external_id=key, data=paper
                    )
                    d.add(candidate)
                else:
                    candidate.data = {**candidate.data, **paper}
                d.flush()
                paper["id"] = candidate.id
            d.commit()
            return result
        if name == "team_review_result":
            if info.get("action") != "review" or not isinstance(args.get("pass"), bool):
                raise ValueError("没有待提交的评审 / No pending review")
            key = f"review:{info['run_id']}"
            prior = d.scalar(select(TeamMessage).where(TeamMessage.source_key == key))
            if prior:
                return {"message_id": prior.id}
            response = d.scalar(
                select(TeamMessage).where(
                    TeamMessage.source_key == f"run:{info['run_id']}"
                )
            )
            if response:
                if response.data.get("review_run_id"):
                    return {"message_id": response.id}
                response.text, response.kind = args["notes"], "review"
                response.data = {
                    **response.data,
                    "routing_scope": info.get("routing_scope"),
                    "review_run_id": info["run_id"],
                    "passed": args["pass"],
                    "routed": True,
                }
                response.mentions = team.mentions(d, workspace, response.text)
                from .team_workflows import route_message

                route_message(
                    d,
                    workspace,
                    response,
                    trigger="message" if args["pass"] else "review_failed",
                )
                d.commit()
                return {"message_id": response.id}
            message = team.post(
                d,
                workspace,
                channel,
                args["notes"],
                thread_id=info.get("thread_id"),
                author=member,
                kind="review",
                trigger="message" if args["pass"] else "review_failed",
                source_key=key,
                data={"review_run_id": info["run_id"], "passed": args["pass"]},
            )
            d.commit()
            return {"message_id": message.id}
        if name in {"team_send_message", "team_wait_for_owner"}:
            thread_id = (
                thread_id
                if "thread_id" in args
                else (
                    info.get("thread_id") if channel.id == info["channel_id"] else None
                )
            )
            text = team.normalize(args["text"]).strip()
            also_channel = name == "team_send_message" and args.get(
                "also_channel", False
            )
            if also_channel:
                team.validate_broadcast(channel, thread_id)
            if not text or len(text) > 12000:
                raise ValueError("消息为空或过长 / Empty or oversized message")
            response = d.scalar(
                select(TeamMessage).where(
                    TeamMessage.source_key == f"run:{info['run_id']}"
                )
            )
            kind = (
                "conclusion"
                if name == "team_wait_for_owner"
                else args.get("kind", "text")
            )
            # `to` is the former name of `wake`.
            to = [
                i
                for i in team.addressed(
                    d, workspace, args.get("wake") or args.get("to") or [], member
                )
                if d.get(TeamMember, i).role != "human"
            ]
            paused = [
                d.get(TeamMember, i).name for i in to if d.get(TeamMember, i).paused
            ]
            if paused:
                raise ValueError(
                    "、".join(paused) + " 暂停中 / " + ", ".join(paused) + " is paused"
                )
            if response and (channel.id, thread_id) == (
                info["channel_id"],
                info.get("thread_id"),
            ):
                response.text = text
                response.kind = kind
                response.data = {
                    **response.data,
                    "routing_scope": info.get("routing_scope"),
                    "waiting": name == "team_wait_for_owner",
                    "to": list(dict.fromkeys([*response.data.get("to", []), *to])),
                }
                if name == "team_wait_for_owner":
                    response.mentions = []
                    from .team_workflows import route_message

                    route_message(d, workspace, response, trigger="conclusion_proposed")
                    response.data = {**response.data, "routed": True}
                if also_channel:
                    team.broadcast_reply(d, workspace, channel, response)
                d.commit()
                return {"message_id": response.id}
            message = team.post(
                d,
                workspace,
                channel,
                args["text"],
                thread_id=thread_id,
                author=member,
                kind=kind,
                also_channel=also_channel,
                data={
                    "routing_scope": info.get("routing_scope"),
                    "waiting": name == "team_wait_for_owner",
                    "to": to,
                },
            )
            if response and (channel.id, thread_id) != (
                info["channel_id"],
                info.get("thread_id"),
            ):
                links = list(response.data.get("links", []))
                links.append(
                    {
                        "channel_id": channel.id,
                        "thread_id": message.thread_id or message.id,
                        "name": channel.name,
                    }
                )
                response.data = {**response.data, "links": links, "routed": True}
            d.commit()
            return {"message_id": message.id}
        if name == "team_overview":
            result = team.overview(d, workspace, include_reminders=False) | {
                "research": overview(d, workspace, app.state.settings)
            }
            for message in result["notifications"]:
                message.pop("reactions", None)
            return result
        result = team.history(
            d, workspace, channel, thread_id if name == "team_read_thread" else None
        )
        result["messages"] = result["messages"][-50:]
        # Reactions are researcher UI state; only +/- feedback enters member context.
        for message in [
            *result["messages"], *result.get("activity", []), result.get("root")
        ]:
            if message:
                message.pop("reactions", None)
        if result["research_id"]:
            result["research"] = read_research(
                d,
                {"workspace_id": workspace.id},
                result["research_id"],
                app.state.settings,
            )
        return result


async def execute(app, owner, run_id, name, args):
    from .agent_tools import PI_NAMES, TOOLS

    with app.state.maker() as d:
        run = d.get(AgentRun, run_id)
        info = (run.runtime or {}).get("team") if run else None
        if not info:
            if name.startswith("team_"):
                raise ValueError(
                    "团队工具只能由团队成员调用 / Team tools require a member"
                )
            return False, None
        if run.owner != owner or run.status != "running":
            raise ValueError("成员不能调用这个工具 / Tool unavailable to member")
        from . import team_members

        member = d.get(TeamMember, info["member_id"])
        if info.get("research_round"):
            from .agent_worker import research_tools

            research = run.runtime.get("research") or {}
            specs = [*research_tools(research.get("role", "executor")), *TEAM_TOOLS]
        else:
            specs = definitions(member.role, TOOLS, member) if member else []
        spec = next((t for t in specs if t["name"] == name), None)
        try:
            if not member or not spec or not team_members.allowed(member, spec):
                raise ValueError(
                    "成员不能调用这个工具 / Tool unavailable to member: permission denied"
                )
            if name in PI_NAMES | {"run_job", "stop_job"}:
                team_members.check_machine(app.state.settings, d, member, info)
        except ValueError as error:
            if member:
                team_members.audit_denial(d, run, member, name, str(error))
            raise
        if info.get("research_round") and not name.startswith("team_"):
            return False, None
    if name == "team_import_paper":
        from .agent_tools import execute as library_tool
        from .models import DiscoveryCandidate, Paper

        with app.state.maker() as d:
            candidate = d.get(DiscoveryCandidate, args["id"])
            if candidate is None or candidate.owner != owner:
                raise ValueError("检索结果不存在 / Search result not found")
            item = candidate.data
            prior = d.scalar(
                select(Paper).where(
                    Paper.owner == owner, Paper.external_id == candidate.external_id
                )
            )
            if prior:
                return True, {"id": prior.id, "title": prior.title}
            values = {
                "title": item["title"],
                "authors": "; ".join(item.get("authors") or []),
                "abstract": item.get("abstract") or "",
                "external_id": candidate.external_id,
            }
        result = await library_tool(
            app,
            owner,
            run.session_id,
            "create_paper",
            values,
            "team-import:" + candidate.id,
        )
        from .paper_metadata import PaperMetadata

        with app.state.maker() as d:
            if not d.get(PaperMetadata, result["id"]):
                d.add(PaperMetadata(paper_id=result["id"], owner=owner, data=item))
                d.commit()
        return True, result
    if name.startswith("team_"):
        return True, await asyncio.to_thread(
            _call, app, owner, {**info, "run_id": run_id}, name, args
        )
    if name in PI_NAMES:

        def files():
            from .research_host import _check, _tools

            with app.state.maker() as d:
                workspace = d.get(ResearchWorkspace, info["workspace_id"])
                if workspace is None or workspace.owner != owner or workspace.archived:
                    raise ValueError("团队不可用 / Team unavailable")
                from .research_repo import _locked, home
                from .team_workspace import workdir

                path = workdir(app.state.settings, workspace)
                _check(name, args)
                with _locked(home(app.state.settings, workspace.id)):
                    return _tools(
                        app.state.settings, {}, path, {"name": name, "args": args}, 75
                    )

        return True, await asyncio.to_thread(files)
    if name in {
        "start_research",
        "message_research",
        "project_overview",
        "research_read",
    }:
        from .research_tools import run_research_tool

        result = await run_research_tool(
            app,
            owner,
            {"workspace_id": info["workspace_id"], "role": "lead"},
            name,
            args,
        )
        return True, result
    return False, None
