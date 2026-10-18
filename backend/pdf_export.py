# ruff: noqa: B008
"""Owner-scoped portable PDF annotations; rendering happens in a bounded process."""

import json
import subprocess
import sys
import threading
from typing import Literal

from fastapi import Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from .models import File, InkStroke, Paper, TextAnnotation, TranslationJob, Version

_EXPORT_SLOTS = threading.BoundedSemaphore(2)
# The worker's reason for refusing a source (the last line of its stderr).
EXPORT_REFUSALS = {
    "encrypted": "这份 PDF 设有密码，无法导出带批注的版本",
    "protection": "这份 PDF 的加密保护无法在导出时保留，未导出带批注的版本",
}
MERGE_REFUSALS = {
    "encrypted": "原文或译文 PDF 设有密码，无法合并下载",
    "protection": "原文或译文 PDF 的加密保护无法在合并时保留，未合并下载",
}


def run_worker(payload, failure, refusals):
    """Run the isolated serializer; a refusal says why, anything else is ``failure``."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "backend.pdf_export_worker"],
            input=payload,
            capture_output=True,
            timeout=45,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        raise HTTPException(422, failure) from None
    if result.returncode:
        lines = result.stderr.decode("utf-8", "replace").strip().splitlines()
        raise HTTPException(
            422, refusals.get(lines[-1].strip() if lines else "", failure)
        )
    return result


def install_pdf_export_routes(app, settings, db, auth, owned):
    @app.get("/api/v1/papers/{id}/merged-pdf")
    def merged(
        id: str,
        translation_job_id: str,
        order: Literal["original-first", "translation-first"] = "original-first",
        a=Depends(auth),
        d=Depends(db),
    ):
        from .paper_shares import safe_blob

        owned(d, Paper, id, a)
        job = owned(d, TranslationJob, translation_job_id, a)
        if job.paper_id != id:
            raise HTTPException(404, "翻译任务不存在")
        if (
            job.status != "completed"
            or not job.source_file
            or not job.translated_file
            or job.source_file == job.translated_file
        ):
            raise HTTPException(409, "翻译尚未完成，无法合并下载")
        version = owned(d, Version, job.version_id, a)
        files = [
            owned(d, File, fid, a) for fid in (job.source_file, job.translated_file)
        ]
        if version.paper_id != id or any(
            f.paper_id != id
            or f.version_id != version.id
            or f.mime != "application/pdf"
            for f in files
        ):
            raise HTTPException(422, "原文与译文必须属于同一论文版本的 PDF")
        if any(f.size <= 0 or f.size > 50 * 1024**2 for f in files):
            raise HTTPException(413, "每份 PDF 不得超过 50 MB")
        if not _EXPORT_SLOTS.acquire(blocking=False):
            raise HTTPException(
                429, "PDF 导出繁忙，请稍后重试", headers={"Retry-After": "5"}
            )
        try:
            if order == "translation-first":
                files.reverse()
            # Verify bounded regular-file reads and hashes before handing bytes
            # to the isolated parser. Never pass filesystem paths from requests.
            raws = [safe_blob(settings, f, 50 * 1024**2) for f in files]
            metadata = json.dumps(
                {"operation": "merge", "lengths": [len(r) for r in raws]}
            ).encode()
            result = run_worker(
                len(metadata).to_bytes(4, "big") + metadata + b"".join(raws),
                "PDF 合并失败；原文与译文未被修改",
                MERGE_REFUSALS,
            )
        except HTTPException as exc:
            # safe_blob's 404: a source changed or vanished since it was made.
            if exc.status_code == 404:
                raise HTTPException(
                    404, "原文或译文文件缺失或已变更，请重新生成翻译"
                ) from None
            raise
        finally:
            _EXPORT_SLOTS.release()
        if not result.stdout.startswith(b"%PDF-") or len(result.stdout) > 100 * 1024**2:
            raise HTTPException(422, "合并 PDF 超出导出限制")
        return Response(
            result.stdout,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="bilingual-paper.pdf"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/v1/files/{id}/annotated-pdf")
    def export(id: str, a=Depends(auth), d=Depends(db)):
        from .main import file_bytes

        file = owned(d, File, id, a)
        if file.mime != "application/pdf":
            raise HTTPException(422, "只能导出 PDF 批注")
        if not _EXPORT_SLOTS.acquire(blocking=False):
            raise HTTPException(
                429, "PDF 导出繁忙，请稍后重试", headers={"Retry-After": "5"}
            )
        try:
            highlights = [
                {
                    "page": row.page,
                    "quote": row.quote,
                    "comment": row.comment,
                    "color": row.color,
                    "rects": row.rects,
                }
                for row in d.scalars(
                    select(TextAnnotation).where(
                        TextAnnotation.file_id == id,
                        TextAnnotation.owner == a["id"],
                        TextAnnotation.deleted.is_(False),
                    )
                )
            ]
            ink = [
                row.data
                for row in d.scalars(
                    select(InkStroke).where(
                        InkStroke.file_id == id,
                        InkStroke.owner == a["id"],
                        InkStroke.deleted.is_(False),
                    )
                )
            ]
            metadata = json.dumps({"highlights": highlights, "ink": ink}).encode()
            payload = (
                len(metadata).to_bytes(4, "big") + metadata + file_bytes(settings, file)
            )
            result = run_worker(
                payload, "批注 PDF 导出失败；原文件与批注仍已保留", EXPORT_REFUSALS
            )
        finally:
            _EXPORT_SLOTS.release()
        if not result.stdout.startswith(b"%PDF-") or len(result.stdout) > 100 * 1024**2:
            raise HTTPException(422, "批注 PDF 超出导出限制")
        return Response(
            result.stdout,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="annotated-paper.pdf"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
