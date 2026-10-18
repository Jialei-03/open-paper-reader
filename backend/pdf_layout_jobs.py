"""Run an owned PDF layout job and publish only its validated result."""

import hashlib
from pathlib import Path

from sqlalchemy import update

from .layout_install import layout_available, layout_runtime
from .layout_translation import translate_pdf
from .models import File, Paper, TranslationJob, now
from .translations import store_file

STAGES = {
    "准备版面引擎": "准备版面引擎",
    "Parse PDF and Create Intermediate Representation": "读取 PDF",
    "DetectScannedFile": "检查页面类型",
    "Parse Page Layout": "识别版面与图表",
    "Parse Paragraphs": "整理段落",
    "Parse Formulas and Styles": "保护公式与格式",
    "Translate Paragraphs": "翻译正文",
    "Typesetting": "排版译文",
    "Add Fonts": "嵌入字体",
    "Generate drawing instructions": "生成译文页面",
    "Subset font": "整理字体",
    "Save PDF": "验证并保存译文",
}


def process_layout(settings, maker, job_id, config, work, progress):
    if not layout_available(settings):
        raise ValueError("普通 PDF 版面翻译尚未启用")
    with maker() as d:
        job = d.get(TranslationJob, job_id)
        paper = d.get(Paper, job.paper_id)
        source = d.get(File, job.source_file)
        if (
            not source
            or not paper
            or source.owner != job.owner
            or paper.owner != job.owner
            or source.paper_id != job.paper_id
            or source.version_id != job.version_id
            or source.mime != "application/pdf"
        ):
            raise ValueError("原始 PDF 不存在或不属于本次论文版本")
        source_path = Path(settings.storage).resolve() / source.id
        if (
            not source_path.is_file()
            or source_path.stat().st_size > settings.upload_limit
        ):
            raise ValueError("原始 PDF 不存在或超过文件大小限制")
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != source.sha256:
            raise ValueError("原始 PDF 内容已变化，请重新导入")
        title = Path(source.name).stem

    def cancelled():
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            return not current or current.status != "running"

    from .translation_memory import SentenceMemory

    config = {**config, "_shared_sentence_translator": SentenceMemory(settings, maker, job.owner, source.sha256, config, cancelled=cancelled).layout}

    completed = 0

    def update_progress(event):
        nonlocal completed
        stage = STAGES.get(event.get("stage"))
        if stage:
            completed = max(completed, min(99, int(event.get("overall_progress") or 0)))
            progress(completed, 100, stage)

    translated, _ = translate_pdf(
        layout_runtime(settings),
        source_path,
        work / "layout",
        config,
        update_progress,
        cancelled,
        container_image=settings.pdf_layout_image,
    )
    progress(99, 100, "保存中文 PDF")
    created = None
    try:
        with maker() as d:
            current = d.get(TranslationJob, job_id)
            if not current or current.status != "running":
                return
            paper = d.get(Paper, current.paper_id)
            result_file = store_file(
                d,
                settings,
                paper,
                current.version_id,
                "zh-" + title[:150] + ".pdf",
                translated.read_bytes(),
            )
            created = result_file.id
            result = d.execute(
                update(TranslationJob)
                .where(
                    TranslationJob.id == job_id,
                    TranslationJob.status == "running",
                )
                .values(
                    translated_file=result_file.id,
                    status="completed",
                    completed=100,
                    total=100,
                    stage="翻译完成",
                    error="",
                    updated_at=now(),
                )
            )
            if result.rowcount != 1:
                raise ValueError("翻译任务已停止，未发布结果")
            d.commit()
    except Exception:
        if created:
            (Path(settings.storage) / created).unlink(missing_ok=True)
        raise
