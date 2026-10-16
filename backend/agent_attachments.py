# ruff: noqa: B008
"""Owner-scoped chat uploads; never execute or unpack uploaded files."""

import asyncio
import hashlib
from pathlib import Path

from fastapi import Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from .models import AgentAttachment, uid
from .storage_budget import lock_owner, require_space, write_blob

LIMIT = 20 * 1024**2
EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".txt",
    ".md",
    ".markdown",
    ".tex",
    ".csv",
    ".tsv",
    ".json",
    ".bib",
}


def metadata(f):
    return {
        "id": f.id,
        "name": f.name,
        "mime": f.mime,
        "size": f.size,
        "pages": f.pages,
        "url": f"/api/v1/agent/attachments/{f.id}/content",
    }


def attachments(d, owner, ids):
    result = []
    for id in ids:
        f = d.get(AgentAttachment, id)
        if not f or f.owner != owner:
            raise HTTPException(404, "聊天附件不存在")
        result.append(metadata(f))
    return result


def install_attachment_routes(app, settings, db, auth, human, owned):
    inspector = asyncio.Semaphore(1)

    @app.post("/api/v1/agent/attachments")
    async def upload(file: UploadFile, a=Depends(auth), d=Depends(db)):
        human(a)
        from .main import detect, safe_name

        name = safe_name(file.filename or "attachment")
        if len(name) > 255 or Path(name).suffix.lower() not in EXTENSIONS:
            raise HTTPException(
                422,
                "支持 PDF、PNG/JPEG/WebP/GIF 和 UTF-8 文本（TXT、Markdown、TeX、CSV 等）",
            )
        async with inspector:
            data = await file.read(LIMIT + 1)
            if not data or len(data) > LIMIT:
                raise HTTPException(413, "附件不能为空，单个最多 20 MB")
            mime, pages = await run_in_threadpool(detect, data, name)
        if not (mime == "application/pdf" or mime.startswith(("image/", "text/"))):
            raise HTTPException(422, "无法读取这个附件，请使用 PDF、图片或 UTF-8 文本")
        lock_owner(d, a["id"])
        sha = hashlib.sha256(data).hexdigest()
        f = d.scalar(
            select(AgentAttachment).where(
                AgentAttachment.owner == a["id"],
                AgentAttachment.sha256 == sha,
                AgentAttachment.name == name,
            )
        )
        if not f:
            require_space(d, settings, a["id"], len(data))
            f = AgentAttachment(
                id=uid(),
                owner=a["id"],
                name=name,
                mime=mime,
                size=len(data),
                sha256=sha,
                pages=pages,
            )
            path = write_blob(settings, f.id, data)
            try:
                d.add(f)
                d.commit()
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return metadata(f)

    @app.get("/api/v1/agent/attachments/{id}/content")
    def content(id: str, preview: bool = False, a=Depends(auth), d=Depends(db)):
        from .main import file_bytes

        f = owned(d, AgentAttachment, id, a)
        return Response(
            file_bytes(settings, f),
            media_type=f.mime,
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": (
                    "inline"
                    if preview
                    and f.mime in {"image/png", "image/jpeg", "image/webp", "image/gif"}
                    else "attachment"
                ),
            },
        )
