# ruff: noqa: B008
"""Inventory and explicit cleanup of unreferenced user attachments."""

import html
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import select

from .models import (
    AgentAttachment,
    AgentRun,
    Event,
    File,
    Item,
    NoteImage,
    Paper,
    ResearchProfile,
    Revision,
    TranslationJob,
    Version,
    public,
)
from . import thumbnails
from .storage_budget import lock_owner

ASSETS = {"papers": File, "note_images": NoteImage, "chat_attachments": AgentAttachment}
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
LINK = re.compile(
    r"(?:/api/v1/(?:note-images|agent/attachments|agent/files)/|#attachment/)("
    + UUID
    + ")",
    re.IGNORECASE,
)


def decoded(value):
    return unquote(unquote(html.unescape(value)))


def references(d, owner):
    found = {}
    for model, label in (
        (Paper, "论文"),
        (Item, "笔记或主题"),
        (Revision, "历史版本"),
        (Event, "阅读记录"),
        (ResearchProfile, "研究偏好"),
        (Version, "论文版本"),
    ):
        for row in d.scalars(select(model).where(model.owner == owner)):
            for identifier in re.findall(
                UUID,
                decoded(json.dumps(public(row), ensure_ascii=False)),
                re.IGNORECASE,
            ):
                found.setdefault(identifier.lower(), label)
    for run in d.scalars(select(AgentRun).where(AgentRun.owner == owner)):
        identifiers = set(run.attachment_ids)
        identifiers.update(LINK.findall(decoded(run.prompt + "\n" + run.response)))
        for step in run.steps:
            for identifier in re.findall(
                UUID,
                json.dumps([step.get("images", []), step.get("files", [])]),
                re.IGNORECASE,
            ):
                identifiers.add(identifier)
        for identifier in identifiers:
            found.setdefault(identifier.lower(), "助手会话")
    from .models import now
    from .paper_shares import PaperShare

    for share in d.scalars(
        select(PaperShare).where(
            PaperShare.owner == owner,
            PaperShare.revoked_at == "",
            PaperShare.expires_at > now(),
        )
    ):
        for image in share.images:
            found.setdefault(image["id"], "有效的只读分享")
    return found


def validate_asset_links(d, settings, owner, payload):
    """Called under the owner lock before saving a new local-file reference."""
    content = decoded(json.dumps(payload, ensure_ascii=False))

    # Remote links may use the same API path; only this site's links are ours.
    def remote_link(match):
        url = match.group(0)
        return url if urlsplit(url).netloc == urlsplit(settings.origin).netloc else ""

    content = re.sub(r'https?://[^\s<>"\\]+', remote_link, content)
    for identifier in LINK.findall(content):
        identifier = identifier.lower()
        file = (
            d.get(NoteImage, identifier)
            or d.get(AgentAttachment, identifier)
            or d.get(File, identifier)
        )
        path = Path(settings.storage) / identifier
        if not file or file.owner != owner or not path.is_file() or path.is_symlink():
            raise HTTPException(422, "引用的附件不存在或已删除，请重新上传后保存")


def install_storage_routes(app, settings, db, auth, human, owned):
    @app.get("/api/v1/storage-files")
    def inventory(
        offset: int = Query(0, ge=0),
        limit: int = Query(30, ge=1, le=100),
        a=Depends(auth),
        d=Depends(db),
    ):
        refs = references(d, a["id"])
        files = []
        for kind, model in ASSETS.items():
            for file in d.scalars(select(model).where(model.owner == a["id"])):
                reason = "论文附件" if kind == "papers" else refs.get(file.id, "")
                files.append(
                    {
                        "id": file.id,
                        "kind": kind,
                        "name": file.name,
                        "size": file.size,
                        "reference": reason,
                        "can_delete": not reason,
                        "url": f"#paper/{file.paper_id}" if kind == "papers" else "",
                    }
                )
        files.sort(key=lambda row: (-row["size"], row["id"]))
        return {
            "items": files[offset : offset + limit],
            "total": len(files),
            "has_more": offset + limit < len(files),
        }

    @app.delete("/api/v1/storage-files/{kind}/{id}")
    def remove(kind: str, id: str, request: Request, a=Depends(auth), d=Depends(db)):
        human(a)
        if kind not in ASSETS:
            raise HTTPException(404, "附件不存在")
        lock_owner(d, a["id"])
        file = owned(d, ASSETS[kind], id, a)
        if request.headers.get("X-Confirm-Delete") != id:
            raise HTTPException(428, "请确认删除这个附件")
        if kind == "papers" or id in references(d, a["id"]):
            raise HTTPException(409, "附件仍被已保存内容引用，不能清理")
        current_session = a.get("actor", "").removeprefix("agent:")
        active = d.scalar(
            select(AgentRun.id)
            .where(
                AgentRun.owner == a["id"],
                AgentRun.status.in_(["queued", "running"]),
                AgentRun.session_id != current_session,
            )
            .limit(1)
        )
        translation = d.scalar(
            select(TranslationJob.id)
            .where(
                TranslationJob.owner == a["id"],
                TranslationJob.status.in_(["queued", "running"]),
            )
            .limit(1)
        )
        if active or translation:
            raise HTTPException(409, "请等待当前助手或翻译任务结束后清理")
        # Unused-file deletion is explicit. If the DB commit fails, the row still
        # counts toward quota and a retry can finish cleanup without deleting more.
        (Path(settings.storage) / id).unlink(missing_ok=True)
        thumbnails.remove(settings, id)
        d.delete(file)
        d.commit()
        return {"ok": True, "freed_bytes": file.size}
