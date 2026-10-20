"""The stages of a research project, and the two points where a person decides.

scoping       the executor turns the question into a plan on the map:
              hypotheses, each with what would kill it. No experiments yet.
              Ends when a person approves the plan.
experiments   the loop of executor and advisor sprints.
conclusion    the advisor has proposed an answer; it stands once a person
              accepts it. Asking for more sends the project back.
retrospective the distiller turns the project into candidate playbook rules.
done

Evaluation runs (budget.auto_decide) have nobody to ask: they skip scoping
and their conclusions stand as proposed.
"""

from sqlalchemy import select

from . import research_map
from .models import ResearchEvent, now

STAGES = ("scoping", "experiments", "conclusion", "retrospective", "done")


def set_stage(d, project, stage, actor="system", note=""):
    if stage not in STAGES:
        raise ValueError(f"未知阶段：{stage}")
    if project.stage == stage:
        return
    before = project.stage
    project.stage = stage
    project.updated_at = now()
    research_map.event(
        d,
        project,
        None,
        actor,
        "stage_changed",
        {"from": before, "to": stage, "note": note},
    )


def open_request(d, project, kind):
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
    return next(
        (
            r
            for r in rows
            if r.action == "decision_requested"
            and r.detail.get("kind") == kind
            and r.id not in answered
        ),
        None,
    )


def say(d, project, actor, text, sprint_id=None):
    """One message of the conversation the research is shaped by."""
    text = (text or "").strip()
    if not text:
        raise ValueError("消息不能为空")
    research_map.event(
        d, project, None, actor, "message", {"text": text[:8000]}, sprint_id
    )
    project.updated_at = now()


def unanswered(d, project):
    """The person's messages since anyone last replied to them, oldest first."""
    rows = list(
        d.scalars(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "message",
            )
            .order_by(ResearchEvent.created_at, ResearchEvent.id)
        )
    )
    waiting = []
    for row in rows:
        if row.actor == "human":
            waiting.append(row.detail.get("text", ""))
        else:
            waiting = []
    return waiting


def conversation(d, project, limit=40):
    rows = list(
        d.scalars(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action.in_(["message", "plan_proposed"]),
            )
            .order_by(ResearchEvent.created_at.desc(), ResearchEvent.id.desc())
            .limit(limit)
        )
    )
    return list(reversed(rows))


def check_plan(settings, args, version):
    from . import research_datasets, research_settings

    hypotheses = args.get("hypotheses") or []
    if not 1 <= len(hypotheses) <= 8:
        raise ValueError("计划需要 1 到 8 个假设")
    for h in hypotheses:
        if not (h.get("title") or "").strip() or not (h.get("kill_if") or "").strip():
            raise ValueError("每个假设都要有标题和止损条件（kill_if）")
    for name in args.get("datasets", []):
        if name not in research_datasets.REGISTRY:
            raise ValueError(
                f"不认识的数据集：{name}（可选：{', '.join(research_datasets.REGISTRY)}）"
            )
    compute_id = (
        args.get("compute_id") or research_settings.load(settings)["default_compute"]
    )
    research_settings.compute(settings, compute_id)
    budget = args.get("budget") or {}
    return {
        "version": version,
        "question": (args.get("question") or "").strip()[:2000],
        "goal": (args.get("goal") or "").strip()[:1000],
        "metric": (args.get("metric") or "").strip()[:300],
        "baseline": (args.get("baseline") or "").strip()[:500],
        "hypotheses": [
            {
                "title": h["title"].strip()[:300],
                "kill_if": h["kill_if"].strip()[:500],
                "value": h.get("value", ""),
                "cost": h.get("cost", ""),
            }
            for h in hypotheses
        ],
        "datasets": list(dict.fromkeys(args.get("datasets", []))),
        "compute_id": compute_id,
        # No limit unless the researcher wants one.
        "budget": {
            "max_sprints": int(min(max(budget["max_sprints"], 2), 200))
            if budget.get("max_sprints")
            else None,
            "max_job_hours": float(min(max(budget["max_job_hours"], 0.1), 1000))
            if budget.get("max_job_hours")
            else None,
        },
        "summary": (args.get("summary") or "").strip()[:2000],
        "approved_at": None,
    }


def propose_plan(settings, d, project, sprint, args):
    """A version of the plan, shown as a card in the conversation."""
    if project.stage != "scoping":
        raise ValueError("计划只在定题阶段提出；之后的改动走导师的判断")
    plan = check_plan(settings, args, (project.plan or {}).get("version", 0) + 1)
    project.plan = plan
    research_map.event(
        d, project, None, "advisor", "plan_proposed", {"plan": plan}, sprint.id
    )
    return {"version": plan["version"]}


def approve_plan(settings, d, project, version, note=""):
    """The person agrees: the plan goes onto the map and experiments begin."""
    from . import research_datasets

    plan = project.plan or {}
    if project.stage != "scoping":
        raise ValueError("项目已经过了定题阶段")
    if not plan or plan.get("version") != version:
        raise ValueError("计划已经更新过，请看最新的版本")
    root = research_map.root(d, project)
    if plan.get("question"):
        project.question = plan["question"]
        root.title = plan["question"][:300]
    for h in plan["hypotheses"]:
        research_map.add_node(
            d,
            project,
            root.id,
            "hypothesis",
            h["title"],
            kill_if=h["kill_if"],
            value=h.get("value", ""),
            cost=h.get("cost", ""),
            actor="human",
            reason="计划里的假设，研究者批准",
        )
    research_datasets.request(d, project, plan["datasets"])
    project.compute_id = plan["compute_id"]
    sprints, hours = plan["budget"]["max_sprints"], plan["budget"]["max_job_hours"]
    project.budget = {
        **project.budget,
        "max_sprints": project.spent.get("sprints", 0) + sprints if sprints else None,
        "max_tokens": project.budget.get("max_tokens") if sprints or hours else None,
        "max_job_seconds": int(hours * 3600) if hours else None,
    }
    project.plan = {**plan, "approved_at": now()}
    project.status = "active"
    set_stage(d, project, "experiments", "human", note)


def propose_conclusion(d, project, sprint, conclusion):
    """The advisor's answer, held until a person accepts it."""
    project.conclusion = {
        "status": conclusion["status"],
        "answer": conclusion.get("answer_to_question", ""),
        "summary": conclusion.get("summary", "")[:4000],
        "proposed_at": now(),
        "accepted": None,
        "note": "",
    }
    set_stage(d, project, "conclusion", "advisor")
    research_map.event(
        d,
        project,
        None,
        "advisor",
        "decision_requested",
        {
            "kind": "conclusion",
            "proposal": "accept_conclusion",
            "status": conclusion["status"],
            "reason": conclusion.get("summary", "")[:2000],
        },
        sprint.id,
    )
    project.status = "waiting"


def finish(d, project, status, summary, actor, sprint_id=None):
    """The question is answered: the root node closes and the project ends."""
    project.status = "finished"
    project.end_reason = status
    root = research_map.root(d, project)
    research_map.update_node(
        d,
        root,
        status="supported" if status == "concluded" else "refuted",
        actor=actor,
        sprint_id=sprint_id,
        reason="结束项目：" + summary[:300],
    )
    research_map.event(
        d,
        project,
        None,
        actor,
        "concluded",
        {"status": status, "summary": summary},
        sprint_id,
    )
    set_stage(d, project, "retrospective", actor)


def request_budget(d, project):
    """The budget is spent: the researcher decides whether to give more or stop."""
    if open_request(d, project, "budget") is not None:
        return
    max_sprints = int(project.budget.get("max_sprints") or 0)
    extra = max(4, max_sprints // 3)
    research_map.event(
        d,
        project,
        None,
        "system",
        "decision_requested",
        {
            "kind": "budget",
            "proposal": "extend_budget",
            "extra_sprints": extra,
            "reason": (
                f"预算用完了：{project.spent.get('sprints', 0)}/{max_sprints} 轮，"
                f"实验 {round(project.spent.get('job_seconds', 0) / 3600, 1)}/"
                f"{round(project.budget.get('max_job_seconds', 0) / 3600, 1)} 小时。"
                f"同意就再给 {extra} 轮继续；不同意就到此为止，进入复盘。"
            ),
        },
    )
    project.status = "waiting"
    project.updated_at = now()


def extend(d, project, sprints, hours=0.0, actor="human", note=""):
    """More rounds (and experiment hours); a project the budget ended is reopened."""
    budget = dict(project.budget)
    budget["max_sprints"] = max(
        int(budget.get("max_sprints") or 0), int(project.spent.get("sprints", 0))
    ) + int(sprints)
    if hours:
        budget["max_job_seconds"] = max(
            int(budget.get("max_job_seconds") or 0),
            int(project.spent.get("job_seconds", 0)),
        ) + int(hours * 3600)
    project.budget = budget
    research_map.event(
        d,
        project,
        None,
        actor,
        "budget_extended",
        {"sprints": int(sprints), "hours": hours, "note": note},
    )
    if project.status == "finished" and project.end_reason == "budget":
        project.end_reason = ""
        set_stage(d, project, "experiments", actor, note)
    project.status = "active"
    project.updated_at = now()


def lift_limits(d, project, note=""):
    """No limits: the research goes on until it is answered or someone stops it."""
    project.budget = {
        **project.budget,
        "max_sprints": None,
        "max_tokens": None,
        "max_job_seconds": None,
    }
    research_map.event(
        d, project, None, "human", "budget_extended", {"unlimited": True, "note": note}
    )
    if project.status == "finished" and project.end_reason == "budget":
        project.end_reason = ""
        set_stage(d, project, "experiments", "human", note)
    if project.status in {"finished", "waiting"} and not project.end_reason:
        project.status = "active"
    project.updated_at = now()


def end_on_budget(d, project, actor="system"):
    set_stage(d, project, "retrospective", actor)
    project.status, project.end_reason = "finished", "budget"
    project.updated_at = now()
    research_map.event(d, project, None, actor, "finished", {"end_reason": "budget"})


def decide(d, project, request, approve, note):
    """A person's answer to a plan or a conclusion. True if it was one of those."""
    kind = request.detail.get("kind")
    if kind == "budget":
        if approve:
            hours = 0.0
            if project.spent.get("job_seconds", 0) >= project.budget.get(
                "max_job_seconds", 0
            ):
                hours = max(1.0, project.budget.get("max_job_seconds", 0) / 3600 / 3)
            extend(d, project, request.detail.get("extra_sprints", 4), hours, note=note)
        else:
            end_on_budget(d, project, "human")
        return True
    if kind == "plan":
        if approve:
            set_stage(d, project, "experiments", "human", note)
        project.status = "active"
        return True
    if kind == "conclusion":
        if approve:
            project.conclusion = {
                **project.conclusion,
                "accepted": True,
                "note": note,
                "decided_at": now(),
            }
            finish(
                d,
                project,
                project.conclusion.get("status", "concluded"),
                project.conclusion.get("summary", ""),
                "human",
                request.sprint_id,
            )
        else:
            project.conclusion = {
                **project.conclusion,
                "accepted": False,
                "note": note,
                "decided_at": now(),
            }
            set_stage(d, project, "experiments", "human", note)
            project.status = "active"
        return True
    return False


def human_notes(d, project, limit=3):
    """What a person said when deciding, newest first: guidance for the next sprint."""
    rows = d.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.actor == "human",
            ResearchEvent.action.in_(
                ["human_decision", "stage_changed", "note", "question_changed"]
            ),
        )
        .order_by(ResearchEvent.created_at.desc())
        .limit(10)
    )
    notes = []
    for row in rows:
        text = (row.detail.get("note") or "").strip()
        if text and text not in notes:
            notes.append(text)
    return notes[:limit]
