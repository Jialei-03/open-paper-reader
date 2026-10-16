"""Owner-scoped reading history, filtered before pagination and export."""

from fastapi import HTTPException
from sqlalchemy import (
    JSON,
    and_,
    case,
    func,
    literal,
    or_,
    select,
    type_coerce,
    union_all,
)

from .models import AgentRun, File, TextAnnotation


def activity_query(owner, paper_id, kind="all", query="", category="all"):
    annotation = (
        select(
            TextAnnotation.id.label("id"),
            case((TextAnnotation.comment != "", "comment"), else_="highlight").label(
                "kind"
            ),
            TextAnnotation.file_id.label("file_id"),
            TextAnnotation.page.label("page"),
            TextAnnotation.quote.label("quote"),
            TextAnnotation.rects.label("rects"),
            TextAnnotation.prefix.label("prefix"),
            TextAnnotation.comment.label("body"),
            TextAnnotation.color.label("color"),
            literal("completed").label("status"),
            literal("").label("session_id"),
            TextAnnotation.updated_at.label("updated_at"),
            literal("").label("prompt"),
            literal("").label("error"),
            literal("text").label("category"),
            type_coerce(literal(None), JSON).label("region"),
        )
        .join(File, File.id == TextAnnotation.file_id)
        .where(
            TextAnnotation.owner == owner,
            TextAnnotation.paper_id == paper_id,
            TextAnnotation.deleted.is_(False),
            File.owner == owner,
            File.paper_id == paper_id,
        )
    )
    source = AgentRun.runtime["reader_context"]
    action = source["action"].as_string()
    # Runs saved before the action was recorded are told apart by their prompt.
    translation = or_(
        action == "translate",
        and_(action.is_(None), AgentRun.prompt.startswith("请将所选文字翻译成中文")),
        and_(
            action.is_(None),
            AgentRun.prompt.startswith("请读取"),
            AgentRun.prompt.contains("翻译成中文"),
        ),
    )
    runs = (
        select(
            AgentRun.id.label("id"),
            case((translation, "translation"), else_="explanation").label("kind"),
            File.id.label("file_id"),
            func.coalesce(source["page"].as_integer(), 1).label("page"),
            func.coalesce(source["quote"].as_string(), "").label("quote"),
            source["rects"].label("rects"),
            func.coalesce(source["prefix"].as_string(), "").label("prefix"),
            AgentRun.response.label("body"),
            literal("").label("color"),
            AgentRun.status.label("status"),
            AgentRun.session_id.label("session_id"),
            AgentRun.updated_at.label("updated_at"),
            AgentRun.prompt.label("prompt"),
            AgentRun.error.label("error"),
            func.coalesce(
                source["category"].as_string(),
                case(
                    (source["source"].as_string() == "region", "image"),
                    (source["source"].as_string() == "paper", "paper"),
                    else_="text",
                ),
            ).label("category"),
            source["rect"].label("region"),
        )
        .join(File, File.id == source["file_id"].as_string())
        .where(
            AgentRun.owner == owner,
            func.coalesce(AgentRun.runtime["activity_hidden"].as_boolean(), False).is_(
                False
            ),
            source["paper_id"].as_string() == paper_id,
            AgentRun.runtime["reading_artifact_id"].as_string().is_(None),
            File.owner == owner,
            File.paper_id == paper_id,
        )
    )
    combined = union_all(annotation, runs).subquery()
    stmt = select(combined)
    if kind != "all":
        stmt = stmt.where(combined.c.kind == kind)
    if category != "all":
        stmt = stmt.where(combined.c.category == category)
    if query.strip():
        term = (
            query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        stmt = stmt.where(
            combined.c.quote.ilike(f"%{term}%", escape="\\")
            | combined.c.body.ilike(f"%{term}%", escape="\\")
            | combined.c.prompt.ilike(f"%{term}%", escape="\\")
            | combined.c.error.ilike(f"%{term}%", escape="\\")
        )
    return stmt.order_by(combined.c.updated_at.desc(), combined.c.id.desc())


def export_markdown(rows, paper_id):
    names = {
        "highlight": "高亮",
        "comment": "评论",
        "explanation": "解释",
        "translation": "翻译",
    }
    states = {
        "queued": "等待处理",
        "running": "正在处理",
        "completed": "已完成",
        "failed": "失败",
        "cancelled": "已停止",
    }
    parts = []
    size = 0
    for index, row in enumerate(rows):
        if index >= 10000:
            raise HTTPException(413, "记录超过单次导出上限 10000 条，请缩小筛选范围")
        quote = (
            "> " + (row["quote"] or "").replace("\n", "\n> ") if row["quote"] else ""
        )
        parts.append(
            f"## {names[row['kind']]} · 第 {row['page']} 页\n\n"
            f"{quote}\n\n{row['body'] or ''}\n\n"
            f"状态：{states.get(row['status'], row['status'])}"
            + (f"\n\n错误：{row['error']}" if row["error"] else "")
            + f"\n\n[返回原文](#paper/{paper_id}?file={row['file_id']}&page={row['page']})"
        )
        size += len(parts[-1].encode("utf-8")) + 7
        if size > 20 * 1024 * 1024:
            raise HTTPException(413, "导出超过 20 MB，请缩小筛选范围")
    body = f"# 阅读活动\n\n共 {len(parts)} 条记录\n\n" + "\n\n---\n\n".join(parts)
    if len(body.encode("utf-8")) > 20 * 1024 * 1024:
        raise HTTPException(413, "导出超过 20 MB，请缩小筛选范围")
    return body
