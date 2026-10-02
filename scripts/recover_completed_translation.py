"""Publish an already compiled, validated PDF without any model requests.

Administrator-only CLI. It defaults to verification; --publish writes owned
file records. Original model checkpoints and archives are never removed.
"""

import argparse
import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pypdf import PdfReader

from backend.config import Settings, database
from backend.models import File, Paper, TranslationJob, now
from backend.translation_engine import align
from backend.translations import store_file


def recover(settings, maker, job_id, pdf, publish=False, checkpoint=None):
    pdf = Path(pdf).resolve(strict=True)
    log = pdf.parent.parent / "compile.log"
    if not log.is_file() or "Missing character:" in log.read_text(errors="replace"):
        raise ValueError("缺少成功编译日志，或仍有缺字形")
    document = PdfReader(pdf, strict=False)
    if not document.pages:
        raise ValueError("PDF没有页面")
    with maker() as d:
        job = d.get(TranslationJob, job_id)
        if not job:
            raise ValueError("任务不存在")
        if job.status in {"queued", "running"}:
            raise ValueError("任务仍在运行，不能覆盖")
        paper = d.get(Paper, job.paper_id)
        source = d.get(File, job.source_file)
        if (
            not paper
            or not source
            or source.owner != job.owner
            or source.paper_id != paper.id
            or source.version_id != job.version_id
        ):
            raise ValueError("任务原文归属或版本不一致")
        original = Path(settings.storage) / source.id
        if (
            original.is_symlink()
            or hashlib.sha256(original.read_bytes()).hexdigest() != source.sha256
        ):
            raise ValueError("原文校验失败")
        cache = (
            Path(settings.storage).parent / "translation-work" / job.id / "units.json"
        )
        if checkpoint is not None:
            cache = Path(checkpoint).resolve(strict=True)
        units = json.loads(cache.read_text())
        units = list(units.values()) if isinstance(units, dict) else units
        if len(units) != job.total or any(not u.get("translated_text") for u in units):
            raise ValueError("检查点译文不完整")
        result = {
            "job_id": job.id,
            "title": paper.title,
            "pages": len(document.pages),
            "units": len(units),
            "published": False,
        }
        if not publish:
            return result
        raw = pdf.read_bytes()
        checksum = hashlib.sha256(raw).hexdigest()
        existing = d.get(File, job.translated_file) if job.translated_file else None
        if existing and existing.sha256 == checksum:
            job.alignment = align(units, original, pdf)
            d.commit()
            result["published"] = True
            return result
        translated = store_file(
            d,
            settings,
            paper,
            job.version_id,
            "zh-" + (job.arxiv_id or Path(source.name).stem).replace("/", "-") + ".pdf",
            raw,
        )
        created = [translated.id]
        try:
            if not job.translated_archive:
                archive = io.BytesIO()
                with tarfile.open(fileobj=archive, mode="w:gz") as tar:
                    for path in pdf.parent.parent.rglob("*"):
                        if (
                            path.is_file()
                            and not path.is_symlink()
                            and "build" not in path.relative_to(pdf.parent.parent).parts
                            and path.name != "compile.log"
                        ):
                            tar.add(
                                path, arcname=str(path.relative_to(pdf.parent.parent))
                            )
                archived = store_file(
                    d,
                    settings,
                    paper,
                    job.version_id,
                    "zh-source-"
                    + (job.arxiv_id or job.id).replace("/", "-")
                    + ".tar.gz",
                    archive.getvalue(),
                )
                created.append(archived.id)
                job.translated_archive = archived.id
            job.translated_file = translated.id
            job.alignment = align(units, original, pdf)
            job.status = "completed"
            job.stage = "翻译完成"
            job.completed = len(units)
            job.error = ""
            job.updated_at = now()
            d.commit()
        except Exception:
            for file_id in created:
                (Path(settings.storage) / file_id).unlink(missing_ok=True)
            raise
        result["published"] = True
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--checkpoint", help="Validated recovered units; original cache is retained"
    )
    args = parser.parse_args()
    settings = Settings.env()
    engine, maker = database(settings)
    try:
        print(
            json.dumps(
                recover(
                    settings,
                    maker,
                    args.job_id,
                    args.pdf,
                    args.publish,
                    args.checkpoint,
                ),
                ensure_ascii=False,
            )
        )
    finally:
        engine.dispose()
