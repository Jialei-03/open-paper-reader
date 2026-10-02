# ruff: noqa: B008
"""Owner-scoped original/translated PDF bundles, streamed from temporary storage."""
import hashlib
import os
import re
import stat
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Query
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse
from sqlalchemy import select

from .models import File, Paper, TranslationJob

_SLOTS = threading.BoundedSemaphore(2)
_MAX_BYTES = 256 * 1024**2


def _open(settings, file):
    try:
        fd = os.open(Path(settings.storage) / file.id, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        stream = os.fdopen(fd, "rb")
    except OSError:
        raise HTTPException(409, "文件缺失，请恢复文件后重试") from None
    info = os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_size != file.size:
        stream.close()
        raise HTTPException(409, "文件缺失或不完整，请恢复文件后重试")
    return stream


def _name(value):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', value).strip()[:90] or "论文"


def install_bulk_download_routes(app, settings, db, auth, human, owned):
    def plan(ids, mode, actor, session):
        human(actor)
        try:
            keys = list(dict.fromkeys(str(UUID(value)) for value in ids.split(",")))
        except ValueError:
            raise HTTPException(422, "请选择有效的论文") from None
        if not 1 <= len(keys) <= 100:
            raise HTTPException(422, "每次最多下载 100 篇论文，请分批选择")
        papers = [owned(session, Paper, key, actor) for key in keys]
        selected, missing = [], []
        for paper in papers:
            files = list(session.scalars(select(File).where(File.owner == actor["id"], File.paper_id == paper.id, File.version_id == paper.current_version, File.mime == "application/pdf").order_by(File.created_at, File.id)))
            jobs = list(session.scalars(select(TranslationJob).where(TranslationJob.owner == actor["id"], TranslationJob.paper_id == paper.id).order_by(TranslationJob.created_at.desc(), TranslationJob.id.desc())))
            translated = {job.translated_file for job in jobs if job.translated_file}
            if mode == "original":
                choices = [file for file in files if file.id not in translated]
            else:
                latest = next((job for job in jobs if job.version_id == paper.current_version and job.status == "completed" and job.translated_file), None)
                choices = [file for file in files if latest and file.id == latest.translated_file and file.id != latest.source_file]
            if not choices:
                missing.append({"paper_id": paper.id, "title": paper.title, "reason": "没有原文 PDF" if mode == "original" else "当前版本尚无已完成的译文 PDF"})
            for file in choices:
                try:
                    with _open(settings, file):
                        pass
                except HTTPException as error:
                    missing.append({"paper_id": paper.id, "title": paper.title, "reason": error.detail})
                    continue
                selected.append((paper, file))
        total = sum(file.size for _, file in selected)
        if total > _MAX_BYTES:
            raise HTTPException(413, "所选文件超过 256 MB，请减少所选论文，分批下载")
        return selected, missing, total

    @app.get("/api/v1/paper-downloads/plan")
    def preview(ids: str = Query(min_length=1, max_length=3800), mode: Literal["original", "translated"] = "original", a=Depends(auth), d=Depends(db)):
        files, missing, total = plan(ids, mode, a, d)
        return {"papers": len({paper.id for paper, _ in files}), "files": len(files), "total_size": total, "missing": missing}

    @app.get("/api/v1/paper-downloads/archive")
    def archive(ids: str = Query(min_length=1, max_length=3800), mode: Literal["original", "translated"] = "original", a=Depends(auth), d=Depends(db)):
        files, missing, total = plan(ids, mode, a, d)
        if not files:
            raise HTTPException(409, "所选论文没有可下载的原文 PDF" if mode == "original" else "所选论文没有已完成的译文 PDF")
        if not _SLOTS.acquire(blocking=False):
            raise HTTPException(429, "正在准备其他下载，请稍后重试")
        try:
            spool = tempfile.TemporaryFile()
        except OSError:
            _SLOTS.release()
            raise HTTPException(507, "服务器临时空间不足，请稍后重试") from None
        released = False
        def close():
            nonlocal released
            if not released:
                released = True
                spool.close()
                _SLOTS.release()
        try:
            with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as bundle:
                for index, (paper, file) in enumerate(files, 1):
                    filename = f"{index:03d}-{_name(paper.title)}/{'原文' if mode == 'original' else '译文'}.pdf"
                    digest = hashlib.sha256()
                    with _open(settings, file) as source, bundle.open(filename, "w") as target:
                        while chunk := source.read(64 * 1024):
                            digest.update(chunk)
                            target.write(chunk)
                    if digest.hexdigest() != file.sha256:
                        raise HTTPException(409, "文件已变更或不完整，请重新选择后下载")
                if missing:
                    bundle.writestr("未下载论文.txt", "\n".join(f"{row['title']}：{row['reason']}" for row in missing))
            length = spool.tell()
            spool.seek(0)
            def chunks():
                try:
                    while chunk := spool.read(64 * 1024):
                        yield chunk
                finally:
                    close()
            return StreamingResponse(chunks(), media_type="application/zip", headers={"Content-Length": str(length), "Content-Disposition": f'attachment; filename="papers-{mode}.zip"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}, background=BackgroundTask(close))
        except Exception:
            close()
            raise
