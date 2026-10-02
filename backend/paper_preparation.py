# ruff: noqa: B008
"""Idempotent control plane for durable, version-scoped paper preparation."""

from typing import Literal

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import select

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


def output(d, owner, row):
    if row:
        return {**public(row), "enabled": enabled(d, owner)}
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
