"""The research map: a project's question tree, kept in the database.

The map is the agent's working memory across sprints, so every change to it
is written down with who made it, in which sprint, and why. These functions
only stage changes on the session they are given; the caller commits.
"""

import re
import unicodedata

from sqlalchemy import select

from .models import (
    AgentSession,
    ResearchEvent,
    ResearchNode,
    ResearchProject,
    now,
    uid,
)

KINDS = {"question", "hypothesis", "experiment", "finding"}
LEVELS = {"", "high", "medium", "low"}
STATUSES = {"open", "active", "supported", "refuted", "abandoned", "parked"}
# A node in one of these is done with; nothing more is added under it.
CLOSED = {"supported", "refuted", "abandoned"}
# A branch under one of these is dead: no work may be focused anywhere in it.
DEAD = {"refuted", "abandoned"}
PREFIX = 8


def short_title(question):
    text = re.sub(r"\s+", " ", question).strip().lstrip("# ")
    if len(text) <= 16:
        return text or "新对话"
    boundaries = [
        i
        for i, char in enumerate(text)
        if char.isspace() or unicodedata.category(char).startswith("P")
    ]
    # A long unbroken phrase stays whole rather than losing part of a word.
    end = max((i for i in boundaries if 0 < i <= 16), default=None)
    if end is None:
        end = next((i for i in boundaries if i > 16), len(text))
    title = text[:end].rstrip()
    return title if 0 < len(title) <= 100 else "新对话"


def researcher_language(message):
    first = re.split(r"[。！？.!?\n]", message.strip(), maxsplit=1)[0]
    return "zh" if re.search(r"[\u3400-\u9fff]", first) else "en"


def language(d, project):
    row = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.action == "create_project",
        )
        .order_by(ResearchEvent.created_at)
    ).first()
    if row is not None:
        value = row.detail.get("language")
        if value not in {"zh", "en"}:
            value = researcher_language(row.detail.get("question") or project.question)
            row.detail = {**row.detail, "language": value}
        return value
    if project.parent_id:
        parent = d.get(ResearchProject, project.parent_id)
        if parent is not None:
            return language(d, parent)
    return researcher_language(project.question)


def create_project(
    d,
    owner,
    question,
    background,
    model_config_id,
    budget=None,
    *,
    first_message=None,
    language=None,
):
    """A new project, its root question and the session its runs belong to."""
    question = question.strip()
    if not question:
        raise ValueError("研究问题不能为空")
    session = AgentSession(owner=owner, title=short_title(question), kind="research")
    d.add(session)
    d.flush()
    project = ResearchProject(
        owner=owner,
        question=question,
        title=short_title(question),
        background=background or "",
        model_config_id=model_config_id,
        session_id=session.id,
    )
    if budget:
        project.budget = {**project_budget_default(), **budget}
    d.add(project)
    d.flush()
    root = ResearchNode(project_id=project.id, kind="question", title=question[:300])
    d.add(root)
    d.flush()
    event(
        d,
        project,
        root,
        "system",
        "create_project",
        {
            "question": question,
            "language": language or researcher_language(first_message or question),
            "title_pending": True,
        },
    )
    return project


def project_budget_default():
    # No limits until the researcher sets them in the plan.
    return {"max_sprints": None, "max_tokens": None, "max_job_seconds": None}


def nodes(d, project):
    return list(
        d.scalars(
            select(ResearchNode)
            .where(ResearchNode.project_id == project.id)
            .order_by(ResearchNode.created_at, ResearchNode.id)
        )
    )


def root(d, project):
    return d.scalars(
        select(ResearchNode).where(
            ResearchNode.project_id == project.id, ResearchNode.parent_id.is_(None)
        )
    ).one()


def event(d, project, node, actor, action, detail, sprint_id=None):
    row = ResearchEvent(
        id=uid(),
        project_id=project.id,
        node_id=node.id if node is not None else None,
        sprint_id=sprint_id,
        actor=actor,
        action=action,
        detail=detail,
        created_at=now(),
    )
    d.add(row)
    from .research_notes import record

    record(d, project, row)
    return row


def add_node(
    d,
    project,
    parent_id,
    kind,
    title,
    *,
    kill_if="",
    budget_tokens=0,
    value="",
    cost="",
    actor,
    sprint_id=None,
    reason="",
):
    if kind not in KINDS:
        raise ValueError("节点类型只能是 question、hypothesis、experiment 或 finding")
    title = (title or "").strip()
    if not title:
        raise ValueError("节点标题不能为空")
    kill_if = (kill_if or "").strip()
    if kind == "hypothesis" and not kill_if:
        raise ValueError("假设必须写明 kill_if：出现什么结果就说明这条路不通")
    parent = d.get(ResearchNode, parent_id) if parent_id else None
    if parent is None or parent.project_id != project.id:
        raise ValueError("父节点不在这个研究项目里")
    if parent.status in CLOSED or not is_live(d, parent, closed=False):
        raise ValueError("父节点已关闭，不能在它下面继续添加")
    if budget_tokens < 0:
        raise ValueError("预算不能为负数")
    if value not in LEVELS or cost not in LEVELS:
        raise ValueError("价值和成本的估计只能是 high、medium 或 low")
    node = ResearchNode(
        project_id=project.id,
        parent_id=parent.id,
        kind=kind,
        title=title[:300],
        kill_if=kill_if,
        budget_tokens=budget_tokens,
        value=value,
        cost=cost,
    )
    d.add(node)
    d.flush()
    event(
        d,
        project,
        node,
        actor,
        "add_node",
        {"kind": kind, "title": node.title, "kill_if": kill_if, "reason": reason},
        sprint_id,
    )
    return node


FIELDS = ("status", "confidence", "doubts", "title")


def update_node(
    d,
    node,
    *,
    status=None,
    confidence=None,
    doubts=None,
    title=None,
    actor,
    sprint_id=None,
    reason,
):
    if not (reason or "").strip():
        raise ValueError("修改节点必须说明理由")
    if status is not None and status not in STATUSES:
        raise ValueError("节点状态不合法")
    if confidence is not None and not 0 <= confidence <= 1:
        raise ValueError("置信度必须在 0 到 1 之间")
    changes = {
        "status": status,
        "confidence": confidence,
        "doubts": doubts,
        "title": title.strip()[:300] if title is not None else None,
    }
    before, after = {}, {}
    for field in FIELDS:
        value = changes[field]
        if value is None or getattr(node, field) == value:
            continue
        before[field] = getattr(node, field)
        after[field] = value
        setattr(node, field, value)
    node.updated_at = now()
    project = d.get(ResearchProject, node.project_id)
    event(
        d,
        project,
        node,
        actor,
        "update_node",
        {"before": before, "after": after, "reason": reason.strip()},
        sprint_id,
    )
    return node


def is_live(d, node, closed=True):
    """Work may still go here: neither it (if `closed`) nor any ancestor is done with."""
    if closed and node.status in CLOSED:
        return False
    current = node
    seen = set()
    while current is not None and current.id not in seen:
        seen.add(current.id)
        if current.status in DEAD:
            return False
        current = d.get(ResearchNode, current.parent_id) if current.parent_id else None
    return True


def node_by_prefix(d, project, prefix):
    """A node named by its full id or its first 8 or more characters."""
    prefix = (prefix or "").strip()
    if len(prefix) < PREFIX:
        raise ValueError(f"节点编号至少写前 {PREFIX} 位")
    rows = nodes(d, project)
    found = [n for n in rows if n.id.startswith(prefix)]
    if not found:
        # The map shows the first 8 characters; a model may invent the rest.
        found = [n for n in rows if n.id.startswith(prefix[:PREFIX])]
    if not found:
        raise ValueError("没有这个节点")
    if len(found) > 1:
        raise ValueError("节点编号不唯一，请多写几位")
    return found[0]


def _thousands(value):
    return f"{value // 1000}k" if value >= 1000 else str(value)


def _lines(node, depth, full):
    pad = "  " * depth
    head = (
        f"{pad}[{node.id[:PREFIX]}] {node.kind}/{node.status} "
        f"conf={node.confidence:.2f} spent={_thousands(node.spent_tokens)}  {node.title}"
    )
    if node.value or node.cost:
        head += f"  [value={node.value or '?'} cost={node.cost or '?'}]"
    if not full:
        return [head]
    lines = [head]
    if node.kill_if:
        lines.append(f"{pad}    kill_if: {node.kill_if}")
    if node.doubts:
        lines.append(f"{pad}    doubts: " + "; ".join(node.doubts))
    counts = len(node.evidence_for), len(node.evidence_against)
    if any(counts):
        lines.append(f"{pad}    evidence: {counts[0]} for, {counts[1]} against")
    return lines


def snapshot(d, project, *, max_chars=12000):
    """The map as the model reads it: an indented tree, open nodes in full.

    When it is too long, closed nodes shrink to one line; if it is still too
    long, closed subtrees with nothing open under them are left out, and the
    count of what was left out is said.
    """
    rows = nodes(d, project)
    children = {}
    for row in rows:
        children.setdefault(row.parent_id, []).append(row)
    live_under = {}

    def has_live(node):
        if node.id not in live_under:
            live_under[node.id] = node.status not in CLOSED or any(
                has_live(c) for c in children.get(node.id, [])
            )
        return live_under[node.id]

    def render(full_closed, drop_dead):
        out, omitted = [], 0

        def walk(node, depth):
            nonlocal omitted
            closed = node.status in CLOSED
            if drop_dead and closed and not has_live(node):
                omitted += 1 + count(node)
                return
            out.extend(_lines(node, depth, full_closed or not closed))
            for child in children.get(node.id, []):
                walk(child, depth + 1)

        def count(node):
            return sum(1 + count(c) for c in children.get(node.id, []))

        for top in children.get(None, []):
            walk(top, 0)
        if omitted:
            out.append(f"({omitted} closed nodes omitted)")
        return "\n".join(out)

    text = render(True, False)
    if len(text) > max_chars:
        text = render(False, False)
    if len(text) > max_chars:
        text = render(False, True)
    return text[:max_chars]
