"""A paper keeps one finished full translation per engine: the newest.

Called after a translation job has been committed as completed, never before:
until the new result is saved the previous one stays listed and downloadable,
and a failed re-run leaves it alone. The older jobs of the same engine (also
those of earlier versions of the paper) are then removed together with the
translated files and archives only they used. The original PDFs are never
touched. A file that carries the reader's own marks (ink, text annotations) or
an active share is kept, with its job, rather than lose them.
"""

import logging
from pathlib import Path

from sqlalchemy import delete, select

from . import thumbnails
from .models import (
    File,
    InkStroke,
    ReadingArtifact,
    TextAnnotation,
    TranslationJob,
)
from .paper_shares import PaperShare
from .storage_budget import lock_owner

LOG = logging.getLogger(__name__)
ACTIVE = ("queued", "running")


def outputs(job):
    return [
        identifier
        for identifier in (
            job.translated_file,
            job.translated_archive,
            job.source_archive,
        )
        if identifier
    ]


def supersede(settings, maker, job_id):
    """Remove what the completed job `job_id` replaces; returns the removed job ids."""
    with maker() as d:
        job = d.get(TranslationJob, job_id)
        if not job or job.status != "completed" or not job.translated_file:
            return []
        lock_owner(d, job.owner)
        d.refresh(job)
        if job.status != "completed":
            return []
        older = list(
            d.scalars(
                select(TranslationJob).where(
                    TranslationJob.owner == job.owner,
                    TranslationJob.paper_id == job.paper_id,
                    TranslationJob.engine == job.engine,
                    TranslationJob.id != job.id,
                    TranslationJob.status.not_in(ACTIVE),
                    TranslationJob.created_at <= job.created_at,
                )
            )
        )
        if not older:
            return []
        gone = {j.id for j in older}
        # Files other jobs still need: the new job's, the originals, and any job we keep.
        keep = set(outputs(job)) | {job.source_file}
        for other in d.scalars(
            select(TranslationJob).where(
                TranslationJob.owner == job.owner, TranslationJob.id.not_in(gone)
            )
        ):
            keep |= set(outputs(other)) | {other.source_file}
        removed, files = [], []
        for old in older:
            doomed = [i for i in outputs(old) if i not in keep and i != old.source_file]
            marked = (
                (
                    d.scalar(
                        select(InkStroke.id)
                        .where(
                            InkStroke.file_id.in_(doomed), InkStroke.deleted.is_(False)
                        )
                        .limit(1)
                    )
                    or d.scalar(
                        select(TextAnnotation.id)
                        .where(TextAnnotation.file_id.in_(doomed))
                        .limit(1)
                    )
                    or d.scalar(
                        select(PaperShare.id)
                        .where(
                            PaperShare.file_id.in_(doomed), PaperShare.revoked_at == ""
                        )
                        .limit(1)
                    )
                )
                if doomed
                else None
            )
            if marked:
                continue
            for identifier in doomed:
                row = d.get(File, identifier)
                if row is None or row.owner != job.owner:
                    continue
                for model in (InkStroke, TextAnnotation, ReadingArtifact, PaperShare):
                    d.execute(delete(model).where(model.file_id == identifier))
                d.delete(row)
                files.append(identifier)
            d.delete(old)
            removed.append(old.id)
        d.commit()
    for identifier in files:
        (Path(settings.storage) / identifier).unlink(missing_ok=True)
        thumbnails.remove(settings, identifier)
    return removed


def supersede_quietly(settings, maker, job_id):
    """The finished job is already saved; tidying up after it must never fail it."""
    try:
        return supersede(settings, maker, job_id)
    except Exception:
        LOG.exception("Could not remove the translations job %s replaces", job_id)
        return []
