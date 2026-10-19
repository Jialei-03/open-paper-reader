"""How a research project went, from its record: drift, backtracking, handoffs, cost.

These are the process measures the evaluation reports, computed from the
events every project writes anyway, so any run can be scored afterwards.
"""

from sqlalchemy import select

from . import research_map
from .models import ResearchEvent, ResearchSprint

KILL_SIGNALS = {"yes", "unsure"}


def _ratio(part, whole):
    return round(part / whole, 4) if whole else None


def metrics(d, project):
    sprints = list(
        d.scalars(
            select(ResearchSprint)
            .where(ResearchSprint.project_id == project.id)
            .order_by(ResearchSprint.number)
        )
    )
    number = {s.id: s.number for s in sprints}
    executors = [s for s in sprints if s.role == "executor"]
    events = list(
        d.scalars(
            select(ResearchEvent)
            .where(ResearchEvent.project_id == project.id)
            .order_by(ResearchEvent.created_at)
        )
    )
    judged = [e for e in events if e.action == "drift_judged"]
    off_track = [e for e in judged if not e.detail.get("on_track")]

    # From the first sign a hypothesis may be dead to the sprint it was closed in.
    signal, closed = {}, {}
    for e in events:
        at = number.get(e.sprint_id)
        if at is None or e.node_id is None:
            continue
        if (
            e.action == "record_result"
            and e.detail.get("kill_triggered") in KILL_SIGNALS
        ):
            signal.setdefault(e.node_id, at)
        if e.action == "advice" and e.detail.get("verdict") == "kill":
            signal.setdefault(e.node_id, at)
        if e.action == "update_node" and e.detail.get("after", {}).get("status") in {
            "refuted",
            "abandoned",
        }:
            closed.setdefault(e.node_id, at)
    latencies = [
        closed[n] - signal[n] for n in signal if n in closed and closed[n] >= signal[n]
    ]

    nodes = research_map.nodes(d, project)
    supported = [n for n in nodes if n.status == "supported"]
    evidence = sum(
        len(entry.get("evidence", []))
        for n in nodes
        for entry in [*n.evidence_for, *n.evidence_against]
    )
    return {
        "sprints": {
            "executor": len(executors),
            "advisor": len(sprints) - len(executors),
        },
        "hard_drift_blocks": sum(1 for e in events if e.action == "drift_blocked"),
        "soft_drift_rate": _ratio(len(off_track), len(judged)),
        "backtrack_latency": round(sum(latencies) / len(latencies), 2)
        if latencies
        else None,
        "abnormal_rate": _ratio(
            sum(1 for s in executors if s.status == "abnormal"), len(executors)
        ),
        "evidence_count": evidence,
        "tokens_per_supported": round(
            sum(n.spent_tokens for n in supported) / len(supported)
        )
        if supported
        else None,
        "tokens": project.spent.get("tokens", 0),
    }
