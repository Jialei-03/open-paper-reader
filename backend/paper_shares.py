# ruff: noqa: B008
"""Explicit, revocable read-only links with immutable note/image selection."""

import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlsplit

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import Field
from sqlalchemy import JSON, ForeignKey, Integer, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, File, Item, NoteImage, Paper, now, uid
from .schemas import Strict

TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
IMAGE = re.compile(r"!\[([^\]\n]*)\]\(<?([^\s)>]+)>?(?:\s+\"[^\"]*\")?\)")
IMAGE_PATH = re.compile(r"^/api/v1/note-images/([0-9a-f-]{36})$")
MAX_PDF = 50 * 1024**2
MAX_IMAGES = 64 * 1024**2
BLOB_SLOTS = threading.BoundedSemaphore(4)
HEADERS = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


class PaperShare(Base):
    __tablename__ = "paper_shares"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"))
    file_sha256: Mapped[str] = mapped_column(String(64))
    file_name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(500))
    authors: Mapped[str] = mapped_column(Text, default="")
    note_id: Mapped[str] = mapped_column(String(36), default="")
    note_title: Mapped[str] = mapped_column(String(500), default="")
    note_body: Mapped[str] = mapped_column(Text, default="")
    images: Mapped[list] = mapped_column(JSON, default=list)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    expires_at: Mapped[str] = mapped_column(String(40))
    revoked_at: Mapped[str] = mapped_column(String(40), default="")


class ShareInput(Strict):
    file_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    note_id: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")
    expires_days: Literal[1, 7, 30] = 7


class ShareLimiter:
    """Bounded process-local IP and global byte budgets; ignore forwarded headers."""

    request_limit = 180
    ip_bytes = 128 * 1024**2
    global_bytes = 1024**3

    def __init__(self):
        self.lock = threading.Lock()
        self.clients = OrderedDict()
        self.global_window = [0.0, 0]

    def consume(self, request, size=0, count=True):
        ip = request.client.host if request.client else "unknown"
        clock = time.monotonic()
        with self.lock:
            entry = self.clients.get(ip, [clock, 0, 0])
            if clock - entry[0] >= 60:
                entry = [clock, 0, 0]
            if clock - self.global_window[0] >= 60:
                self.global_window = [clock, 0]
            if (
                entry[1] + int(count) > self.request_limit
                or entry[2] + size > self.ip_bytes
                or self.global_window[1] + size > self.global_bytes
            ):
                raise HTTPException(
                    429,
                    "分享访问频繁，请稍后重试",
                    headers={**HEADERS, "Retry-After": "60"},
                )
            entry[1] += int(count)
            entry[2] += size
            self.global_window[1] += size
            self.clients[ip] = entry
            self.clients.move_to_end(ip)
            while len(self.clients) > 10000:
                self.clients.popitem(last=False)


def not_found():
    raise HTTPException(404, "分享不存在或已失效", headers=HEADERS)


def safe_blob(settings, record, maximum):
    """Bounded regular-file reads only; no parsing, shell or embedded execution."""
    if record.size <= 0 or record.size > maximum:
        not_found()
    if not BLOB_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "分享文件读取繁忙，请稍后重试", headers=HEADERS)
    try:
        fd = os.open(Path(settings.storage) / record.id, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != record.size:
                not_found()
            raw = stream.read(maximum + 1)
        if len(raw) != record.size or not hmac.compare_digest(
            hashlib.sha256(raw).hexdigest(), record.sha256
        ):
            not_found()
        signature = (
            b"%PDF-"
            if record.mime == "application/pdf"
            else b"\x89PNG\r\n\x1a\n"
            if record.mime == "image/png"
            else None
        )
        # A PDF may have stray bytes before its header, within the first 1024.
        if signature is None or not (
            signature in raw[:1024]
            if record.mime == "application/pdf"
            else raw.startswith(signature)
        ):
            not_found()
        return raw
    except OSError:
        not_found()
    finally:
        BLOB_SLOTS.release()


def metadata(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "file_id",
            "file_name",
            "note_id",
            "note_title",
            "created_at",
            "expires_at",
            "revoked_at",
        )
    }


def install_share_routes(app, settings, db, auth, human, owned):
    from .storage_budget import lock_owner, require_space

    limiter = ShareLimiter()
    app.state.share_limiter = limiter

    def explicit_user(a):
        human(a)
        # Internal Agent business requests impersonate an owner, but publishing
        # is deliberately reserved to the authenticated user's direct action.
        if not a.get("actor", "").startswith("human:"):
            raise HTTPException(403, "分享需要用户在页面中明确创建")

    def shared(token, request, d):
        limiter.consume(request)
        if not TOKEN.fullmatch(token):
            not_found()
        row = d.scalar(
            select(PaperShare).where(
                PaperShare.token_hash == hashlib.sha256(token.encode()).hexdigest()
            )
        )
        if not row or row.revoked_at or row.expires_at <= now():
            not_found()
        return row

    @app.get("/api/v1/papers/{id}/shares")
    def list_shares(id: str, a=Depends(auth), d=Depends(db)):
        explicit_user(a)
        owned(d, Paper, id, a)
        return [
            metadata(row)
            for row in d.scalars(
                select(PaperShare)
                .where(PaperShare.owner == a["id"], PaperShare.paper_id == id)
                .order_by(PaperShare.created_at.desc())
            )
        ]

    @app.post("/api/v1/papers/{id}/shares")
    def create_share(id: str, body: ShareInput, a=Depends(auth), d=Depends(db)):
        explicit_user(a)
        lock_owner(d, a["id"])
        paper = owned(d, Paper, id, a)
        file = owned(d, File, body.file_id, a)
        if file.paper_id != id or file.mime != "application/pdf" or file.size > MAX_PDF:
            raise HTTPException(422, "请选择这篇论文中不超过 50 MB 的 PDF")
        count = d.scalar(
            select(func.count())
            .select_from(PaperShare)
            .where(PaperShare.paper_id == id)
        )
        if count >= 100:
            raise HTTPException(409, "这篇论文的分享链接已达 100 条上限")
        safe_blob(settings, file, MAX_PDF)
        note = owned(d, Item, body.note_id, a) if body.note_id else None
        if note and (note.kind != "note" or note.paper_id != id):
            raise HTTPException(422, "只能分享这篇论文的笔记")
        note_body = note.body if note else ""
        if len(note_body.encode()) > 512 * 1024:
            raise HTTPException(413, "分享笔记不能超过 512 KB")
        images = {}

        def snapshot_image(match):
            address = urlsplit(match.group(2))
            if address.netloc and (address.scheme, address.netloc) != (
                urlsplit(settings.origin).scheme,
                urlsplit(settings.origin).netloc,
            ):
                return f"[图片：{match.group(1)}（未分享外部图片）]"
            parsed = IMAGE_PATH.fullmatch(address.path)
            if not parsed:
                return f"[图片：{match.group(1)}（未分享此附件）]"
            identifier = parsed.group(1)
            image = owned(d, NoteImage, identifier, a)
            if identifier not in images:
                if (
                    len(images) >= 20
                    or sum(i["size"] for i in images.values()) + image.size > MAX_IMAGES
                ):
                    raise HTTPException(413, "分享笔记最多 20 张图片，合计不超过 64 MB")
                safe_blob(settings, image, 8 * 1024**2)
                images[identifier] = {
                    "id": identifier,
                    "sha256": image.sha256,
                    "size": image.size,
                }
            return f"![{match.group(1)}](/api/v1/note-images/{identifier})"

        note_body = IMAGE.sub(snapshot_image, note_body)
        token = secrets.token_urlsafe(32)
        size = (
            len(
                json.dumps(
                    {
                        "title": paper.title,
                        "authors": paper.authors,
                        "file_name": file.name,
                        "note_title": note.title if note else "",
                        "body": note_body,
                        "images": images,
                    },
                    ensure_ascii=False,
                ).encode()
            )
            + 2048
        )
        require_space(d, settings, a["id"], size)
        row = PaperShare(
            owner=a["id"],
            paper_id=id,
            file_id=file.id,
            file_sha256=file.sha256,
            file_name=file.name,
            title=paper.title,
            authors=paper.authors,
            note_id=note.id if note else "",
            note_title=note.title if note else "",
            note_body=note_body,
            images=list(images.values()),
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            size=size,
            expires_at=(
                datetime.now(timezone.utc) + timedelta(days=body.expires_days)
            ).isoformat(),
        )
        d.add(row)
        d.commit()
        return {
            **metadata(row),
            "token": token,
            "url": settings.origin.rstrip("/") + "/#shared/" + token,
        }

    @app.delete("/api/v1/papers/{id}/shares/{share_id}")
    def revoke(id: str, share_id: str, a=Depends(auth), d=Depends(db)):
        explicit_user(a)
        lock_owner(d, a["id"])
        owned(d, Paper, id, a)
        row = owned(d, PaperShare, share_id, a)
        if row.paper_id != id:
            not_found()
        if not row.revoked_at:
            row.revoked_at = now()
            row.note_body = ""
            row.images = []
            row.size = (
                len(
                    json.dumps(
                        {
                            "title": row.title,
                            "authors": row.authors,
                            "file_name": row.file_name,
                            "note_title": row.note_title,
                        },
                        ensure_ascii=False,
                    ).encode()
                )
                + 2048
            )
            d.commit()
        return {"ok": True}

    @app.get("/api/v1/shared/{token}")
    def get_shared(token: str, request: Request, d=Depends(db)):
        row = shared(token, request, d)
        allowed = {image["id"] for image in row.images}
        body = re.sub(
            r"/api/v1/note-images/([0-9a-f-]{36})",
            lambda match: (
                f"/api/v1/shared/{token}/images/{match.group(1)}"
                if match.group(1) in allowed
                else ""
            ),
            row.note_body,
        )
        return JSONResponse(
            {
                "title": row.title,
                "authors": row.authors,
                "file_name": row.file_name,
                "pdf_url": f"/api/v1/shared/{token}/pdf",
                "expires_at": row.expires_at,
                "note": {"title": row.note_title, "body": body}
                if row.note_id
                else None,
            },
            headers=HEADERS,
        )

    @app.get("/api/v1/shared/{token}/pdf")
    def get_pdf(token: str, request: Request, d=Depends(db)):
        row = shared(token, request, d)
        file = d.get(File, row.file_id)
        if (
            not file
            or file.owner != row.owner
            or file.paper_id != row.paper_id
            or file.sha256 != row.file_sha256
        ):
            not_found()
        limiter.consume(request, file.size, count=False)
        return Response(
            safe_blob(settings, file, MAX_PDF),
            media_type="application/pdf",
            headers={
                **HEADERS,
                "Content-Disposition": "inline; filename*=UTF-8''"
                + quote(row.file_name, safe=""),
            },
        )

    @app.get("/api/v1/shared/{token}/images/{id}")
    def get_shared_image(token: str, id: str, request: Request, d=Depends(db)):
        row = shared(token, request, d)
        selected = next((image for image in row.images if image["id"] == id), None)
        image = d.get(NoteImage, id) if selected else None
        if (
            not image
            or image.owner != row.owner
            or image.sha256 != selected["sha256"]
            or image.size != selected["size"]
        ):
            not_found()
        limiter.consume(request, image.size, count=False)
        return Response(
            safe_blob(settings, image, 8 * 1024**2),
            media_type="image/png",
            headers=HEADERS,
        )
