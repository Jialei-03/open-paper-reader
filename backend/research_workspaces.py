"""Projects that hold researches, and the board that shows their work.

A project (ResearchWorkspace) is where a person keeps related researches,
what they share (instructions every agent reads, a default environment and
model), and a board. The board is drawn from what is already recorded, after
Hermes's Kanban (MIT): each research is a card, each hypothesis or experiment
of its map is a card, and the person's own ideas are cards. Agents move the
cards of their work by doing it (a node's status, a decision they ask for);
only the person's own cards are moved by hand.

Columns: triage (ideas), todo, running, review (waiting for the person),
done, dropped.
"""

from sqlalchemy import func, select

from . import research_map
from .models import (
    ResearchCard,
    ResearchNode,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
    now,
)

COLUMNS = ("triage", "todo", "running", "review", "done", "dropped")
HAND_MOVES = {"triage", "todo", "dropped"}
DEFAULT_NAME = "我的研究"
EVAL_NAME = "评测"
METRIC_ORDER = ("final_test_acc", "test_acc", "val_acc", "acc")


def ensure(d, owner):
    """Every research belongs to a project: those from before projects existed
    go to a default one, and evaluation runs to their own."""
    loose = list(
        d.scalars(
            select(ResearchProject).where(
                ResearchProject.owner == owner,
                ResearchProject.workspace_id.is_(None),
            )
        )
    )
    if not loose:
        return
    made = {}
    for project in loose:
        kind = "eval" if project.budget.get("auto_decide") else "research"
        if kind not in made:
            made[kind] = d.scalars(
                select(ResearchWorkspace).where(
                    ResearchWorkspace.owner == owner, ResearchWorkspace.kind == kind
                )
            ).first() or create(
                d, owner, EVAL_NAME if kind == "eval" else DEFAULT_NAME, kind=kind
            )
        project.workspace_id = made[kind].id
    d.flush()


def create(d, owner, name, description="", kind="research"):
    name = (name or "").strip()[:200]
    if not name:
        raise ValueError("项目名称不能为空")
    workspace = ResearchWorkspace(
        owner=owner,
        name=name,
        description=(description or "").strip()[:4000],
        kind=kind,
    )
    d.add(workspace)
    d.flush()
    return workspace


def default_for(d, owner):
    """The project a research goes to when none is named."""
    ensure(d, owner)
    return d.scalars(
        select(ResearchWorkspace)
        .where(
            ResearchWorkspace.owner == owner,
            ResearchWorkspace.kind == "research",
            ResearchWorkspace.archived.is_(False),
        )
        .order_by(ResearchWorkspace.updated_at.desc())
    ).first() or create(d, owner, DEFAULT_NAME)


EDITABLE = ("name", "description", "instructions", "compute_id", "model_config_id")


def update(d, workspace, body):
    for key in EDITABLE:
        if key in body and body[key] is not None:
            value = str(body[key]).strip()
            if key == "name" and not value:
                raise ValueError("项目名称不能为空")
            setattr(workspace, key, value[: 200 if key == "name" else 20000])
    if "archived" in body and body["archived"] is not None:
        workspace.archived = bool(body["archived"])
    workspace.updated_at = now()


def researches(d, workspace):
    return list(
        d.scalars(
            select(ResearchProject)
            .where(ResearchProject.workspace_id == workspace.id)
            .order_by(ResearchProject.updated_at.desc())
        )
    )


def best(d, project):
    """The research's best number so far: test accuracy, else validation."""
    found = None
    for metrics in d.scalars(
        select(ResearchJob.metrics).where(
            ResearchJob.project_id == project.id,
            ResearchJob.status == "succeeded",
        )
    ):
        for name in METRIC_ORDER:
            value = (metrics or {}).get(name)
            if isinstance(value, (int, float)) and value == value:
                rank = METRIC_ORDER.index(name)
                if found is None or (rank, -value) < (found[2], -found[1]):
                    found = (name, float(value), rank)
                break
    return {"name": found[0], "value": found[1]} if found else None


def _open_requests(d, project):
    rows = list(
        d.scalars(
            select(ResearchEvent).where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action.in_(["decision_requested", "human_decision"]),
            )
        )
    )
    answered = {
        r.detail.get("request_id") for r in rows if r.action == "human_decision"
    }
    return [
        r for r in rows if r.action == "decision_requested" and r.id not in answered
    ]


def _waits_for_reply(d, project):
    """While scoping, the advisor spoke last: the person's turn."""
    last = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == project.id, ResearchEvent.action == "message"
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    return last is not None and last.actor == "advisor"


def research_column(d, project):
    if project.status == "finished":
        return "dropped" if project.end_reason == "stopped" else "done"
    if project.status == "waiting" or _open_requests(d, project):
        return "review"
    if project.status == "paused":
        return "todo"
    if project.stage == "scoping" and _waits_for_reply(d, project):
        return "review"
    return "running"


NODE_COLUMN = {
    "open": "todo",
    "parked": "todo",
    "active": "running",
    "supported": "done",
    "refuted": "dropped",
    "abandoned": "dropped",
}


def _running_sprint(d, project):
    return d.scalars(
        select(ResearchSprint).where(
            ResearchSprint.project_id == project.id,
            ResearchSprint.status == "running",
        )
    ).first()


def _last_said(d, project):
    row = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == project.id, ResearchEvent.action == "message"
        )
        .order_by(ResearchEvent.created_at.desc())
    ).first()
    return (row.detail.get("text") or "")[:300] if row else ""


def summary(d, project):
    """A research as the project page lists it."""
    sprint = _running_sprint(d, project)
    return {
        "id": project.id,
        "question": project.question,
        "stage": project.stage,
        "status": project.status,
        "end_reason": project.end_reason,
        "column": research_column(d, project),
        "rounds": project.spent.get("sprints", 0),
        "best": best(d, project),
        "working": sprint.role if sprint else "",
        "waiting": len(_open_requests(d, project)),
        "compute_id": project.compute_id,
        "updated_at": project.updated_at,
        "hypotheses": hypotheses(d, project),
        "experiments": d.scalar(
            select(func.count(ResearchJob.id)).where(
                ResearchJob.project_id == project.id
            )
        ),
        "tokens": project.spent.get("tokens", 0),
        "conclusion": (project.conclusion or {}).get("summary", "")[:400],
        "said": _last_said(d, project)[:200],
    }


def hypotheses(d, project):
    """How the research's hypotheses stand: {supported, refuted, abandoned, open}."""
    out = {"supported": 0, "refuted": 0, "abandoned": 0, "open": 0}
    for status in d.scalars(
        select(ResearchNode.status).where(
            ResearchNode.project_id == project.id,
            ResearchNode.kind == "hypothesis",
        )
    ):
        out[status if status in out else "open"] += 1
    return out


def recent(d, owner, limit=6):
    """The researches touched last, across projects, waiting ones first."""
    ensure(d, owner)
    names = {
        w.id: (w.name, w.kind)
        for w in d.scalars(
            select(ResearchWorkspace).where(ResearchWorkspace.owner == owner)
        )
    }
    rows = [
        p
        for p in d.scalars(
            select(ResearchProject)
            .where(ResearchProject.owner == owner)
            .order_by(ResearchProject.updated_at.desc())
            .limit(limit * 3)
        )
        if names.get(p.workspace_id, ("", "research"))[1] == "research"
    ][:limit]
    out = [
        summary(d, p)
        | {
            "workspace_id": p.workspace_id,
            "workspace": names.get(p.workspace_id, ("", ""))[0],
        }
        for p in rows
    ]
    out.sort(key=lambda r: r["column"] != "review")
    return out


def board(d, workspace):
    """Every card of the project, with its column."""
    cards = []
    linked = {}
    for card in d.scalars(
        select(ResearchCard)
        .where(ResearchCard.workspace_id == workspace.id)
        .order_by(ResearchCard.priority.desc(), ResearchCard.created_at)
    ):
        if card.project_id:
            linked[card.project_id] = card
            continue
        cards.append(
            {
                "id": card.id,
                "kind": "idea",
                "title": card.title,
                "summary": card.body[:300],
                "column": card.status,
                "movable": True,
                "research": None,
                "working": "",
                "updated_at": card.updated_at,
            }
        )
    for project in researches(d, workspace):
        sprint = _running_sprint(d, project)
        working = sprint.role if sprint else ""
        info = summary(d, project)
        card = linked.get(project.id)
        cards.append(
            {
                "id": card.id if card else project.id,
                "kind": "research",
                "title": card.title if card else project.question,
                "summary": _last_said(d, project),
                "column": info["column"],
                "movable": False,
                "research": {"id": project.id, "question": project.question[:120]},
                "working": working,
                "best": info["best"],
                "stage": project.stage,
                "updated_at": project.updated_at,
            }
        )
        asked = {r.node_id for r in _open_requests(d, project) if r.node_id}
        for node in research_map.nodes(d, project):
            if node.parent_id is None or node.kind not in {
                "hypothesis",
                "experiment",
                "finding",
            }:
                continue
            latest = (node.evidence_for or node.evidence_against or [{}])[-1]
            column = NODE_COLUMN.get(node.status, "todo")
            if node.id in asked:
                column = "review"
            focused = sprint is not None and sprint.focus_node_id == node.id
            if focused and column == "todo":
                column = "running"
            cards.append(
                {
                    "id": node.id,
                    "kind": node.kind,
                    "title": node.title,
                    "summary": (latest.get("summary") or node.kill_if or "")[:300],
                    "column": column,
                    "movable": False,
                    "research": {"id": project.id, "question": project.question[:120]},
                    "working": working if focused else "",
                    "evidence": len(node.evidence_for) + len(node.evidence_against),
                    "status": node.status,
                    "updated_at": node.updated_at,
                }
            )
    return {"columns": list(COLUMNS), "cards": cards}


def add_card(d, workspace, title, body=""):
    title = (title or "").strip()[:300]
    if not title:
        raise ValueError("卡片标题不能为空")
    card = ResearchCard(
        workspace_id=workspace.id, title=title, body=(body or "")[:8000]
    )
    d.add(card)
    workspace.updated_at = now()
    d.flush()
    return card


def move_card(d, card, status):
    if card.project_id:
        raise ValueError("这张卡已经开始研究，它的进展由研究本身决定")
    if status not in HAND_MOVES:
        raise ValueError("想法只能放在想法、待办或放弃里；开始研究请点“开始研究”")
    card.status = status
    card.updated_at = now()


def overview(d, owner):
    """Projects with what a person wants to know at a glance."""
    ensure(d, owner)
    out = []
    for workspace in d.scalars(
        select(ResearchWorkspace)
        .where(ResearchWorkspace.owner == owner)
        .order_by(ResearchWorkspace.updated_at.desc())
    ):
        rows = researches(d, workspace)
        columns = [research_column(d, p) for p in rows]
        last = max([p.updated_at for p in rows] + [workspace.updated_at])
        out.append(
            workspace_out(workspace)
            | {
                "researches": len(rows),
                "running": columns.count("running"),
                "waiting": columns.count("review"),
                "ideas": d.scalar(
                    select(func.count(ResearchCard.id)).where(
                        ResearchCard.workspace_id == workspace.id,
                        ResearchCard.project_id.is_(None),
                        ResearchCard.status != "dropped",
                    )
                ),
                "active_at": last,
            }
        )
    # Most recent first; evaluation runs and archived projects at the end.
    out.sort(key=lambda w: w["active_at"], reverse=True)
    out.sort(key=lambda w: (w["archived"], w["kind"] == "eval"))
    return out


def workspace_out(w):
    return {
        "id": w.id,
        "name": w.name,
        "description": w.description,
        "instructions": w.instructions,
        "kind": w.kind,
        "compute_id": w.compute_id,
        "model_config_id": w.model_config_id,
        "archived": w.archived,
        "created_at": w.created_at,
        "updated_at": w.updated_at,
    }
