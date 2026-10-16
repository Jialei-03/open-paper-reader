# ruff: noqa: B008
"""Idempotent control plane for durable, version-scoped paper preparation."""

from typing import Literal

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import load_only

from .models import (
    File,
    Paper,
    PaperPreparation,
    PreparationSetting,
    TranslationJob,
    now,
    public,
)
from .storage_budget import lock_owner


class PreparationInput(BaseModel):
    action: Literal["ensure", "pause", "resume", "retry"] = "ensure"


class SettingInput(BaseModel):
    enabled: bool


def enabled(d, owner):
    row = d.get(PreparationSetting, owner)
    return row is None or row.enabled


def source_file(d, paper):
    translations = select(TranslationJob.translated_file).where(
        TranslationJob.owner == paper.owner, TranslationJob.translated_file != ""
    )
    return d.scalar(
        select(File)
        .where(
            File.owner == paper.owner,
            File.paper_id == paper.id,
            File.version_id == paper.current_version,
            File.mime == "application/pdf",
            File.pages > 0,
            File.id.not_in(translations),
        )
        .order_by(File.created_at, File.id)
    )


def ensure(d, paper, priority=0):
    file = source_file(d, paper)
    if not file:
        return None
    lock_owner(d, paper.owner)
    row = d.scalar(
        select(PaperPreparation).where(
            PaperPreparation.owner == paper.owner, PaperPreparation.file_id == file.id
        )
    )
    if row is None:
        row = PaperPreparation(
            owner=paper.owner,
            paper_id=paper.id,
            file_id=file.id,
            version_id=file.version_id,
            priority=priority,
        )
        d.add(row)
        d.flush()
    elif priority > row.priority:
        row.priority = priority
    return row


def layout_job(d, row):
    return d.scalar(
        select(TranslationJob).where(
            TranslationJob.owner == row.owner,
            TranslationJob.paper_id == row.paper_id,
            TranslationJob.version_id == row.version_id,
            TranslationJob.source_file == row.file_id,
        ).order_by((TranslationJob.status == "completed").desc(),
                   TranslationJob.created_at.desc(), TranslationJob.id.desc())
    )


def preparation_view(row, job, is_enabled):
    result = {**public(row), "enabled": is_enabled, "layout_progress": None}
    if job:
        # Never expose provider credentials/configuration through the overview.
        result["layout_progress"] = {
            "status": job.status, "stage": job.stage, "error": job.error,
            "completed": job.completed, "total": job.total,
        }
        result["layout_status"] = job.status
        # The layout worker reports live progress; the parent reconciles later.
        # A paused parent remains paused, even if its child finished just before it.
        if row.status == "waiting" and row.translation_status == "completed":
            if job.status == "completed" and row.guide_status == "completed":
                result.update(status="completed", stage="全部就绪", error="")
            elif job.status in {"failed", "cancelled"}:
                result.update(status="failed", stage="布局生成未完成", error=job.error or "请重试布局生成")
            elif job.status in {"queued", "running"}:
                result["stage"] = job.stage
                result["status"] = job.status
    return result


def output(d, owner, row):
    if row:
        return preparation_view(row, layout_job(d, row), enabled(d, owner))
    return {
        "enabled": enabled(d, owner),
        "status": "waiting",
        "stage": "等待可读取的原文 PDF",
        "error": "",
        "completed": 0,
        "total": 0,
        "guide_status": "waiting",
        "translation_status": "waiting",
        "layout_status": "waiting",
    }


def install_preparation_routes(app, settings, db, auth, human, owned):
    @app.get("/api/v1/preparations")
    def overview(
        status: Literal["all", "active", "failed", "completed", "paused"] = "all",
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=100),
        a=Depends(auth), d=Depends(db),
    ):
        owner = a["id"]
        is_enabled = enabled(d, owner)
        # Version changes and archived papers must not resurrect old tasks.
        candidates = list(d.execute(
            select(PaperPreparation, Paper.title, File.created_at)
            .join(Paper, Paper.id == PaperPreparation.paper_id)
            .join(File, File.id == PaperPreparation.file_id)
            .where(
                PaperPreparation.owner == owner, Paper.owner == owner,
                File.owner == owner, File.paper_id == Paper.id,
                File.mime == "application/pdf", File.pages > 0,
                File.version_id == Paper.current_version,
                PaperPreparation.version_id == Paper.current_version,
                Paper.archived == False,
            ).order_by(File.created_at, File.id)
        ))
        # ensure() prepares the earliest original PDF of the current version.
        translated = set(d.scalars(select(TranslationJob.translated_file).where(
            TranslationJob.owner == owner, TranslationJob.translated_file != ""
        )))
        chosen = {}
        for row, title, _ in candidates:
            if row.file_id not in translated:
                chosen.setdefault(row.paper_id, (row, title))
        jobs = {}
        if chosen:
            for job in d.scalars(select(TranslationJob).options(load_only(
                TranslationJob.paper_id, TranslationJob.version_id,
                TranslationJob.source_file, TranslationJob.status, TranslationJob.stage,
                TranslationJob.error, TranslationJob.completed, TranslationJob.total,
            )).where(
                TranslationJob.owner == owner,
                TranslationJob.paper_id.in_(chosen),
            ).order_by((TranslationJob.status == "completed").desc(),
                       TranslationJob.created_at.desc(), TranslationJob.id.desc())):
                row = chosen[job.paper_id][0]
                if job.version_id == row.version_id and job.source_file == row.file_id:
                    jobs.setdefault(job.paper_id, job)
        rows = [{**preparation_view(row, jobs.get(row.paper_id), is_enabled),
                 "title": title} for row, title in chosen.values()]
        order = {"failed": 0, "running": 1, "queued": 2, "waiting": 3,
                 "paused": 4, "completed": 5}
        rows.sort(key=lambda r: r["updated_at"], reverse=True)
        rows.sort(key=lambda r: order.get(r["status"], 3))
        summary = {key: sum(r["status"] == key for r in rows)
                   for key in ["failed", "running", "queued", "waiting", "paused", "completed"]}
        summary["active"] = sum(summary[key] for key in ["running", "queued", "waiting"])
        summary["total"] = len(rows)
        filtered = [r for r in rows if status == "all" or
                    (r["status"] in {"running", "queued", "waiting"} if status == "active" else r["status"] == status)]
        return {"enabled": is_enabled, "summary": summary, "total": len(filtered),
                "items": filtered[offset:offset + limit]}

    @app.get("/api/v1/preparation-settings")
    def get_settings(a=Depends(auth), d=Depends(db)):
        return {"enabled": enabled(d, a["id"])}

    @app.patch("/api/v1/preparation-settings")
    def set_settings(body: SettingInput, a=Depends(auth), d=Depends(db)):
        human(a)
        lock_owner(d, a["id"])
        row = d.get(PreparationSetting, a["id"])
        if row is None:
            row = PreparationSetting(owner=a["id"])
            d.add(row)
        row.enabled = body.enabled
        if not body.enabled:
            for parent in d.scalars(
                select(PaperPreparation).where(
                    PaperPreparation.owner == a["id"],
                    PaperPreparation.status.in_(["queued", "running", "waiting"]),
                )
            ):
                parent.status = "paused"
                parent.stage = "已暂停自动准备"
            for job in d.scalars(
                select(TranslationJob).where(
                    TranslationJob.owner == a["id"],
                    TranslationJob.preparation_id != "",
                    TranslationJob.status.in_(["queued", "running"]),
                )
            ):
                job.status = "cancelled"
                job.stage = "已暂停自动准备"
                job.updated_at = now()
        d.commit()
        return {"enabled": row.enabled}

    @app.get("/api/v1/papers/{id}/preparation")
    def get(id: str, a=Depends(auth), d=Depends(db)):
        paper = owned(d, Paper, id, a)
        file = source_file(d, paper)
        row = (
            d.scalar(
                select(PaperPreparation).where(
                    PaperPreparation.owner == a["id"],
                    PaperPreparation.file_id == file.id,
                )
            )
            if file
            else None
        )
        return output(d, a["id"], row)

    @app.post("/api/v1/papers/{id}/preparation")
    def request(id: str, body: PreparationInput, a=Depends(auth), d=Depends(db)):
        human(a)
        paper = owned(d, Paper, id, a)
        row = ensure(d, paper, priority=1)
        if row:
            if body.action == "pause":
                row.status = "paused"
                row.stage = "已暂停自动准备"
                for job in d.scalars(
                    select(TranslationJob).where(
                        TranslationJob.owner == a["id"],
                        TranslationJob.preparation_id == row.id,
                        TranslationJob.status.in_(["queued", "running"]),
                    )
                ):
                    job.status = "cancelled"
                    job.stage = "已暂停自动准备"
                    job.updated_at = now()
            elif body.action in {"resume", "retry"} and row.status in {
                "paused",
                "failed",
                "waiting",
            }:
                row.status = "queued"
                row.error = ""
                row.attempts = 0
                row.retry_at = ""
                row.stage = "等待继续准备"
                job = d.scalar(
                    select(TranslationJob)
                    .where(
                        TranslationJob.owner == a["id"],
                        TranslationJob.preparation_id == row.id,
                        TranslationJob.status.in_(["failed", "cancelled"]),
                    )
                    .order_by(TranslationJob.created_at.desc())
                )
                if job:
                    job.status = "queued"
                    job.error = ""
                    job.stage = "等待继续排版"
                    job.updated_at = now()
                    row.layout_status = "queued"
            row.updated_at = now()
            d.commit()
        return output(d, a["id"], row)
