"""Single dispatcher: python -m backend.translation_worker. Web requests never run TeX."""

import fcntl
import hashlib
import json
import logging
import os
import shutil
import signal
import threading
import time
import traceback
from pathlib import Path

from sqlalchemy import select, update

from .arxiv_import import download, extract_source
from .config import Settings, database
from .models import File, Paper, TranslationJob, now
from .translation_dispatch import TaskExecutor
from .translation_engine import align, compile_project, translate_project
from .translation_resources import rendering_memory
from .translation_settings import read_config
from .translations import store_file


class Cancelled(Exception):
    pass


def preserve_layout_diagnostics(work):
    """Keep bounded private failure evidence before removing engine scratch.

    Tracking contains document text, so it must stay outside public file-store
    routes, and neither it nor engine logs are copied to application logs.
    """
    layout = work / "layout"
    if not layout.is_dir():
        return
    destination = work / "layout-diagnostics"
    if destination.is_symlink():
        raise ValueError("Invalid layout diagnostics directory")
    destination.mkdir(mode=0o700, exist_ok=True)
    destination.chmod(0o700)
    for previous in destination.iterdir():
        if previous.is_file() or previous.is_symlink():
            previous.unlink()
    budget = 24 * 1024**2
    records = []
    candidates = sorted(layout.rglob("translate_tracking.json")) + sorted(
        layout.glob("engine-*.log")
    )
    for source in candidates:
        if source.is_symlink() or not source.resolve().is_relative_to(layout.resolve()):
            continue
        limit = 16 * 1024**2 if source.name == "translate_tracking.json" else 2 * 1024**2
        size = source.stat().st_size
        record = {"source": str(source.relative_to(layout)), "bytes": size}
        if size > limit or size > budget:
            record["retained"] = False
        else:
            target = destination / f"{len(records):02d}-{source.name}"
            with source.open("rb") as incoming, target.open("xb") as outgoing:
                target.chmod(0o600)
                shutil.copyfileobj(incoming, outgoing)
            budget -= size
            record.update(retained=True, file=target.name)
        records.append(record)
    manifest = destination / "manifest.json"
    manifest.write_text(json.dumps(records))
    manifest.chmod(0o600)


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

    def cancelled():
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            return not current or current.status != "running"

    layout_failed = False
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

            with rendering_memory(
                1400 * 1024**2, cancelled, lambda: progress(0, 100, "等待排版运行内存")
            ):
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
        cache_path = work / "units.json"
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        units = translate_project(
            work / "source", work / "translated", config, progress, cached=cache
        )
        progress(len(units), len(units), "编译中文 PDF")
        with rendering_memory(
            1200 * 1024**2,
            cancelled,
            lambda: progress(len(units), len(units), "等待编译运行内存"),
        ):
            translated = compile_project(work / "translated")
        progress(len(units), len(units), "保存中文 PDF")
        progress(len(units), len(units), "建立原译文对照")
        alignment = align(units, Path(settings.storage) / source_file, translated)
        # Publish output only after all validation and alignment complete.
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
                result = d.execute(
                    update(TranslationJob)
                    .where(
                        TranslationJob.id == job_id, TranslationJob.status == "running"
                    )
                    .values(
                        translated_file=f.id,
                        translated_archive="",
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
        layout_failed = job.engine == "pdf"
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
        if layout_failed:
            try:
                preserve_layout_diagnostics(work)
            except (OSError, ValueError):
                logging.getLogger(__name__).warning(
                    "Could not retain private layout diagnostics for job %s", job_id
                )
        if (work / "translated/compile.log").exists():
            shutil.copy2(work / "translated/compile.log", work / "compile.log")
        # Credentials never enter the project mount. Keep only the unit cache for diagnostics.
        for directory in ("source", "translated", "layout"):
            shutil.rmtree(work / directory, ignore_errors=True)


def main():
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("backend.translation_engine").setLevel(logging.INFO)
    logging.getLogger("backend.translation_cache").setLevel(logging.INFO)
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
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
        run_queue(settings, maker, stopping)


def dispatch_queued(settings, maker, executor, active):
    """Atomically claim queued jobs, then dispatch each independent job once."""
    with maker() as d:
        queued = list(
            d.scalars(
                select(TranslationJob.id)
                .where(TranslationJob.status == "queued")
                .order_by(TranslationJob.created_at)
            )
        )
    for job_id in queued:
        # A requeued job must not race its previous thread's final cleanup.
        if job_id in active:
            continue
        with maker() as d:
            claimed = (
                d.execute(
                    update(TranslationJob)
                    .where(
                        TranslationJob.id == job_id, TranslationJob.status == "queued"
                    )
                    .values(status="running", updated_at=now())
                ).rowcount
                == 1
            )
            d.commit()
        if not claimed:
            continue
        try:
            active[job_id] = executor.submit(process, settings, maker, job_id)
        except Exception:
            with maker() as d:
                d.execute(
                    update(TranslationJob)
                    .where(
                        TranslationJob.id == job_id, TranslationJob.status == "running"
                    )
                    .values(status="queued", updated_at=now())
                )
                d.commit()
            raise


def run_queue(settings, maker, stopping):
    last_cleanup = 0
    active = {}
    with TaskExecutor(thread_name_prefix="translation-job") as executor:
        while not stopping.is_set():
            for job_id, future in list(active.items()):
                if future.done():
                    try:
                        future.result()
                    except Exception:
                        logging.getLogger(__name__).exception("Translation job crashed")
                        with maker() as d:
                            d.execute(
                                update(TranslationJob)
                                .where(
                                    TranslationJob.id == job_id,
                                    TranslationJob.status == "running",
                                )
                                .values(
                                    status="failed",
                                    stage="翻译未完成",
                                    error="处理失败，请检查模型配置后重试",
                                    updated_at=now(),
                                )
                            )
                            d.commit()
                    del active[job_id]
            # A completed job's cleanup may still be writing its scratch dir.
            # Maintenance waits for dispatch threads to be idle, not DB status.
            if not active and (
                not last_cleanup or time.monotonic() - last_cleanup >= 3600
            ):
                from .translation_cache import sweep

                try:
                    sweep(settings, maker, worker_locked=True)
                except Exception:
                    logging.getLogger(__name__).exception(
                        "Translation cache cleanup failed"
                    )
                last_cleanup = time.monotonic()
            dispatch_queued(settings, maker, executor, active)
            stopping.wait(0.5)
        # Keep the process lock until already dispatched jobs have drained.
        # A forced process stop remains recoverable from running checkpoints.


if __name__ == "__main__":
    main()
