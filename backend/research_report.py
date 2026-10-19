"""A project's report in Markdown, written from its record alone: no model is asked.

What was asked, how it ended, every recorded result with the evidence it cites, the
directions that were dropped and why, the advisor's decisive calls, and what it cost.
"""

from sqlalchemy import select

from . import research_map
from .models import ResearchEvent

WORDS = {
    "zh": {
        "answer": "结论",
        "evidence": "证据",
        "dropped": "放弃的方向",
        "calls": "导师的关键判断",
        "cost": "花费",
        "unfinished": "项目还没有结束，下面是到目前为止的记录。",
        "none": "（没有）",
        "for": "支持",
        "against": "反对",
        "log": "作业 {job}，第 {start}–{end} 行",
        "page": "第 {page} 页",
        "kill_if": "止损条件",
        "spent": "{sprints} 轮，{tokens} token",
        "ended": {
            "concluded": "已回答",
            "refuted": "答案是否定的",
            "blocked": "停下：缺少只有人能提供的东西",
            "budget": "预算用完，未得出结论",
            "stopped": "被手动停止",
        },
        "verdicts": {
            "kill": "放弃",
            "pivot": "转向",
            "invest": "加注",
            "ask_human": "请人拍板",
        },
        "kinds": {
            "question": "问题",
            "hypothesis": "假设",
            "experiment": "实验",
            "finding": "发现",
        },
        "statuses": {
            "open": "未开始",
            "active": "进行中",
            "supported": "已支持",
            "refuted": "已否定",
            "abandoned": "已放弃",
            "parked": "搁置",
        },
        "sep": "，",
    },
    "en": {
        "answer": "Answer",
        "evidence": "Evidence",
        "dropped": "Dropped directions",
        "calls": "Advisor's decisive calls",
        "cost": "Cost",
        "unfinished": "Not finished yet: this is the record so far.",
        "none": "(none)",
        "for": "for",
        "against": "against",
        "log": "job {job}, lines {start}–{end}",
        "page": "page {page}",
        "kill_if": "kill condition",
        "spent": "{sprints} sprints, {tokens} tokens",
        "ended": {
            "concluded": "Answered",
            "refuted": "The answer is no",
            "blocked": "Stopped: needs something only a person can provide",
            "budget": "Budget ran out before an answer",
            "stopped": "Stopped by hand",
        },
        "verdicts": {
            "kill": "drop",
            "pivot": "pivot",
            "invest": "invest",
            "ask_human": "ask a person",
        },
        "kinds": {},
        "statuses": {},
        "sep": ", ",
    },
}

DECISIVE = {"kill", "pivot", "invest", "ask_human"}


def _events(d, project, actions):
    return list(
        d.scalars(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action.in_(actions),
            )
            .order_by(ResearchEvent.created_at, ResearchEvent.id)
        )
    )


def _source(item, w):
    if item.get("kind") == "log":
        where = w["log"].format(
            job=item.get("job_id", "")[: research_map.PREFIX],
            start=item.get("from_line"),
            end=item.get("to_line"),
        )
        return where, item.get("lines", [])
    return w["page"].format(page=item.get("page")), [item.get("quote", "")]


def _results(node, w):
    out = []
    for side, entries in (
        (w["for"], node.evidence_for),
        (w["against"], node.evidence_against),
    ):
        for entry in entries:
            out.append(f"- **{side}**: {entry.get('summary', '')}")
            for item in entry.get("evidence", []):
                where, lines = _source(item, w)
                out.append(f"  - {where}")
                out.extend(f"    > {line}" for line in lines if line)
    return out


def report(d, project, lang="zh"):
    w = WORDS.get(lang, WORDS["zh"])
    nodes = research_map.nodes(d, project)
    by_id = {n.id: n for n in nodes}
    out = [f"# {project.question}", ""]

    out += [f"## {w['answer']}", ""]
    if project.status != "finished":
        out.append(w["unfinished"])
    else:
        out.append(f"**{w['ended'].get(project.end_reason, project.end_reason)}**")
        last = _events(d, project, ["concluded", "input_needed"])
        if last:
            out += ["", last[-1].detail.get("summary", "")]
    out.append("")

    out += [f"## {w['evidence']}", ""]
    recorded = [n for n in nodes if n.evidence_for or n.evidence_against]
    for node in recorded:
        out += [
            f"### {node.title}",
            f"*{w['kinds'].get(node.kind, node.kind)}{w['sep']}{w['statuses'].get(node.status, node.status)}*",
            "",
        ]
        out += _results(node, w) + [""]
    if not recorded:
        out += [w["none"], ""]

    out += [f"## {w['dropped']}", ""]
    dropped = [
        n for n in nodes if n.status in research_map.DEAD and n.parent_id is not None
    ]
    for node in dropped:
        line = f"- **{node.title}** ({w['statuses'].get(node.status, node.status)})"
        if node.kill_if:
            line += f" — {w['kill_if']}: {node.kill_if}"
        out.append(line)
    if not dropped:
        out.append(w["none"])
    out.append("")

    calls = [
        e
        for e in _events(d, project, ["advice"])
        if e.detail.get("verdict") in DECISIVE
    ]
    if calls:
        out += [f"## {w['calls']}", ""]
        for e in calls:
            node = by_id.get(e.node_id)
            title = f"{node.title}: " if node is not None else ""
            verdict = w["verdicts"][e.detail["verdict"]]
            out.append(f"- **{verdict}** — {title}{e.detail.get('reason', '')}")
        out.append("")

    spent = project.spent or {}
    out += [
        f"## {w['cost']}",
        "",
        w["spent"].format(
            sprints=spent.get("sprints", 0), tokens=spent.get("tokens", 0)
        ),
        "",
    ]
    return "\n".join(out)
