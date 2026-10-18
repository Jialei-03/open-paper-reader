"""Ways of finding one's way around a paper that a reader has and the agent did not.

A reader searches the text, looks at what is in a box, and jumps to a figure.
The agent had only "read up to five pages at a time", so finding where a paper
discusses something meant reading it all. These are read-only and owner-scoped,
like the other tools.
"""

from collections import OrderedDict
from pathlib import Path
from threading import RLock

from .agent_images import inspect, normalize_rect, owned_file

# Extracted text of the papers being worked on, so searching again is instant.
CACHED_PAPERS = 4
_texts = OrderedDict()
_texts_lock = RLock()


def pdf_file(app, owner, file_id):
    f = owned_file(app, owner, file_id)
    if getattr(f, "mime", "") != "application/pdf":
        raise ValueError("只能对 PDF 使用这个工具")
    return f


def page_texts(app, file):
    """One whitespace-normalized string per page, kept for the next call."""
    with _texts_lock:
        return _page_texts(app, file)


def _page_texts(app, file):
    path = (Path(app.state.settings.storage) / file.id).resolve()
    if not path.is_file():
        raise ValueError("附件记录存在，但文件缺失，请重新上传附件")
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if key in _texts:
        _texts.move_to_end(key)
        return _texts[key]
    from pypdf import PasswordType, PdfReader

    try:
        pdf = PdfReader(path, strict=False)
        # A publisher PDF often has only an owner password; it opens with the
        # empty user password, as in any viewer.
        if pdf.is_encrypted and pdf.decrypt("") == PasswordType.NOT_DECRYPTED:
            raise ValueError("PDF 已加密，暂不支持读取")
        pages = [" ".join((page.extract_text() or "").split()) for page in pdf.pages]
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(
            "PDF 文本解析失败，请尝试另一版本或上传可提取文字的 PDF"
        ) from exc
    _texts[key] = pages
    while len(_texts) > CACHED_PAPERS:
        _texts.popitem(last=False)
    return pages


def search_file(app, owner, id, query, limit=10):
    """Where a phrase is on the pages of a paper, with a little of what surrounds it."""
    if not isinstance(query, str) or not 1 <= len(query) <= 200:
        raise ValueError("搜索文字必须为 1–200 个字符")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
        raise ValueError("搜索页数上限必须为 1–20 的整数")
    file = pdf_file(app, owner, id)
    needle = " ".join(query.split()).casefold()
    if not needle:
        raise ValueError("请输入要搜索的文字")
    pages = page_texts(app, file)
    matches, total, matched_pages = [], 0, 0
    for number, text in enumerate(pages, 1):
        folded = text.casefold()
        found = folded.find(needle)
        count = 0
        first = found
        while found >= 0:
            count += 1
            found = folded.find(needle, found + len(needle))
        if not count:
            continue
        total += count
        matched_pages += 1
        if len(matches) < limit:
            # casefold can expand characters (ß → ss), so its offsets are not
            # necessarily offsets in the authoritative page text.
            offset = 0
            begin = 0
            for index, char in enumerate(text):
                next_offset = offset + len(char.casefold())
                if offset <= first < next_offset:
                    begin = index
                if next_offset >= first + len(needle):
                    end = index + 1
                    break
                offset = next_offset
            start = max(0, begin - 80)
            snippet = text[start : end + 80]
            matches.append(
                {
                    "page": number,
                    "count": count,
                    "snippet": ("…" if start else "")
                    + snippet
                    + ("…" if end + 80 < len(text) else ""),
                }
            )
    blank = sum(1 for text in pages if not text.strip())
    result = {
        "file_id": file.id,
        "query": query,
        "total_matches": total,
        "pages_with_matches": matched_pages,
        "matches": matches,
        "truncated": total > sum(m["count"] for m in matches),
        "pages_searched": len(pages),
        "pages_without_text": blank,
    }
    if blank:
        result["notice"] = (
            f"{blank} 页没有可提取的文字（可能是扫描页或图片），搜索不包含这些页；请用 view_image 查看。"
        )
    return result


def read_region(app, owner, id, page, rect):
    """The text of the page that lies inside a box (fractions of the page, top-left origin)."""
    file = pdf_file(app, owner, id)
    box = normalize_rect(rect)
    if box is None:
        raise ValueError("请提供选区坐标")
    value = inspect(app.state.settings, file.id, operation="text", page=page, rect=box)
    result = {"file_id": file.id, "page": page, "rect": box, "text": value["text"]}
    if not value["text"]:
        result["notice"] = (
            "该区域没有可提取的文字（图片、扫描页或旋转页）；请用 view_image 查看同一 rect。"
        )
    return result


def list_figures(app, owner, id):
    """Figure and table captions with their pages, from the captions in the text."""
    file = pdf_file(app, owner, id)
    value = inspect(app.state.settings, file.id, operation="captions")
    items = value["items"]
    return {
        "file_id": file.id,
        "items": items[:100],
        "truncated": len(items) > 100 or bool(value.get("limited")),
        "pages_scanned": value["pages_scanned"],
        "total_pages": value["total_pages"],
    }
