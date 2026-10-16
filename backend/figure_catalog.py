# ruff: noqa: B008
"""Source-backed figure captions and owner-managed reading history."""

from fastapi import Depends, HTTPException, Query
from sqlalchemy import select

from .agent_images import inspect, list_images
from .models import AgentRun, File, Paper


def install_figure_routes(app, settings, db, auth, owned):
    from .link_preview import LinkPreviews
    from .pdf_structure import install

    install(app, settings, db, auth, owned)
    previews = LinkPreviews()

    @app.get("/api/v1/papers/{id}/link-preview")
    def link_preview(
        id: str, url: str = Query(max_length=2000), a=Depends(auth), d=Depends(db)
    ):
        owned(d, Paper, id, a)
        return previews.get(url)

    @app.get("/api/v1/papers/{id}/reading-activity")
    def activity(
        id: str,
        offset: int = Query(default=0, ge=0, le=1000000),
        limit: int = Query(default=50, ge=1, le=50),
        q: str = Query(default="", max_length=200),
        category: str = Query(
            default="all", pattern="^(all|text|image|table|formula|url|paper)$"
        ),
        kind: str = Query(
            default="all", pattern="^(all|highlight|comment|explanation|translation)$"
        ),
        a=Depends(auth),
        d=Depends(db),
    ):
        from .reading_activity import activity_query

        owned(d, Paper, id, a)
        rows = (
            d.execute(
                activity_query(a["id"], id, kind, q, category)
                .offset(offset)
                .limit(limit + 1)
            )
            .mappings()
            .all()
        )
        return {
            "items": [dict(row) for row in rows[:limit]],
            "next": offset + limit if len(rows) > limit else None,
        }

    @app.delete("/api/v1/papers/{id}/reading-activity/{run_id}")
    def remove_activity(id: str, run_id: str, a=Depends(auth), d=Depends(db)):
        owned(d, Paper, id, a)
        row = owned(d, AgentRun, run_id, a)
        runtime = row.runtime or {}
        source = runtime.get("reader_context") or {}
        if source.get("paper_id") != id or runtime.get("reading_artifact_id"):
            raise HTTPException(404, "not found")
        if row.status in {"queued", "running"}:
            raise HTTPException(409, "请先停止生成，再移除记录")
        # History is an index into conversations. Removing a history entry must
        # never destroy a shared conversation or its model usage accounting.
        row.runtime = {**runtime, "activity_hidden": True}
        d.commit()
        return {"removed": 1}

    @app.delete("/api/v1/papers/{id}/reading-activity")
    def clear_activity(
        id: str,
        q: str = Query(default="", max_length=200),
        category: str = Query(
            default="all", pattern="^(all|text|image|table|formula|url|paper)$"
        ),
        kind: str = Query(pattern="^(explanation|translation)$"),
        a=Depends(auth),
        d=Depends(db),
    ):
        from .reading_activity import activity_query

        owned(d, Paper, id, a)
        rows = d.execute(activity_query(a["id"], id, kind, q, category)).mappings()
        ids = [row["id"] for row in rows if row["status"] not in {"queued", "running"}]
        count = 0
        for run_id in ids:
            row = d.get(AgentRun, run_id)
            if row and row.owner == a["id"] and row.status not in {"queued", "running"}:
                row.runtime = {**(row.runtime or {}), "activity_hidden": True}
                count += 1
        d.commit()
        return {"removed": count}

    @app.get("/api/v1/papers/{id}/reading-activity/export")
    def activity_export(
        id: str,
        q: str = Query(default="", max_length=200),
        category: str = Query(
            default="all", pattern="^(all|text|image|table|formula|url|paper)$"
        ),
        kind: str = Query(
            default="all", pattern="^(all|highlight|comment|explanation|translation)$"
        ),
        a=Depends(auth),
        d=Depends(db),
    ):
        from fastapi.responses import Response

        from .reading_activity import activity_query, export_markdown

        owned(d, Paper, id, a)
        rows = d.execute(
            activity_query(a["id"], id, kind, q, category)
            .limit(10001)
            .execution_options(yield_per=50)
        ).mappings()
        return Response(
            export_markdown(rows, id),
            media_type="text/markdown",
            headers={
                "Content-Disposition": 'attachment; filename="reading-activity.md"',
                "Cache-Control": "no-store",
            },
        )

    @app.get("/api/v1/papers/{id}/figure-assets")
    def assets(id: str, a=Depends(auth), d=Depends(db)):
        owned(d, Paper, id, a)
        try:
            return list_images(app, a["id"], id)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @app.get("/api/v1/files/{id}/figure-captions")
    def captions(id: str, a=Depends(auth), d=Depends(db)):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf":
            raise HTTPException(422, "图表标题索引仅支持 PDF")
        try:
            return inspect(settings, file.id, operation="captions")
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @app.get("/api/v1/papers/{id}/explanations")
    def explanations(
        id: str,
        q: str = Query(default="", max_length=200),
        category: str = Query(
            default="all", pattern="^(all|selection|page|region|paper)$"
        ),
        offset: int = Query(default=0, ge=0, le=10000),
        a=Depends(auth),
        d=Depends(db),
    ):
        owned(d, Paper, id, a)
        source = AgentRun.runtime["reader_context"]
        stmt = select(AgentRun).where(
            AgentRun.owner == a["id"],
            AgentRun.status == "completed",
            AgentRun.response != "",
            source["paper_id"].as_string() == id,
            AgentRun.runtime["reading_artifact_id"].as_string().is_(None),
        )
        if category != "all":
            stmt = stmt.where(source["source"].as_string() == category)
        if q.strip():
            term = (
                q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            stmt = stmt.where(
                AgentRun.response.ilike(f"%{term}%", escape="\\")
                | AgentRun.prompt.ilike(f"%{term}%", escape="\\")
            )
        rows = list(
            d.scalars(
                stmt.order_by(AgentRun.created_at.desc(), AgentRun.id)
                .offset(offset)
                .limit(31)
            )
        )
        result = []
        for row in rows[:30]:
            context = row.runtime["reader_context"]
            file = d.get(File, context.get("file_id"))
            if not file or file.owner != a["id"] or file.paper_id != id:
                continue
            result.append(
                {
                    "id": row.id,
                    "session_id": row.session_id,
                    "prompt": row.prompt[:500],
                    "excerpt": row.response[:1200],
                    "category": context.get("source", "paper"),
                    "file_id": file.id,
                    "page": context.get("page", 1),
                    "quote": context.get("quote", "")[:1000],
                    "created_at": row.created_at,
                }
            )
        return {"items": result, "next": offset + 30 if len(rows) > 30 else None}
