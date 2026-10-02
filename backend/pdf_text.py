"""Complete Unicode PDF text extraction in an isolated PDFium process.

PDFium is not thread-safe. Keeping all native calls in one child per document
avoids sharing it with rendering threads and avoids pypdf's XObject cutoff.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def extract_pdf_pages(path: str | Path, timeout: float = 120) -> list[str]:
    source = Path(path).resolve()
    if not source.is_file():
        raise ValueError("PDF 文件不存在")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "backend.pdf_text", str(source)],
            cwd=Path(__file__).resolve().parent.parent,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("PDF 正文解析超时，未使用不完整正文") from None
    if result.returncode:
        raise ValueError("PDF 正文解析失败，未使用不完整正文")
    try:
        pages = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise ValueError("PDF 正文解析结果无效") from None
    if (
        not isinstance(pages, list)
        or not pages
        or not all(isinstance(page, str) for page in pages)
    ):
        raise ValueError("PDF 正文解析结果无效")
    return pages


def _read(path: str) -> list[str]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(path)
    try:
        pages = []
        for index in range(len(document)):
            page = document[index]
            try:
                text = page.get_textpage()
                try:
                    # Full Unicode (get_text_range is UCS-2 only).
                    pages.append(text.get_text_bounded(errors="strict"))
                finally:
                    text.close()
            finally:
                page.close()
        return pages
    finally:
        document.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(2)
    try:
        result = _read(sys.argv[1])
    except Exception:  # noqa: BLE001 -- isolate native failures without exposing PDF contents
        # Do not print document contents or native exception detail.
        raise SystemExit(1) from None
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
