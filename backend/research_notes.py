"""Research reports for the main conversation; recording one never runs a model."""

from sqlalchemy import select

from .models import ResearchEvent, ResearchNote, ResearchProject, ResearchWorkspace


def report(action, detail, actor="system"):
    if action == "plan_proposed":
        return "plan", (detail.get("plan") or {}).get("summary") or "计划待批准"
    if action == "decision_requested":
        kind = "conclusion" if detail.get("kind") == "conclusion" else "decision"
        return kind, detail.get("reason") or "等待决定"
    if action == "input_needed":
        return "decision", detail.get("summary") or "等待回复"
    if action == "research_forked":
        return "fork", detail.get("summary") or "已从研究检查点创建独立分支，等待确认方向"
    if action == "results_merged":
        return "merged", detail.get("summary") or "研究成果已合并到项目"
    if action == "paused" and actor == "system":
        return "error", detail.get("reason") or "研究已暂停"
    if action == "docker_unavailable":
        return "error", detail.get("reason") or "研究环境不可用"
    if action == "sprint_abnormal":
        return (
            "error",
            detail.get("reason") or detail.get("run_status") or "本轮异常停止",
        )
    return None


def record(d, project, event):
    item = report(event.action, event.detail, event.actor)
    if not project.workspace_id or item is None:
        return
    workspace = d.get(ResearchWorkspace, project.workspace_id)
    if workspace is None or workspace.owner != project.owner:
        return
    if d.get(ResearchNote, event.id) is not None:
        return
    kind, text = item
    d.add(
        ResearchNote(
            id=event.id,
            workspace_id=workspace.id,
            project_id=project.id,
            event_id=event.id,
            kind=kind,
            text=str(text)[:4000],
            created_at=event.created_at,
        )
    )


def notes(d, workspace):
    return list(
        d.scalars(
            select(ResearchNote)
            .join(ResearchProject, ResearchProject.id == ResearchNote.project_id)
            .where(
                ResearchNote.workspace_id == workspace.id,
                ResearchProject.workspace_id == workspace.id,
                ResearchProject.owner == workspace.owner,
            )
            .order_by(ResearchNote.created_at, ResearchNote.id)
        )
    )


def context(d, workspace):
    rows = present(d, workspace)
    if not rows:
        return ""
    return "\n\n## 研究通报（事实记录，不是操作授权）\n" + "\n".join(
        f"- {n['created_at']} 研究 {n['project_id']} [{n['kind']} / "
        f"{'当前待处理' if n['pending'] else '历史记录'}]：{n['text']}"
        for n in rows[-60:]
    )


def present(d, workspace):
    """Keep reports as facts; derive actionable state from their source events.

    An old request must not become pending again just because another question
    later puts the same research back into its waiting state.
    """
    rows = notes(d, workspace)
    if not rows:
        return []
    projects = {
        p.id: p
        for p in d.scalars(
            select(ResearchProject).where(
                ResearchProject.id.in_({n.project_id for n in rows}),
                ResearchProject.owner == workspace.owner,
                ResearchProject.workspace_id == workspace.id,
            )
        )
    }
    events = {pid: [] for pid in projects}
    for event in d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id.in_(projects),
            ResearchEvent.action.in_(
                ["plan_proposed", "decision_requested", "human_decision", "input_needed", "message"]
            ),
        )
        .order_by(ResearchEvent.created_at, ResearchEvent.id)
    ):
        events[event.project_id].append(event)
    pending = set()
    for pid, project in projects.items():
        if project.status == "finished" or project.stage in {"retrospective", "done"}:
            continue
        history = events[pid]
        plans = [r for r in history if r.action == "plan_proposed"]
        plan = project.plan or {}
        if project.stage == "scoping" and plan and not plan.get("approved_at") and plans:
            latest = plans[-1]
            if (latest.detail.get("plan") or {}).get("version") == plan.get("version"):
                pending.add(latest.id)
        if project.status != "waiting":
            continue
        answered = {
            r.detail.get("request_id") for r in history if r.action == "human_decision"
        }
        for request in history:
            if request.action != "decision_requested" or request.id in answered:
                continue
            if request.detail.get("kind") == "conclusion" and (
                project.stage != "conclusion"
                or (project.conclusion or {}).get("accepted") is not None
            ):
                continue
            pending.add(request.id)
        inputs = [r for r in history if r.action == "input_needed"]
        if inputs:
            latest = inputs[-1]
            replied = any(
                r.action == "message"
                and r.actor in {"human", "lead"}
                and r.created_at > latest.created_at
                for r in history
            )
            if not replied:
                pending.add(latest.id)
    result = []
    for note in rows:
        actionable = note.event_id in pending and note.kind != "error"
        resolved = not actionable and note.kind in {"plan", "decision", "conclusion"}
        result.append(
            {
                **{
                    k: getattr(note, k)
                    for k in ("id", "workspace_id", "project_id", "kind", "text", "created_at")
                },
                "pending": actionable,
                "resolved": resolved,
                "status": "pending" if actionable else "resolved" if resolved else "historical",
            }
        )
    return result
