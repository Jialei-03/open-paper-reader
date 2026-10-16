"""Bounded arXiv retrieval. User input is an identifier, never a fetch URL."""

import io
import os
import re
import tarfile
import threading
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx

from .import_progress import report

ID = re.compile(r"(?:\d{4}\.\d{4,5}|[a-z][a-z.-]+/\d{7})(?:v[1-9]\d*)?", re.IGNORECASE)
_lock = threading.Lock()
_last = 0.0


def identifier(value):
    value = value.strip()
    if value.lower().startswith(("arxiv.org/", "www.arxiv.org/", "export.arxiv.org/")):
        value = "https://" + value
    if value.lower().startswith(("https://", "http://")):
        u = urlparse(value)
        if (
            u.hostname not in {"arxiv.org", "www.arxiv.org", "export.arxiv.org"}
            or u.username is not None
            or u.password is not None
            or u.port not in {None, 80, 443}
        ):
            raise ValueError("请输入 arXiv 论文链接或编号")
        match = re.fullmatch(
            r"/(?:abs|html|pdf|src|e-print)/(.+?)/?", u.path, re.IGNORECASE
        )
        if not match:
            raise ValueError("请输入 arXiv 论文链接或编号")
        # Query/fragment are page navigation and sharing metadata, never fetch
        # instructions. Downloads are reconstructed from the validated ID.
        value = match.group(1).removesuffix(".pdf")
    value = re.sub(r"^arxiv:", "", value, flags=re.IGNORECASE)
    if not ID.fullmatch(value):
        raise ValueError("arXiv 编号格式不正确")
    return value.lower()


def download(path, limit=50 * 1024**2):
    for attempt in range(3):
        report(attempt=attempt + 1, received=0, total=None)
        try:
            return _download_once(path, limit)
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            if status not in {408, 429, 500, 502, 503, 504} or attempt == 2:
                raise ValueError(
                    f"arXiv 下载失败（HTTP {status}），请稍后重试"
                ) from None
        except httpx.TransportError:
            if attempt == 2:
                raise ValueError(
                    "arXiv 下载连接中断或超时，已重试 3 次，请稍后重试"
                ) from None


def _download_once(path, limit):
    global _last
    if not path.startswith(("/api/query?", "/pdf/", "/src/", "/abs/")):
        raise ValueError("Unsupported arXiv resource")
    host = "export.arxiv.org" if path.startswith("/api/") else "arxiv.org"
    with httpx.Client(
        timeout=httpx.Timeout(60, connect=15),
        follow_redirects=False,
        proxy=os.getenv("ARXIV_PROXY") or None,
    ) as client:
        url = "https://" + host + path
        for _ in range(4):
            # Space request starts, without holding the global lock throughout a
            # slow transfer. Redirects are requests too and must be paced.
            with _lock:
                delay = max(0, 3 - (time.monotonic() - _last))
                report(waiting_seconds=round(delay, 1))
                time.sleep(delay)
                _last = time.monotonic()
            report(waiting_seconds=0)
            with client.stream(
                "GET", url, headers={"User-Agent": "PaperWorkspace/1.0"}
            ) as r:
                if r.is_redirect:
                    u = urlparse(str(r.url.join(r.headers["location"])))
                    if (
                        u.scheme != "https"
                        or u.hostname not in {"arxiv.org", "export.arxiv.org"}
                        or u.username is not None
                        or u.password is not None
                        or u.port not in {None, 443}
                    ):
                        raise ValueError("arXiv 返回不受支持的跳转")
                    url = u.geturl()
                    continue
                r.raise_for_status()
                length = r.headers.get("content-length", "")
                # iter_bytes decodes compression; only uncompressed lengths are
                # comparable to the bytes shown to the user.
                total = (
                    int(length)
                    if length.isdigit() and not r.headers.get("content-encoding")
                    else None
                )
                if total is not None and total > limit:
                    raise ValueError("arXiv 文件超过大小限制")
                report(received=0, total=total)
                data = bytearray()
                for block in r.iter_bytes(chunk_size=64 * 1024):
                    data.extend(block)
                    if len(data) > limit:
                        raise ValueError("arXiv 文件超过大小限制")
                    report(received=len(data), total=total)
                report(received=len(data), total=total)
                return bytes(data)
        raise ValueError("arXiv 跳转次数过多")


def metadata_api(value):
    value = identifier(value)
    data = download("/api/query?id_list=" + value, 2_000_000)
    root = ET.fromstring(data)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    entry = root.find("a:entry", ns)
    if entry is None:
        raise ValueError("未找到这篇 arXiv 论文")
    locked = identifier(entry.findtext("a:id", "", ns))
    if not re.search(r"v[1-9]\d*$", locked):
        raise ValueError("arXiv 未返回确定版本")
    if re.sub(r"v\d+$", "", value) != re.sub(r"v\d+$", "", locked) or (
        re.search(r"v\d+$", value) and value != locked
    ):
        raise ValueError("arXiv 返回的版本与请求不一致")
    return {
        "arxiv_id": locked,
        "title": " ".join(entry.findtext("a:title", "", ns).split()),
        "abstract": " ".join(entry.findtext("a:summary", "", ns).split()),
        "authors": "; ".join(
            a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)
        ),
    }


def extract_source(data, destination):
    """Reject links, devices, traversal and bombs before writing a TeX project."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        members = archive.getmembers()
        if len(members) > 3000 or sum(m.size for m in members) > 150 * 1024**2:
            raise ValueError("源码包超出限制")
        seen = set()
        for m in members:
            p = PurePosixPath(m.name)
            if (
                p.is_absolute()
                or ".." in p.parts
                or "\\" in m.name
                or not (m.isfile() or m.isdir())
            ):
                raise ValueError("源码包含不安全的文件路径或链接")
            if p in seen:
                raise ValueError("源码包包含重复路径")
            seen.add(p)
        for m in members:
            target = destination.joinpath(*PurePosixPath(m.name).parts)
            if m.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(m) as src:
                    target.write_bytes(src.read())
    if not list(destination.rglob("*.tex")):
        raise ValueError("该版本未提供可用的 LaTeX 源码；本阶段不支持纯 PDF 翻译")


class CitationMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}
        self.version = ""
        self.in_version = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("name", "").startswith("citation_"):
            self.values.setdefault(attrs["name"], []).append(attrs.get("content", ""))
        if tag == "td":
            self.in_version = "arxividv" in attrs.get("class", "").split()
        if self.in_version and tag == "a" and "/abs/" in attrs.get("href", ""):
            self.version = identifier(attrs["href"])

    def handle_endtag(self, tag):
        if tag == "td":
            self.in_version = False


def metadata(value):
    value = identifier(value)
    try:
        return metadata_api(value)
    except (httpx.HTTPError, ET.ParseError, ValueError):
        # The official HTML page carries citation metadata and an explicit revision.
        page = CitationMetadata()
        page.feed(download("/abs/" + value, 2_000_000).decode("utf-8"))
        base = re.sub(r"v\d+$", "", value)
        locked = page.version
        if (
            not locked
            or re.sub(r"v\d+$", "", locked) != base
            or (re.search(r"v\d+$", value) and locked != value)
        ):
            raise ValueError("无法确认论文版本")
        title = page.values.get("citation_title", [""])[0]
        if not title:
            raise ValueError("未找到论文标题")
        return {
            "arxiv_id": locked,
            "title": title,
            "abstract": page.values.get("citation_abstract", [""])[0],
            "authors": "; ".join(page.values.get("citation_author", [])),
        }
