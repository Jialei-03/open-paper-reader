# ruff: noqa: B008
"""Authenticated raster attachments for Markdown notes."""

import hashlib
import io
import threading
from pathlib import Path

from fastapi import Depends, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from .models import Item, NoteImage, uid
from .storage_budget import lock_owner, require_space, write_blob

LIMIT = 8 * 1024**2
DECODERS = threading.BoundedSemaphore(2)


def normalize(raw):
    with DECODERS:
        return _normalize(raw)


def _normalize(raw):
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
                raise ValueError("请上传 PNG、JPEG、WebP 或 GIF 图片")
            if image.width * image.height > 16_000_000:
                raise ValueError("图片尺寸过大，请缩小到 1600 万像素以内")
            image = ImageOps.exif_transpose(image)
            image.thumbnail((3200, 3200))
            out = io.BytesIO()
            image.convert("RGBA").save(out, format="PNG")
            result = out.getvalue()
            if len(result) > LIMIT:
                raise ValueError("图片过大，请压缩后上传")
            return result
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError("无法读取图片，请使用有效的 PNG、JPEG、WebP 或 GIF") from e


def install_note_image_routes(app, settings, db, auth, owned):
    @app.post("/api/v1/items/{id}/images")
    async def upload_image(id: str, file: UploadFile, a=Depends(auth), d=Depends(db)):
        note = owned(d, Item, id, a)
        if note.kind != "note":
            raise HTTPException(422, "只能向笔记插入图片")
        raw = await file.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise HTTPException(413, "单张图片不能超过 8 MB")
        try:
            data = await run_in_threadpool(normalize, raw)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        # Serialize per-owner quota checks with inserts on PostgreSQL.
        lock_owner(d, a["id"])
        sha = hashlib.sha256(data).hexdigest()
        image = d.scalar(
            select(NoteImage).where(NoteImage.owner == a["id"], NoteImage.sha256 == sha)
        )
        if not image:
            require_space(d, settings, a["id"], len(data))
            image = NoteImage(
                id=uid(),
                owner=a["id"],
                name=Path(file.filename or "image").stem[:240] + ".png",
                mime="image/png",
                size=len(data),
                sha256=sha,
            )
            path = write_blob(settings, image.id, data)
            try:
                d.add(image)
                d.commit()
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return {
            "id": image.id,
            "url": f"/api/v1/note-images/{image.id}",
            "name": image.name,
        }

    @app.get("/api/v1/note-images/{id}")
    def get_image(id: str, a=Depends(auth), d=Depends(db)):
        from .main import file_bytes

        image = owned(d, NoteImage, id, a)
        return Response(
            file_bytes(settings, image),
            media_type=image.mime,
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
