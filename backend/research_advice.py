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
# Verdicts that would close the node they name.
CLOSING = {"kill", "pivot"}


def _node(d, project, node_id):
    try:
        node = research_map.node_by_prefix(d, project, node_id or "")
    except ValueError:
        return None
    return node if research_map.is_live(d, node) else None


def act(d, project, sprint, node, kind, item):
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


def _estimate(node, item):
    """The advisor's own view of what a node is worth and costs, when it gives one."""
    for field in ("value", "cost"):
        level = item.get(field)
        if level in {"high", "medium", "low"}:
            setattr(node, field, level)


def apply(d, project, sprint, args):
    """Applies an `advise` call; {"applied", "skipped", "concluded"}."""
    applied = skipped = 0
    # Why each skipped verdict was not applied, so the advisor does not repeat it.
    notes = []
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
            notes.append(
                f"{item.get('node_id')}：找不到这个节点，或它已经关闭，判断没有生效。"
            )
            skipped += 1
            continue
        _estimate(node, item)
        if kind == "ask_human":
            proposal = item.get("proposal", "continue")
            if auto:
                try:
                    done = (
                        not (node.parent_id is None and proposal in CLOSING)
                    ) and act(d, project, sprint, node, proposal, item)
                except ValueError:
                    done = False
                research_map.event(
                    d,
                    project,
                    node,
                    "system",
                    "auto_decided",
                    {"proposal": proposal, "applied": done},
                    sprint.id,
                )
            elif project.status == "active":
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
        why = ""
        if node.parent_id is None and kind in CLOSING:
            # The question itself is not dropped; when it is answered, the advisor concludes.
            done = False
            why = (
                "北极星问题本身不能放弃或转向。它已经有答案时，用 conclude 结束项目，"
                "并填 answer_to_question（答案是否定的就填 no）。"
            )
        else:
            try:
                done = act(d, project, sprint, node, kind, item)
            except ValueError as e:
                done = False
                why = str(e)
        if not done:
            notes.append(
                f"{node.id[: research_map.PREFIX]}（{kind}）没有生效：{why or '这个判断现在做不了'}"
            )
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
        answer = conclusion.get("answer_to_question")
        if answer in {"yes", "no", "not_yes_no"}:
            conclusion = {
                **conclusion,
                "status": "refuted" if answer == "no" else "concluded",
            }
    if conclusion and conclusion.get("status") == "blocked":
        # Nothing can move until a person provides something: say what, then wait
        # (an evaluation run, with nobody to provide it, ends here).
        summary = conclusion.get("summary", "")[:1000]
        if project.status in {"active", "waiting"}:
            if project.budget.get("auto_decide"):
                project.status, project.end_reason = "finished", "blocked"
            else:
                project.status = "waiting"
        research_map.event(
            d, project, None, "advisor", "input_needed", {"summary": summary}, sprint.id
        )
        conclusion = None
    recorded = any(
        n.evidence_for or n.evidence_against for n in research_map.nodes(d, project)
    )
    if conclusion and not recorded:
        # What the advisor read in the logs must first be recorded on the map.
        research_map.event(
            d,
            project,
            None,
            "advisor",
            "conclude_rejected",
            {
                "why": "地图上还没有记录过结果：先让执行者用 record_result 记下支持结论的证据",
                "summary": conclusion.get("summary", "")[:500],
            },
            sprint.id,
        )
        conclusion = None
    if (
        conclusion
        and conclusion.get("status") in {"concluded", "refuted"}
        and project.status in {"active", "waiting"}
    ):
        project.status = "finished"
        project.end_reason = conclusion["status"]
        # The question itself is now answered, one way or the other.
        root = research_map.root(d, project)
        research_map.update_node(
            d,
            root,
            status="supported" if conclusion["status"] == "concluded" else "refuted",
            actor="advisor",
            sprint_id=sprint.id,
            reason="导师结束项目：" + conclusion.get("summary", "")[:300],
        )
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
    out = {"applied": applied, "skipped": skipped, "concluded": concluded}
    return out | {"notes": notes} if notes else out
