"""The advisor's judgments, applied to the research map.

The advisor does not touch code or the map directly: it hands in verdicts,
and this module carries them out. A verdict that names a node that is not
there (or is already closed) is skipped and written down; the rest still
take effect. Asking a person stops the project until they decide, except in
evaluation runs (`budget.auto_decide`), where the advisor's proposal is taken.
"""

from . import research_map
from .models import now

VERDICTS = {"continue", "invest", "kill", "pivot", "ask_human"}


def _node(d, project, node_id):
    try:
        node = research_map.node_by_prefix(d, project, node_id or "")
    except ValueError:
        return None
    return node if research_map.is_live(d, node) else None


def _act(d, project, sprint, node, kind, item):
    """Carries out one verdict; False when it cannot be (and nothing changed)."""
    reason = "导师：" + item.get("reason", "")
    if kind == "continue":
        return True
    if kind == "invest":
        research_map.update_node(
            d,
            node,
            doubts=[*node.doubts, "导师建议加注：" + item.get("reason", "")[:200]],
            actor="advisor",
            sprint_id=sprint.id,
            reason=reason,
        )
        return True
    if kind == "kill":
        research_map.update_node(
            d,
            node,
            status="abandoned",
            actor="advisor",
            sprint_id=sprint.id,
            reason=reason,
        )
        return True
    if kind == "pivot":
        new = item.get("new_hypothesis") or {}
        if (
            not (new.get("title") or "").strip()
            or not (new.get("kill_if") or "").strip()
        ):
            return False
        parent = node.parent_id or node.id
        research_map.add_node(
            d,
            project,
            parent,
            "hypothesis",
            new["title"],
            kill_if=new["kill_if"],
            actor="advisor",
            sprint_id=sprint.id,
            reason=reason,
        )
        research_map.update_node(
            d,
            node,
            status="parked",
            actor="advisor",
            sprint_id=sprint.id,
            reason=reason,
        )
        return True
    return False


def apply(d, project, sprint, args):
    """Applies an `advise` call; {"applied", "skipped", "concluded"}."""
    applied = skipped = 0
    auto = bool(project.budget.get("auto_decide"))
    for item in args.get("verdicts", []):
        kind = item.get("verdict")
        node = _node(d, project, item.get("node_id"))
        if node is None or kind not in VERDICTS:
            research_map.event(
                d,
                project,
                None,
                "advisor",
                "advice_skipped",
                {
                    "node_id": item.get("node_id"),
                    "verdict": kind,
                    "why": "unknown_or_closed",
                },
                sprint.id,
            )
            skipped += 1
            continue
        if kind == "ask_human":
            proposal = item.get("proposal", "continue")
            if auto:
                done = _act(d, project, sprint, node, proposal, item)
                research_map.event(
                    d,
                    project,
                    node,
                    "system",
                    "auto_decided",
                    {"proposal": proposal, "applied": done},
                    sprint.id,
                )
            else:
                project.status = "waiting"
                research_map.event(
                    d,
                    project,
                    node,
                    "advisor",
                    "decision_requested",
                    {
                        "node_id": node.id,
                        "proposal": proposal,
                        "reason": item.get("reason", ""),
                        "new_hypothesis": item.get("new_hypothesis"),
                    },
                    sprint.id,
                )
            applied += 1
            continue
        if not _act(d, project, sprint, node, kind, item):
            research_map.event(
                d,
                project,
                node,
                "advisor",
                "advice_skipped",
                {"node_id": node.id, "verdict": kind, "why": "incomplete"},
                sprint.id,
            )
            skipped += 1
            continue
        research_map.event(
            d,
            project,
            node,
            "advisor",
            "advice",
            {"verdict": kind, "reason": item.get("reason", "")},
            sprint.id,
        )
        applied += 1
    for judged in args.get("drift", []):
        research_map.event(
            d,
            project,
            None,
            "advisor",
            "drift_judged",
            {
                "sprint_number": judged.get("sprint_number"),
                "on_track": bool(judged.get("on_track")),
                "note": judged.get("note", ""),
            },
            sprint.id,
        )
    concluded = False
    conclusion = args.get("conclude")
    if conclusion and conclusion.get("status") in {"concluded", "refuted"}:
        project.status = "finished"
        project.end_reason = conclusion["status"]
        research_map.event(
            d,
            project,
            None,
            "advisor",
            "concluded",
            {"status": conclusion["status"], "summary": conclusion.get("summary", "")},
            sprint.id,
        )
        concluded = True
    # The advice is the advisor sprint's handoff.
    sprint.summary = args.get("assessment", "") or sprint.summary
    sprint.status = "ended"
    sprint.updated_at = now()
    project.updated_at = now()
    return {"applied": applied, "skipped": skipped, "concluded": concluded}
