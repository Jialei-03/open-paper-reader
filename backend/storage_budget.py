"""Shared accounting for durable user files; no model credentials or caches."""

import os
import shutil
from pathlib import Path

from sqlalchemy import func, select

from .citations import SavedCitation
from .models import (
    AgentAttachment,
    File,
    InkStroke,
    NoteImage,
    ReadingArtifact,
    TextAnnotation,
    User,
)
from .paper_shares import PaperShare


class StorageBudgetExceeded(ValueError):
    pass


def usage(d, owner):
    return {
        name: int(
            d.scalar(
                select(func.coalesce(func.sum(model.size), 0)).where(
                    model.owner == owner
                )
            )
        )
        for name, model in (
            ("papers", File),
            ("handwriting", InkStroke),
            ("text_annotations", TextAnnotation),
            ("reading_artifacts", ReadingArtifact),
            ("saved_citations", SavedCitation),
            ("paper_shares", PaperShare),
            ("note_images", NoteImage),
            ("chat_attachments", AgentAttachment),
        )
    }


def lock_owner(d, owner):
    # NO KEY UPDATE serializes quota checks without conflicting with FK key-share
    # locks already held by an arXiv import in the same transaction.
    d.scalar(select(User).where(User.id == owner).with_for_update(key_share=True))


def require_space(d, settings, owner, incoming):
    lock_owner(d, owner)
    if sum(usage(d, owner).values()) + incoming > settings.storage_limit:
        raise StorageBudgetExceeded("账号存储空间不足，无法保存新文件")
    if shutil.disk_usage(settings.storage).free - incoming < settings.storage_min_free:
        raise StorageBudgetExceeded(
            "服务器可用空间不足，暂时无法保存新文件，请稍后重试"
        )


def write_blob(settings, identifier, data):
    path = Path(settings.storage) / identifier
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as out:
            if os.geteuid() == 0:
                info = Path(settings.storage).stat()
                os.fchown(out.fileno(), info.st_uid, info.st_gid)
            out.write(data)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path
