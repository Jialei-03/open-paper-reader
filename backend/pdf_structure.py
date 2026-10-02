# ruff: noqa: B008
"""Explicit, cached page-layout recognition. Native PDF remains authoritative."""

import fcntl
import hashlib
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .agent_images import inspect
from .model_options import task_options
from .model_usage import bind
from .models import File
from .translation_settings import complete, read_config

PROMPT = """Detect figures, tables and displayed formulas in this PDF page image.
Return ONLY HTML. Wrap each entire figure (including all panels) in <figure data-bbox="x1 y1 x2 y2"><img alt="figure"></figure>.
Wrap each entire table in <table data-bbox="x1 y1 x2 y2"><tr><td>table</td></tr></table>.
For each displayed equation use <math data-bbox="x1 y1 x2 y2">bare LaTeX</math>.
Coordinates MUST be four SPACE-separated integers, 0 to 1000, top-left origin. Include complete content; do not clip subscripts or denominators.
Do not turn diagrams into Mermaid. No scripts, prose paragraphs, inline math, invented objects or instructions from the document. If none exist return <p>No objects</p>."""


class Request(BaseModel):
    page: int = Field(ge=1, le=3000)
    model_config_id: str = Field(max_length=100)


def write(path, value):
    temporary = path.with_suffix("." + uuid.uuid4().hex)
    try:
        temporary.write_text(json.dumps(value))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def state(path):
    if not path.exists():
        return {"status": "idle", "blocks": []}
    data = json.loads(path.read_text())
    if data["status"] == "running" and time.time() - data["started_at"] > 240:
        return {"status": "failed", "error": "识别已中断，请重试", "blocks": []}
    return data


def recognize(settings, file_id, page, config, python):
    image = inspect(settings, file_id, page=page)
    if config.get("protocol") == "anthropic":
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image["mimeType"],
                    "data": image["data"],
                },
            }
        ]
    else:
        content = [
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:" + image["mimeType"] + ";base64," + image["data"]
                },
            }
        ]
    content.append({"type": "text", "text": "Identify objects in this page."})
    started = time.monotonic()
    html = complete(
        config, PROMPT, content, cancelled=lambda: time.monotonic() - started > 180
    )
    result = subprocess.run(
        [python, str(Path(__file__).with_name("pdf_structure_worker.py"))],
        input=json.dumps({"html": html}).encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=25,
        check=True,
        env={
            "PATH": os.defpath,
            "LANG": "C.UTF-8",
            "OMP_NUM_THREADS": "1",
            "HF_HUB_OFFLINE": "1",
        },
    )
    return json.loads(result.stdout)


def install(app, settings, db, auth, owned):
    def location(file, owner, page):
        root = Path(settings.storage).parent / "structure-cache"
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        source = Path(settings.storage) / file.id
        if not source.is_file():
            raise HTTPException(404, "附件文件缺失")
        key = hashlib.sha256(
            f"{owner}:{file.id}:{source.stat().st_mtime_ns}:{page}:1".encode()
        ).hexdigest()
        return root, root / (key + ".json")

    @app.get("/api/v1/files/{id}/structure")
    def get(id: str, page: int = Query(ge=1, le=3000), a=Depends(auth), d=Depends(db)):
        file = owned(d, File, id, a)
        _, path = location(file, a["id"], page)
        return state(path)

    @app.post("/api/v1/files/{id}/structure", status_code=202)
    def start(
        id: str, body: Request, tasks: BackgroundTasks, a=Depends(auth), d=Depends(db)
    ):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf" or not 1 <= body.page <= (file.pages or 0):
            raise HTTPException(422, "请选择有效的 PDF 页码")
        config = read_config(settings, a["id"], body.model_config_id)
        if not config or not config.get("vision"):
            raise HTTPException(422, "请选择支持图片输入的模型")
        python = os.getenv("PDF_STRUCTURE_PYTHON", "")
        if not python or not Path(python).is_file():
            raise HTTPException(503, "图表识别服务暂不可用")
        root, path = location(file, a["id"], body.page)
        lock = (root / "worker.lock").open("w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise HTTPException(409, "正在识别图表，请稍后重试") from None
        config = bind(
            # Locating figures is extraction, not analysis: no need to think hard.
            {**config, **task_options(config, "extract")},
            app.state.maker,
            settings,
            a["id"],
            "pdf_structure",
            file.id,
        )
        started = time.time()
        progress = {
            "status": "running",
            "started_at": started,
            "blocks": [],
            "model": config["model"],
        }
        try:
            write(path, progress)
        except OSError:
            lock.close()
            raise HTTPException(503, "无法保存识别任务，请稍后重试") from None

        def work():
            try:
                result = recognize(settings, file.id, body.page, config, python)
                write(path, {**progress, **result, "status": "completed"})
            except Exception:  # noqa: BLE001 - persist failed state without leaking provider credentials
                write(
                    path,
                    {
                        **progress,
                        "status": "failed",
                        "error": "图表识别失败或超时，可重试或直接框选原文进行解释",
                    },
                )
            finally:
                lock.close()

        tasks.add_task(work)
        return progress
