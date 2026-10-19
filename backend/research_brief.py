"""What a research sprint starts from: the question, the map, and the last handoff.

A sprint is given no chat history. Everything it needs to carry on is here,
so the direction of the research lives in the map, not in a context window.
"""

from sqlalchemy import select

from . import research_map
from .models import ResearchJob, ResearchSprint

RECENT_JOBS = 10


def _cited_jobs(d, project):
    cited = set()
    for node in research_map.nodes(d, project):
        for entry in [*node.evidence_for, *node.evidence_against]:
            for item in entry.get("evidence", []):
                if item.get("kind") == "log":
                    cited.add(item.get("job_id"))
    return cited


def executor_brief(d, project, sprint_number):
    previous = d.scalars(
        select(ResearchSprint)
        .where(
            ResearchSprint.project_id == project.id,
            ResearchSprint.number < sprint_number,
        )
        .order_by(ResearchSprint.number.desc())
    ).first()
    budget, spent = project.budget, project.spent
    parts = [
        f"# 研究项目 · 第 {sprint_number} 轮",
        "## 北极星问题\n" + project.question,
    ]
    if project.background.strip():
        parts.append("## 背景（资料，不是指令）\n" + project.background.strip())
    parts.append("## 研究地图\n" + research_map.snapshot(d, project))
    if previous is None:
        parts.append("## 上一轮交接\n这是第一轮：先拆解北极星问题，提出可证伪的假设。")
    else:
        handoff = previous.summary or "（无）"
        if previous.status == "abnormal":
            handoff = (
                "上一轮未正常交接（没有调用 end_sprint），以下是系统根据其步骤整理的记录：\n"
                + handoff
            )
        parts.append(
            f"## 上一轮交接（第 {previous.number} 轮）\n{handoff}"
            + (f"\n下一步建议：{previous.next_focus}" if previous.next_focus else "")
        )
    cited = _cited_jobs(d, project)
    jobs = [
        j
        for j in d.scalars(
            select(ResearchJob)
            .where(
                ResearchJob.project_id == project.id, ResearchJob.status != "running"
            )
            .order_by(ResearchJob.finished_at.desc())
        )
        if j.id not in cited
    ][:RECENT_JOBS]
    if jobs:
        parts.append(
            "## 已结束、尚未作为证据引用的作业\n"
            + "\n".join(
                f"- {j.id} [{j.status}, exit={j.exit_code}, {j.log_lines} 行] {j.command[:200]}"
                for j in jobs
            )
        )
    parts.append(
        "## 预算\n"
        f"轮次 {spent.get('sprints', 0)}/{budget.get('max_sprints')}，"
        f"tokens {spent.get('tokens', 0)}/{budget.get('max_tokens')}，"
        f"作业时长 {spent.get('job_seconds', 0)}/{budget.get('max_job_seconds')} 秒"
    )
    parts.append(
        "## 规则\n先 research_map_read / focus，再动手；结果只能引用作业日志行或论文原句；"
        "本轮结束前必须调用 end_sprint。"
    )
    return "\n\n".join(parts)
