# ruff: noqa: B008
"""Portable, owner-scoped Markdown exports without remote asset requests."""

import re
import tempfile
import zipfile

from fastapi import Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from .models import Item, NoteImage

IMAGE_URL = re.compile(
    r"(?<![A-Za-z0-9:/])/api/v1/note-images/([0-9a-f-]{36})(?![0-9a-f-])"
)


def install_note_export_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/items/{id}/export")
    def export_note(
        id: str,
        revision: int | None = Query(default=None, ge=1),
        a=Depends(auth),
        d=Depends(db),
    ):
        from .main import file_bytes

        note = owned(d, Item, id, a)
        if note.kind != "note":
            raise HTTPException(422, "只能导出笔记")
        if revision is not None and note.revision != revision:
            raise HTTPException(409, "笔记已更新，请重新保存后导出")
        images = {}
        for match in IMAGE_URL.finditer(note.body):
            image_id = match.group(1)
            if image_id not in images:
                images[image_id] = owned(d, NoteImage, image_id, a)
        # Generated filenames avoid path traversal and work on every platform.
        body = IMAGE_URL.sub(
            lambda match: "images/" + match.group(1) + ".png", note.body
        )
        output = tempfile.TemporaryFile(mode="w+b")  # noqa: SIM115 -- streaming generator owns lifetime
        try:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("note.md", f"# {note.title}\n\n{body}\n")
                for image_id, image in images.items():
                    archive.writestr(
                        "images/" + image_id + ".png", file_bytes(settings, image)
                    )
        except Exception:
            output.close()
            raise
        output.seek(0)

        def stream():
            try:
                while chunk := output.read(1024 * 1024):
                    yield chunk
            finally:
                output.close()

        return StreamingResponse(
            stream(),
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="paper-note.zip"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
