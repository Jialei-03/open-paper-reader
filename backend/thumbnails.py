"""First-page cover pictures of PDFs, rendered once and kept next to the file.

A file id never changes its bytes, so the picture is rendered at most once
(on import, or on the first request) and served with a long-lived cache
header. PDFs are untrusted: pages are drawn in a CPU/memory-bounded child
process with a timeout, and anything it refuses simply has no cover.
"""

import io
import os
import resource
import stat
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

WIDTH = 360
QUALITY = 80
MAX_PDF = 100 * 1024 * 1024
# A page larger than 200 inches, or more than 3x as tall as wide, is not a paper page.
MAX_POINTS = 14400
MAX_RATIO = 3.0
TIMEOUT = 20
VERSION = "t1"

_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}
_failed: set[str] = set()


def thumb_path(settings, file_id):
    return Path(settings.storage) / (file_id + ".thumb.jpg")


def etag(record):
    return '"' + record.sha256[:40] + "-" + VERSION + '"'


def remove(settings, file_id):
    thumb_path(settings, file_id).unlink(missing_ok=True)
    _failed.discard(file_id)


def draw(raw):
    """JPEG bytes of page 1 of `raw`; raises ValueError when it cannot be drawn."""
    import pypdfium2 as pdfium
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = 40_000_000
    try:
        document = pdfium.PdfDocument(raw)
    except pdfium.PdfiumError:
        raise ValueError("unreadable") from None
    try:
        if len(document) < 1:
            raise ValueError("no pages")
        page = document[0]
        width, height = page.get_size()
        if not (0 < width <= MAX_POINTS and 0 < height <= MAX_POINTS):
            raise ValueError("page size")
        if height / width > MAX_RATIO or width / height > MAX_RATIO:
            raise ValueError("page shape")
        bitmap = page.render(scale=WIDTH / width)
        image = bitmap.to_pil().convert("RGB")
    finally:
        document.close()
    out = io.BytesIO()
    image.save(out, "JPEG", quality=QUALITY, optimize=True)
    return out.getvalue()


def render(settings, file_id):
    """Draws the picture in a bounded child process; None when it cannot be."""
    try:
        fd = os.open(
            Path(settings.storage) / file_id,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        )
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PDF:
            return None
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve())],
            stdin=fd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=TIMEOUT,
            env={"PATH": os.defpath, "LANG": "C.UTF-8"},
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    finally:
        os.close(fd)
    if result.returncode != 0 or not result.stdout.startswith(b"\xff\xd8"):
        return None
    return result.stdout


def ensure(settings, record):
    """The path of the stored cover of PDF file `record`, drawn if missing; None if it has none."""
    path = thumb_path(settings, record.id)
    if path.is_file():
        return path
    if record.mime != "application/pdf" or record.id in _failed:
        return None
    with _guard:
        lock = _locks.setdefault(record.id, threading.Lock())
    with lock:
        try:
            if path.is_file():
                return path
            data = render(settings, record.id)
            if data is None:
                _failed.add(record.id)
                return None
            fd, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as out:
                    out.write(data)
                os.replace(temporary, path)
            finally:
                Path(temporary).unlink(missing_ok=True)
            return path
        finally:
            with _guard:
                _locks.pop(record.id, None)


def ensure_later(settings, file_id):
    """Background step after an import: draws the cover from the stored blob, if still there."""
    try:
        path = Path(settings.storage) / file_id
        if not path.is_file():
            return
        class Record:
            id = file_id
            mime = "application/pdf"
        ensure(settings, Record)
    except Exception:  # noqa: BLE001 -- the first request draws it instead
        return


def main():
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    raw = sys.stdin.buffer.read(MAX_PDF + 1)
    if len(raw) > MAX_PDF:
        sys.exit(1)
    sys.stdout.buffer.write(draw(raw))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 -- never print document content or native detail
        sys.exit(1)
