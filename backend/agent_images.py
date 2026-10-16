"""Owned images, source-archive discovery, and a bounded regenerable preview cache."""

import base64
import fcntl
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode

from sqlalchemy import select

from .models import AgentAttachment, File, Paper, TranslationJob


def normalize_rect(rect):
    if rect is None:
        return None
    if isinstance(rect, str):
        try:
            rect = [float(n) for n in rect.split(",")]
        except ValueError:
            raise ValueError("选区坐标无效") from None
    if not isinstance(rect, (list, tuple)) or len(rect) != 4:
        raise ValueError("选区坐标无效")
    if any(
        isinstance(n, bool) or not isinstance(n, (float, int)) or not math.isfinite(n)
        for n in rect
    ):
        raise ValueError("选区坐标无效")
    x, y, w, h = rect
    if not (
        0 <= x < 1
        and 0 <= y < 1
        and 0 < w <= 1
        and 0 < h <= 1
        and x + w <= 1.00001
        and y + h <= 1.00001
    ):
        raise ValueError("选区坐标超出页面")
    return [x, y, min(w, 1 - x), min(h, 1 - y)]


def inspect(settings, file_id, operation="render", page=1, asset="", rect=None):
    rect = normalize_rect(rect)
    # Callers MUST resolve an owned File before entering this helper. No client paths.
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 3000:
        raise ValueError("页码必须为 1–3000 的整数")
    if not isinstance(asset, str) or len(asset) > 500:
        raise ValueError("图片名称过长")
    root = Path(settings.storage).parent / "visual-cache"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    source = Path(settings.storage) / file_id
    if not source.is_file():
        raise ValueError("附件文件缺失，请重新上传")
    signature = [file_id, source.stat().st_mtime_ns, operation, page, asset, rect, 2]
    key = hashlib.sha256(json.dumps(signature).encode()).hexdigest()
    cache = root / (key + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    # Cross-process cap: the web process and worker cannot simultaneously render.
    with (root / "render.lock").open("w") as lock:
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ValueError("图片处理繁忙，请稍后重试") from None
                time.sleep(0.05)
        if cache.exists():
            return json.loads(cache.read_text())
        try:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("visual_media.py"))],
                input=json.dumps(
                    {
                        "path": str(source),
                        "operation": operation,
                        "page": page,
                        "asset": asset,
                        "rect": rect,
                    }
                ).encode(),
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=15,
                env={"PATH": os.defpath, "LANG": "C.UTF-8"},
            )
            value = json.loads(result.stdout)
        except (subprocess.TimeoutExpired, ValueError):
            raise ValueError("图片处理超时或超出资源限制") from None
        if value.get("error"):
            raise ValueError(value["error"])
        # Cache is disposable; only source attachments are authoritative/backed up.
        files = sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime)
        size = sum(p.stat().st_size for p in files)
        while files and size > 128 * 1024**2:
            old = files.pop(0)
            size -= old.stat().st_size
            old.unlink()
        fd, temp = tempfile.mkstemp(dir=root)
        try:
            with os.fdopen(fd, "w") as out:
                json.dump(value, out)
            os.replace(temp, cache)
        finally:
            Path(temp).unlink(missing_ok=True)
        return value


def owned_file(app, owner, file_id):
    with app.state.maker() as d:
        f = d.get(File, file_id) or d.get(AgentAttachment, file_id)
        if not f or f.owner != owner:
            raise ValueError("404: 附件不存在")
        return f


def view(app, owner, file_id, page=1, asset="", rect=None):
    rect = normalize_rect(rect)
    f = owned_file(app, owner, file_id)
    value = inspect(app.state.settings, f.id, page=page, asset=asset, rect=rect)
    url = f"/api/v1/agent/files/{f.id}/image?" + urlencode(
        {
            "page": page,
            "asset": asset,
            **({"rect": ",".join(map(str, rect))} if rect else {}),
        }
    )
    label = asset or f.name
    if f.mime == "application/pdf" and not asset:
        label += f" · 第 {page} 页"
    label += " · 选区" if rect else ""
    return {
        "images": [
            {
                "url": url,
                "label": label,
                "file_id": f.id,
                "paper_id": f.paper_id,
                "page": page,
                "asset": asset,
                "rect": rect,
                "width": value["width"],
                "height": value["height"],
            }
        ],
        "_image_content": [
            {"type": "image", "mimeType": value["mimeType"], "data": value["data"]}
        ],
    }


def list_images(app, owner, paper_id):
    with app.state.maker() as d:
        p = d.get(Paper, paper_id)
        if not p or p.owner != owner:
            raise ValueError("404: 论文不存在")
        files = list(
            d.scalars(select(File).where(File.owner == owner, File.paper_id == p.id))
        )
        archive = d.scalar(
            select(TranslationJob.source_archive)
            .where(
                TranslationJob.owner == owner,
                TranslationJob.paper_id == p.id,
                TranslationJob.version_id == p.current_version,
                TranslationJob.source_archive != "",
            )
            .order_by(TranslationJob.created_at.desc())
            .limit(1)
        )
        archive_file = next((f for f in files if f.id == archive), None)
        rows = [
            {
                "id": f.id,
                "name": f.name,
                "pages": f.pages,
                "kind": "pdf" if f.mime == "application/pdf" else "image",
            }
            for f in files
            if f.mime == "application/pdf" or f.mime.startswith("image/")
        ]
    assets = (
        inspect(app.state.settings, archive_file.id, operation="list")["assets"]
        if archive_file
        else []
    )
    return {
        "files": rows,
        "source_images": [{"id": archive_file.id, **row} for row in assets],
        "notice": "SVG / EPS 请改用 PDF 页面；列表中的图片不等于已经看过，须调用 view_image。"
        if archive_file
        else "尚无已下载的 LaTeX 源码包，可以直接用 view_image 查看 PDF 页面。",
    }


def image_bytes(value):
    return base64.b64decode(value["data"], validate=True)
