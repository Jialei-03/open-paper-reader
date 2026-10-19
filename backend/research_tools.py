"""The research agent's tools, and the gate that keeps its work on the map.

In a research run every step that does something (runs code, writes files,
changes the map) must say first, with `focus`, which node of the research map
it advances. Without a focus, or with a focus on a branch that is closed,
the step is refused and the refusal is written down: that is how drift is
both stopped and measured.
"""

import asyncio

from sqlalchemy import select

from . import research_evidence, research_map, research_sandbox
from .tool_spec import ID, tool
from .models import (
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    now,
)

NODE = {"type": "string", "minLength": 8, "maxLength": 36}
REASON = {"type": "string", "minLength": 1, "maxLength": 1000}
LEVEL = {"type": "string", "enum": ["high", "medium", "low"]}

# What may be done before saying what is being worked on: looking, not doing.
FOCUS_FREE = {
    "research_map_read",
    "focus",
    "end_sprint",
    "job_status",
    "job_logs",
    "read_skill",
    "search_papers",
    "list_papers",
    "read_paper",
    "read_file",
    "search_file",
    "read_region",
    "list_figures",
    "web_read",
}


def _research(name, description, properties=None, required=None):
    spec = tool(name, description, properties, required, write=True)
    spec["research"] = True
    return spec


RESEARCH_TOOLS = [
    _research(
        "research_map_read",
        "读取研究地图：北极星问题、全部节点（状态、置信度、kill_if、疑点）、预算和当前焦点。每轮开始先调用。",
    ),
    _research(
        "focus",
        "声明接下来推进哪个节点、想得到什么信息。运行代码、读写文件、改地图之前必须先聚焦；已关闭的分支不能聚焦。",
        {
            "node_id": NODE,
            "intent": {"type": "string", "minLength": 1, "maxLength": 500},
        },
        ["node_id", "intent"],
    ),
    _research(
        "add_node",
        "在地图上新增节点（question、hypothesis、experiment、finding）。假设必须写 kill_if（什么结果说明这条路不通）。可估计 value（做它能多大程度改变对北极星问题的判断）和 cost（要花多少），high / medium / low。",
        {
            "parent_id": NODE,
            "kind": {"type": "string", "enum": sorted(research_map.KINDS)},
            "title": {"type": "string", "minLength": 1, "maxLength": 300},
            "kill_if": {"type": "string", "maxLength": 500},
            "budget_tokens": {"type": "integer", "minimum": 0},
            "value": LEVEL,
            "cost": LEVEL,
            "reason": REASON,
        },
        ["parent_id", "kind", "title", "reason"],
    ),
    _research(
        "update_node",
        "修改节点的状态、置信度或疑点，必须写理由。",
        {
            "node_id": NODE,
            "status": {"type": "string", "enum": sorted(research_map.STATUSES)},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "doubts": {
                "type": "array",
                "maxItems": 20,
                "items": {"type": "string", "maxLength": 300},
            },
            "reason": REASON,
        },
        ["node_id", "reason"],
    ),
    _research(
        "record_result",
        "记录一个结果。证据只能是作业日志的行（kind=log, job_id, from_line, to_line）或论文原句（kind=cite, file_id, page, quote）；结果里的数字必须逐字出现在所引证据中。对照假设的 kill_if 判断是否触发。",
        {
            "node_id": NODE,
            "summary": {"type": "string", "minLength": 1, "maxLength": 2000},
            "evidence": {
                "type": "array",
                "minItems": 1,
                "maxItems": 10,
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["log", "cite"]},
                        "job_id": ID,
                        "from_line": {"type": "integer", "minimum": 1},
                        "to_line": {"type": "integer", "minimum": 1},
                        "file_id": ID,
                        "page": {"type": "integer", "minimum": 1},
                        "quote": {"type": "string", "maxLength": 300},
                    },
                    "required": ["kind"],
                    "additionalProperties": False,
                },
            },
            "kill_triggered": {"type": "string", "enum": ["yes", "no", "unsure"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        ["node_id", "summary", "evidence", "kill_triggered", "confidence"],
    ),
    _research(
        "end_sprint",
        "结束本轮并写交接：做了什么、得到什么、下一轮该推进什么。启动了长作业就把作业编号放进 waiting_on，作业结束后才开始下一轮。",
        {
            "summary": {"type": "string", "minLength": 1, "maxLength": 4000},
            "next_focus": {"type": "string", "maxLength": 500},
            "waiting_on": {"type": "array", "maxItems": 5, "items": ID},
        },
        ["summary"],
    ),
    _research(
        "run_job",
        "在研究工作区（/work，无网络）后台运行一条命令，适合训练和较长的实验；输出由系统保存为日志，可作为证据。作业绑定到当前焦点节点。",
        {
            "command": {"type": "string", "minLength": 1, "maxLength": 4000},
            "timeout_seconds": {"type": "integer", "minimum": 1},
        },
        ["command"],
    ),
    _research(
        "job_status",
        "查看后台作业的状态、退出码和日志行数。",
        {"job_id": ID},
        ["job_id"],
    ),
    _research(
        "job_logs",
        "读取后台作业日志的若干行（行号从 1 开始）；运行中的作业返回到目前为止的输出。",
        {
            "job_id": ID,
            "offset": {"type": "integer", "minimum": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500},
        },
        ["job_id"],
    ),
]
RESEARCH_TOOLS.append(
    _research(
        "advise",
        "（仅导师）对地图上的开放节点给出判断并结束本轮：continue / invest（加注）/ kill（放弃）/ pivot（转向，须给新假设和 kill_if）/ ask_human（请人拍板，可附 proposal）。可逐轮判断执行者是否跑偏（drift），并评估这条研究线值不值得发表（assessment）。北极星问题已得到回答时用 conclude。",
        {
            "verdicts": {
                "type": "array",
                "minItems": 1,
                "maxItems": 30,
                "items": {
                    "type": "object",
                    "properties": {
                        "node_id": NODE,
                        "verdict": {
                            "type": "string",
                            "enum": [
                                "continue",
                                "invest",
                                "kill",
                                "pivot",
                                "ask_human",
                            ],
                        },
                        "reason": {"type": "string", "maxLength": 1000},
                        "value": LEVEL,
                        "cost": LEVEL,
                        "proposal": {
                            "type": "string",
                            "enum": ["continue", "invest", "kill", "pivot"],
                        },
                        "new_hypothesis": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "maxLength": 300},
                                "kill_if": {"type": "string", "maxLength": 500},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "required": ["node_id", "verdict", "reason"],
                    "additionalProperties": False,
                },
            },
            "drift": {
                "type": "array",
                "maxItems": 30,
                "items": {
                    "type": "object",
                    "properties": {
                        "sprint_number": {"type": "integer", "minimum": 1},
                        "on_track": {"type": "boolean"},
                        "note": {"type": "string", "maxLength": 300},
                    },
                    "required": ["sprint_number", "on_track"],
                    "additionalProperties": False,
                },
            },
            "assessment": {"type": "string", "maxLength": 2000},
            "conclude": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["concluded", "refuted"]},
                    "summary": {"type": "string", "maxLength": 2000},
                },
                "required": ["status"],
                "additionalProperties": False,
            },
        },
        ["verdicts"],
    )
)
RESEARCH_TOOLS.append(
    _research(
        "distill",
        "（仅提炼者）把这个项目的经验写进研究手册并结束本轮。ops 中每条为 ADD{when,do,why} / EDIT{id,...} / MERGE{ids,when,do,why} / DELETE{id}；votes 评价本项目开始时生效的规则是否有用。只写研究判断方面、可复用的规则，不写本题的具体结论。",
        {
            "ops": {
                "type": "array",
                "maxItems": 10,
                "items": {
                    "type": "object",
                    "properties": {
                        "op": {
                            "type": "string",
                            "enum": ["ADD", "EDIT", "MERGE", "DELETE"],
                        },
                        "id": {"type": "string", "maxLength": 40},
                        "ids": {
                            "type": "array",
                            "maxItems": 10,
                            "items": {"type": "string", "maxLength": 40},
                        },
                        "when": {"type": "string", "maxLength": 200},
                        "do": {"type": "string", "maxLength": 300},
                        "why": {"type": "string", "maxLength": 300},
                    },
                    "required": ["op"],
                    "additionalProperties": False,
                },
            },
            "votes": {
                "type": "array",
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "maxLength": 40},
                        "helpful": {"type": "boolean"},
                    },
                    "required": ["id", "helpful"],
                    "additionalProperties": False,
                },
            },
        },
        [],
    )
)
RESEARCH_NAMES = {t["name"] for t in RESEARCH_TOOLS}
# What the advisor may use: it looks and judges; it does not do.
ADVISOR_TOOLS = FOCUS_FREE - {"focus", "end_sprint"} | {"advise"}
# What the distiller may use: the project's record, and the playbook.
DISTILLER_TOOLS = {"research_map_read", "job_status", "job_logs", "distill"}


def _context(d, research):
    sprint = d.get(ResearchSprint, research["sprint_id"])
    project = d.get(ResearchProject, research["project_id"])
    if sprint is None or project is None or sprint.project_id != project.id:
        raise ValueError("研究任务不存在")
    if sprint.status != "running":
        raise ValueError("本轮已结束，不能再调用工具")
    return project, sprint


def _blocked(d, project, sprint, tool_name, reason, message, node=None):
    research_map.event(
        d,
        project,
        node,
        "system",
        "drift_blocked",
        {"tool": tool_name, "reason": reason},
        sprint.id,
    )
    d.commit()
    raise ValueError(message)


def gate(app, research, name):
    """Refuses a step that does something before saying which live node it advances."""
    role = research.get("role", "executor")
    if role == "distiller":
        if name not in DISTILLER_TOOLS:
            raise ValueError("提炼者只读项目记录，最后用 distill 写进研究手册")
        with app.state.maker() as d:
            _context(d, research)
        return
    if name == "distill":
        raise ValueError("只有提炼者可以修改研究手册（distill）")
    if role == "advisor" and name not in ADVISOR_TOOLS:
        raise ValueError(
            "导师只做判断，不动手：可以读地图、日志和文献，最后用 advise 给出判断"
        )
    if role != "advisor" and name == "advise":
        raise ValueError("只有导师可以给出判断（advise）")
    if name in FOCUS_FREE or name == "advise":
        with app.state.maker() as d:
            _context(d, research)
        return
    with app.state.maker() as d:
        project, sprint = _context(d, research)
        if not sprint.focus_node_id:
            _blocked(
                d,
                project,
                sprint,
                name,
                "no_focus",
                "先调用 focus 声明正在推进的节点，再进行这一步",
            )
        node = d.get(ResearchNode, sprint.focus_node_id)
        if node is None or not research_map.is_live(d, node):
            _blocked(
                d,
                project,
                sprint,
                name,
                "closed_focus",
                "当前焦点节点已关闭（或所在分支已被否定），先调用 focus 选择仍在进行的节点",
                node,
            )


def _node_out(node):
    from .research_routes import node_out

    return node_out(node)


def _focus(d, project, sprint, args):
    try:
        node = research_map.node_by_prefix(d, project, args["node_id"])
    except ValueError as e:
        _blocked(d, project, sprint, "focus", "unknown_node", str(e))
    if not research_map.is_live(d, node):
        _blocked(
            d,
            project,
            sprint,
            "focus",
            "closed_node",
            "这个节点已关闭，或所在分支已被否定，不能在这里继续投入",
            node,
        )
    sprint.focus_node_id = node.id
    sprint.updated_at = now()
    if node.status == "open":
        node.status = "active"
    research_map.event(
        d, project, node, "executor", "focus", {"intent": args["intent"]}, sprint.id
    )
    return {"focus": node.id, "title": node.title, "kill_if": node.kill_if}


def _record(app, d, owner, project, sprint, args):
    node = research_map.node_by_prefix(d, project, args["node_id"])
    if not research_map.is_live(d, node):
        raise ValueError(
            "这个节点已关闭，或所在分支已被否定，结果请记到仍在进行的节点上"
        )
    checked = research_evidence.check(
        app,
        d,
        owner,
        project,
        args["summary"],
        args["evidence"],
        "\n".join([project.question, project.background, node.kill_if]),
    )
    entry = {
        "summary": args["summary"],
        "evidence": checked,
        "kill_triggered": args["kill_triggered"],
        "sprint_id": sprint.id,
        "at": now(),
    }
    if args["kill_triggered"] == "yes":
        node.evidence_against = [*node.evidence_against, entry]
    else:
        node.evidence_for = [*node.evidence_for, entry]
    status = (
        "refuted"
        if args["kill_triggered"] == "yes" and node.kind == "hypothesis"
        else None
    )
    doubts = None
    if args["kill_triggered"] == "unsure":
        doubts = [*node.doubts, "kill_if 是否触发尚不确定：" + args["summary"][:200]]
    research_map.update_node(
        d,
        node,
        status=status,
        confidence=args["confidence"],
        doubts=doubts,
        actor="executor",
        sprint_id=sprint.id,
        reason="record_result",
    )
    research_map.event(
        d,
        project,
        node,
        "executor",
        "record_result",
        {"summary": args["summary"], "kill_triggered": args["kill_triggered"]},
        sprint.id,
    )
    return {"node": _node_out(node)}


def _job(d, project, job_id):
    job = d.get(ResearchJob, job_id)
    if job is None or job.project_id != project.id:
        raise ValueError("没有这个作业")
    return job


def _run(app, owner, research, name, args):
    settings = app.state.settings
    with app.state.maker() as d:
        project, sprint = _context(d, research)
        if name == "research_map_read":
            return {
                "question": project.question,
                "map": research_map.snapshot(d, project),
                "budget": project.budget,
                "spent": project.spent,
                "focus": sprint.focus_node_id,
            }
        if name == "focus":
            result = _focus(d, project, sprint, args)
        elif name == "add_node":
            parent = research_map.node_by_prefix(d, project, args["parent_id"])
            node = research_map.add_node(
                d,
                project,
                parent.id,
                args["kind"],
                args["title"],
                kill_if=args.get("kill_if", ""),
                budget_tokens=args.get("budget_tokens", 0),
                value=args.get("value", ""),
                cost=args.get("cost", ""),
                actor="executor",
                sprint_id=sprint.id,
                reason=args["reason"],
            )
            result = {"node": _node_out(node)}
        elif name == "update_node":
            node = research_map.node_by_prefix(d, project, args["node_id"])
            if node.parent_id is None and args.get("status") in {
                *research_map.CLOSED,
                "parked",
            }:
                raise ValueError(
                    "北极星问题本身不能关闭或搁置；它得到回答时由导师结束项目"
                )
            if not research_map.is_live(d, node):
                raise ValueError("这个节点已关闭，或所在分支已被否定，不能再修改")
            if args.get("status") == "supported" and not node.evidence_for:
                raise ValueError(
                    "标为已支持之前，先用 record_result 记下支持它的证据（作业日志行或原文句子）"
                )
            research_map.update_node(
                d,
                node,
                status=args.get("status"),
                confidence=args.get("confidence"),
                doubts=args.get("doubts"),
                actor="executor",
                sprint_id=sprint.id,
                reason=args["reason"],
            )
            result = {"node": _node_out(node)}
        elif name == "record_result":
            result = _record(app, d, owner, project, sprint, args)
        elif name == "end_sprint":
            waiting = [_job(d, project, j).id for j in args.get("waiting_on", [])]
            sprint.summary = args["summary"]
            sprint.next_focus = args.get("next_focus", "")
            sprint.waiting_on = waiting
            sprint.status = "ended"
            sprint.updated_at = now()
            research_map.event(
                d,
                project,
                None,
                "executor",
                "end_sprint",
                {"next_focus": sprint.next_focus, "waiting_on": waiting},
                sprint.id,
            )
            result = {"ended": True}
        elif name == "run_job":
            node = d.get(ResearchNode, sprint.focus_node_id)
            job = research_sandbox.start_job(
                settings,
                d,
                project,
                node,
                sprint,
                args["command"],
                args.get("timeout_seconds", research_sandbox.JOB_MAX_SECONDS),
            )
            research_map.event(
                d,
                project,
                node,
                "executor",
                "run_job",
                {"job_id": job.id, "command": job.command},
                sprint.id,
            )
            result = {
                "job_id": job.id,
                "status": job.status,
                "hint": "作业在后台运行；需要等它时，用 end_sprint(waiting_on=[job_id]) 结束本轮。",
            }
        elif name == "advise":
            from .research_advice import apply

            result = apply(d, project, sprint, args)
        elif name == "distill":
            from . import research_playbook

            book = research_playbook.load(settings)
            ops = [*args.get("ops", [])]
            # Only rules the project actually ran with can be judged by it.
            ran = d.scalars(
                select(ResearchEvent)
                .where(
                    ResearchEvent.project_id == project.id,
                    ResearchEvent.action == "playbook_version",
                )
                .order_by(ResearchEvent.created_at)
            ).first()
            tried = set(ran.detail.get("active", [])) if ran else set()
            ops += [
                {"op": "VOTE", **vote}
                for vote in args.get("votes", [])
                if vote.get("id") in tried
            ]
            counts = research_playbook.apply_ops(book, ops, project.id, "distiller")
            research_playbook.save(settings, book)
            research_map.event(
                d,
                project,
                None,
                "distiller",
                "distilled",
                {**counts, "version": book["version"]},
                sprint.id,
            )
            sprint.status = "ended"
            sprint.summary = (
                f"复盘本项目，写进研究手册（第 {book['version']} 版）："
                f"新增 {counts['added']} 条，合并 {counts['merged']} 条，修改 {counts['edited']} 条，"
                f"投票 {counts['voted']} 次"
            )
            sprint.updated_at = now()
            result = {**counts, "version": book["version"]}
        elif name == "job_status":
            return research_sandbox.job_status(_job(d, project, args["job_id"]))
        elif name == "job_logs":
            return research_sandbox.read_log(
                settings,
                _job(d, project, args["job_id"]),
                args.get("offset", 0),
                args.get("limit", 200),
            )
        else:
            raise ValueError("不支持的研究工具")
        d.commit()
        return result


async def run_research_tool(app, owner, research, name, args):
    return await asyncio.to_thread(_run, app, owner, research, name, args)


async def run_pi(app, research, name, args):
    """A file or shell tool, in the project's own workspace."""
    result = await asyncio.to_thread(
        research_sandbox.pi_call,
        app.state.settings,
        research["project_id"],
        name,
        args,
    )
    content = result.get("content", [])
    return {
        "content": [x for x in content if x.get("type") != "image"],
        "_image_content": [x for x in content if x.get("type") == "image"],
        "isError": result.get("isError", False),
    }
