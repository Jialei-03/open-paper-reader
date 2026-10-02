"""Single worker: python -m backend.translation_worker. Web requests never run TeX."""

import fcntl
import hashlib
import io
import json
import logging
import os
import shutil
import signal
import sys
import tarfile
import time
import traceback
from pathlib import Path

from sqlalchemy import select, update

from .arxiv_import import download, extract_source
from .config import Settings, database
from .models import File, Paper, TranslationJob, now
from .translation_engine import align, compile_project, translate_project
from .translation_settings import read_config
from .translations import store_file


class Cancelled(Exception):
    pass


def process(settings, maker, job_id):
    with maker() as d:
        job = d.get(TranslationJob, job_id)
        owner, paper_id, version_id, arxiv = (
            job.owner,
            job.paper_id,
            job.version_id,
            job.arxiv_id,
        )
        expected_url = job.base_url
        expected_protocol = job.protocol
        config = {
            **read_config(settings, owner, job.model_config_id or None),
            **(job.model_options or {}),
        }
        if config.get("model") != job.model:
            config["model"] = job.model
    from . import model_usage

    config = model_usage.bind(config, maker, settings, owner, "translation", job_id)
    work = Path(settings.storage).parent / "translation-work" / job_id
    work.mkdir(parents=True, exist_ok=True, mode=0o700)

    def progress(done, total, stage, cache=None):
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            if not current or current.status == "cancelled":
                raise Cancelled()
            current.completed = done
            current.total = total
            current.stage = stage
            current.updated_at = now()
            d.commit()
        if cache is not None:
            temp = work / "units.tmp"
            temp.write_text(json.dumps(cache, ensure_ascii=False))
            temp.replace(work / "units.json")

    def attach(name, raw, field):
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            if not current or current.status == "cancelled":
                raise Cancelled()
            existing_id = getattr(current, field)
            existing = d.get(File, existing_id) if existing_id else None
            if (
                existing
                and existing.sha256 == hashlib.sha256(raw).hexdigest()
                and (Path(settings.storage) / existing.id).is_file()
            ):
                return existing.id
            paper = d.get(Paper, paper_id)
            f = store_file(d, settings, paper, version_id, name, raw)
            setattr(current, field, f.id)
            try:
                d.commit()
            except Exception:
                (Path(settings.storage) / f.id).unlink(missing_ok=True)
                raise
            return f.id

    try:
        if shutil.disk_usage(work).free < settings.storage_min_free:
            raise ValueError("服务器临时空间不足，请清理空间后重试；翻译检查点保留")
        if (
            config.get("base_url") != expected_url
            or config.get("protocol", "openai") != expected_protocol
        ):
            raise ValueError("模型服务地址已变更，请重新创建翻译任务")
        if not config.get("api_key"):
            raise ValueError("请先配置翻译模型")
        if job.engine == "pdf":
            from .pdf_layout_jobs import process_layout

            process_layout(settings, maker, job_id, config, work, progress)
            return
        progress(0, 0, "下载固定版本的原文与源码")
        raw = download("/pdf/" + arxiv)
        if not raw.startswith(b"%PDF-"):
            raise ValueError("arXiv 未返回有效 PDF")
        checksum = hashlib.sha256(raw).hexdigest()
        with maker() as d:
            original = d.scalar(
                select(File)
                .where(
                    File.paper_id == paper_id,
                    File.version_id == version_id,
                    File.sha256 == checksum,
                )
                .order_by(File.created_at)
            )
            source_file = original.id if original else None
        if not source_file:
            source_file = attach(arxiv.replace("/", "-") + ".pdf", raw, "source_file")
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            current.source_file = source_file
            d.commit()
        raw = download("/src/" + arxiv)
        progress(0, 0, "解析章节、公式和图表")
        extract_source(raw, work / "source")
        attach(
            "arxiv-source-" + arxiv.replace("/", "-") + ".tar.gz", raw, "source_archive"
        )
        cache_path = work / "units.json"
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        units = translate_project(
            work / "source", work / "translated", config, progress, cached=cache
        )
        progress(len(units), len(units), "编译中文 PDF")
        translated = compile_project(work / "translated")
        progress(len(units), len(units), "保存中文 PDF")
        progress(len(units), len(units), "建立原译文对照")
        alignment = align(units, Path(settings.storage) / source_file, translated)
        # Publish output only after all validation and alignment complete.
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as t:
            for f in (work / "translated").rglob("*"):
                if (
                    f.is_file()
                    and "build" not in f.relative_to(work / "translated").parts
                    and f.name != "compile.log"
                ):
                    t.add(f, arcname=str(f.relative_to(work / "translated")))
        created = []
        try:
            with maker() as d:
                paper = d.get(Paper, paper_id)
                f = store_file(
                    d,
                    settings,
                    paper,
                    version_id,
                    "zh-" + arxiv.replace("/", "-") + ".pdf",
                    translated.read_bytes(),
                )
                created.append(f.id)
                archive_file = store_file(
                    d,
                    settings,
                    paper,
                    version_id,
                    "zh-source-" + arxiv.replace("/", "-") + ".tar.gz",
                    archive.getvalue(),
                )
                created.append(archive_file.id)
                result = d.execute(
                    update(TranslationJob)
                    .where(
                        TranslationJob.id == job_id, TranslationJob.status == "running"
                    )
                    .values(
                        translated_file=f.id,
                        translated_archive=archive_file.id,
                        alignment=alignment,
                        status="completed",
                        stage="翻译完成",
                        updated_at=now(),
                    )
                )
                if result.rowcount != 1:
                    raise Cancelled()
                d.commit()
        except Exception:
            for file_id in created:
                (Path(settings.storage) / file_id).unlink(missing_ok=True)
            raise
    except Cancelled:
        pass
    except Exception as error:  # noqa: BLE001 -- isolate failed jobs from the worker loop
        logging.getLogger(__name__).error(
            "Translation job %s: %s\n%s",
            job_id,
            type(error).__name__,
            "".join(traceback.format_tb(error.__traceback__)),
        )
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            if current and current.status != "cancelled":
                current.status = "failed"
                current.stage = (
                    "中文 PDF 编译失败"
                    if current.stage == "编译中文 PDF"
                    else "翻译未完成"
                )
                current.updated_at = now()
                current.error = (
                    str(error)[:500]
                    if isinstance(error, ValueError)
                    else "处理失败，请检查源码格式或模型配置后重试"
                )
                d.commit()
    finally:
        if (work / "translated/compile.log").exists():
            shutil.copy2(work / "translated/compile.log", work / "compile.log")
        # Credentials never enter the project mount. Keep only the unit cache for diagnostics.
        for directory in ("source", "translated", "layout"):
            shutil.rmtree(work / directory, ignore_errors=True)


def main():
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("backend.translation_engine").setLevel(logging.INFO)
    logging.getLogger("backend.translation_cache").setLevel(logging.INFO)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    os.umask(0o077)
    settings = Settings.env()
    _engine, maker = database(settings)
    lock_path = Path(settings.storage).parent / "translation-worker.lock"
    with lock_path.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with maker() as d:
            d.execute(
                update(TranslationJob)
                .where(TranslationJob.status == "running")
                .values(
                    status="queued",
                    stage="恢复上次翻译任务",
                    error="",
                    updated_at=now(),
                )
            )
            d.commit()
        last_cleanup = 0
        while True:
            if time.monotonic() - last_cleanup >= 3600 or not last_cleanup:
                from .translation_cache import sweep

                try:
                    cleaned = sweep(settings, maker, worker_locked=True)
                    if cleaned["removed"]:
                        logging.getLogger("backend.translation_cache").info(
                            "Removed %s expired scratch directories; freed %s bytes",
                            cleaned["removed"],
                            cleaned["freed_bytes"],
                        )
                except Exception:  # maintenance must not stop job processing
                    logging.getLogger(__name__).exception(
                        "Translation cache cleanup failed"
                    )
                last_cleanup = time.monotonic()
            with maker() as d:
                job = d.scalar(
                    select(TranslationJob)
                    .where(TranslationJob.status == "queued")
                    .order_by(TranslationJob.created_at)
                )
                if job:
                    job.status = "running"
                    job.updated_at = now()
                    job_id = job.id
                    d.commit()
                else:
                    job_id = None
            if job_id:
                process(settings, maker, job_id)
            else:
                time.sleep(2)


if __name__ == "__main__":
    main()
