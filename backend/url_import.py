# ruff: noqa: B008
"""Import a paper from any web address: an arXiv page, a publisher's landing
page that names its PDF, or a direct PDF link.

The hosted server fetches whatever address a user types, so every request here
is checked first: https only (plain http to 127.0.0.1 only in the local build),
the name is resolved and refused when any answer is a private, loopback,
link-local or otherwise non-public address, the request then goes to the
checked address itself (so a second lookup cannot answer differently), and the
same checks apply to each of at most five redirects.
"""

import contextlib
import hashlib
import ipaddress
import re
import socket
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .import_progress import report, tracking
from .models import File, Paper, Version, public
from .storage_budget import lock_owner
from .translations import import_arxiv_paper, store_file

PDF_LIMIT = 50 * 1024**2
PAGE_LIMIT = 2 * 1024**2
MAX_REDIRECTS = 5
DEADLINE_SECONDS = 120
USER_AGENT = "Mozilla/5.0 (compatible; open-paper-reader/1.0)"

NO_PDF_LINK = "这个页面没有可下载的 PDF，可能需要机构订阅；请下载后拖进来"
PAYWALL = "这个网站拒绝了下载，可能需要登录或机构订阅；请下载后拖进来"
NOT_ALLOWED = "出于安全考虑，不能导入这个地址（只支持公开的 https 链接）"

ARXIV_HOSTS = {"arxiv.org", "www.arxiv.org", "export.arxiv.org"}
ALPHAXIV_HOSTS = {"alphaxiv.org", "www.alphaxiv.org"}
AR5IV_HOSTS = {"ar5iv.org", "www.ar5iv.org", "ar5iv.labs.arxiv.org"}
ARXIV_ID = r"(\d{4}\.\d{4,5}(?:v[1-9]\d*)?|[a-z][a-z.-]+/\d{7}(?:v[1-9]\d*)?)"


class UrlInput(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class Refused(ValueError):
    """The address may not be fetched; the message is for the reader."""


def resolve(host, port):
    """Every address the name answers with (a seam for tests)."""
    try:
        found = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise Refused("找不到这个网址，请检查链接") from None
    return list(dict.fromkeys(item[4][0].split("%")[0] for item in found))


def public_address(ip):
    address = ipaddress.ip_address(ip)
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped:
            address = address.ipv4_mapped
        elif address.sixtofour:
            address = address.sixtofour
        elif address.teredo:
            return False
    return address.is_global and not address.is_multicast


def arxiv_target(url):
    """The arXiv address inside an arXiv, alphaxiv or ar5iv link, else None."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    path = unquote(parts.path)
    if host in ARXIV_HOSTS:
        match = re.fullmatch(
            rf"/(?:abs|html|pdf|src|e-print)/{ARXIV_ID}(?:\.pdf)?/?",
            path,
            re.IGNORECASE,
        )
    elif host in ALPHAXIV_HOSTS:
        match = re.fullmatch(
            rf"/(?:abs|overview|pdf)/{ARXIV_ID}(?:\.pdf)?/?", path, re.IGNORECASE
        )
    elif host in AR5IV_HOSTS:
        match = re.fullmatch(rf"/(?:abs|html)/{ARXIV_ID}/?", path, re.IGNORECASE)
    else:
        return None
    return "https://arxiv.org/abs/" + match.group(1) if match else None


def check(url, local):
    """The parts of `url` and the one address to connect to, or Refused."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    try:
        port = parts.port
    except ValueError:
        raise Refused(NOT_ALLOWED) from None
    if parts.username is not None or parts.password is not None or not host:
        raise Refused(NOT_ALLOWED)
    if local and host == "127.0.0.1" and parts.scheme in {"http", "https"}:
        return parts, ["127.0.0.1"]
    if parts.scheme != "https" or port not in {None, 443}:
        raise Refused(NOT_ALLOWED)
    addresses = resolve(host, 443)
    if not addresses or not all(public_address(ip) for ip in addresses):
        raise Refused(NOT_ALLOWED)
    return parts, addresses


def open_pinned(client, url, local, headers):
    """Start a GET to `url` on a checked address; returns a stream context."""
    parts, addresses = check(url, local)
    host = parts.hostname
    last = None
    for ip in addresses:
        netloc = f"[{ip}]" if ":" in ip else ip
        if parts.port:
            netloc += f":{parts.port}"
        target = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
        stream = client.stream(
            "GET",
            target,
            headers={**headers, "Host": parts.netloc.rpartition("@")[2]},
            extensions={"sni_hostname": host} if ip != host else {},
        )
        try:
            return stream, stream.__enter__()
        except httpx.TransportError as error:
            last = error
    raise last or Refused(NOT_ALLOWED)


def http_reason(status):
    if status in {401, 402, 403, 451}:
        return PAYWALL
    if status in {404, 410}:
        return "找不到这个链接的内容，请检查链接"
    return f"对方网站返回了错误（HTTP {status}），请稍后重试"


def fetch(url, local, *, accept_page=True):
    """Follow redirects by hand. Returns (final_url, kind, body, total) where
    kind is "pdf" or "html"; a page is cut at 2 MB, a PDF over 50 MB refused."""
    started = time.monotonic()
    current = url
    with httpx.Client(
        timeout=httpx.Timeout(30, connect=10),
        follow_redirects=False,
        trust_env=False,
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            if time.monotonic() - started > DEADLINE_SECONDS:
                raise Refused("下载用时过长，已停止；请稍后重试")
            headers = {
                "User-Agent": USER_AGENT,
                "Accept": "application/pdf,text/html;q=0.9,*/*;q=0.1",
            }
            try:
                stream, response = open_pinned(client, current, local, headers)
            except Refused:
                raise
            except httpx.TimeoutException:
                raise Refused("连接超时，请稍后重试") from None
            except httpx.HTTPError:
                raise Refused("无法连接到这个网址，请检查链接或稍后重试") from None
            try:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        raise Refused("对方网站的跳转无效")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    raise Refused(http_reason(response.status_code))
                kind = (response.headers.get("content-type") or "").lower()
                length = response.headers.get("content-length", "")
                total = (
                    int(length)
                    if length.isdigit() and not response.headers.get("content-encoding")
                    else None
                )
                is_page = "html" in kind
                if not is_page and total is not None and total > PDF_LIMIT:
                    raise Refused("文件超过 50 MB 上限")
                data = bytearray()
                try:
                    for block in response.iter_bytes(chunk_size=64 * 1024):
                        data.extend(block)
                        pdf = data.startswith(b"%PDF-")
                        if is_page and not pdf:
                            if len(data) >= PAGE_LIMIT:
                                break  # The head of a page is all that is read.
                            continue
                        if (
                            not pdf
                            and len(data) >= 1024
                            and b"%PDF-" not in data[:1024]
                        ):
                            break  # Not a PDF: no need for the rest.
                        if len(data) > PDF_LIMIT:
                            raise Refused("文件超过 50 MB 上限")
                        report(received=len(data), total=total)
                except httpx.TimeoutException:
                    raise Refused("下载中途超时，请稍后重试") from None
                except httpx.HTTPError:
                    raise Refused("下载中断，请稍后重试") from None
                body = bytes(data)
                if body.startswith(b"%PDF-") or (
                    not is_page and b"%PDF-" in body[:1024]
                ):
                    return current, "pdf", body, total
                if is_page and accept_page:
                    return current, "html", body, total
                raise Refused(NO_PDF_LINK if is_page else "这个链接指向的不是 PDF 文件")
            finally:
                stream.__exit__(None, None, None)
        raise Refused("跳转次数过多")


class PageMeta(HTMLParser):
    """The `citation_*` meta tags publishers put in a landing page's head."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attrs = dict(attrs)
        name = (attrs.get("name") or attrs.get("property") or "").lower()
        if name.startswith("citation_") or name in {"dc.identifier", "og:title"}:
            content = (attrs.get("content") or "").strip()
            if content:
                self.values.setdefault(name, []).append(content)

    def first(self, name):
        return (self.values.get(name) or [""])[0]


def read_page(body):
    meta = PageMeta()
    with contextlib.suppress(Exception):  # A broken page is read as far as it went.
        meta.feed(body.decode("utf-8", "replace"))
    return meta


def clean_doi(value):
    value = re.sub(
        r"^(https?://(dx\.)?doi\.org/|doi:)", "", value.strip(), flags=re.IGNORECASE
    )
    return value.lower() if re.fullmatch(r"10\.\d{4,9}/\S+", value) else ""


def pdf_title(raw):
    try:
        import io

        from pypdf import PdfReader

        title = (PdfReader(io.BytesIO(raw)).metadata or {}).get("/Title") or ""
    except Exception:  # noqa: BLE001
        return ""
    title = " ".join(str(title).split())
    junk = re.compile(
        r"^(untitled|microsoft word\b|.*\.(docx?|tex|pdf)$)", re.IGNORECASE
    )
    return "" if len(title) < 8 or junk.match(title) else title[:300]


def filename_for(url, title):
    name = unquote(Path(urlsplit(url).path).name)
    if not name.lower().endswith(".pdf"):
        name = re.sub(r"[^\w.-]+", "-", title).strip("-")[:80] or "paper"
        name += ".pdf"
    return re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", name)[:200]


def title_from(url):
    stem = unquote(Path(urlsplit(url).path).stem).replace("_", " ").replace("-", " ")
    stem = " ".join(stem.split())
    return stem or (urlsplit(url).hostname or "未命名论文")


def find_existing(d, owner, sha, doi):
    """A paper already in the library: same DOI, or same PDF bytes."""
    stmt = select(File).where(
        File.owner == owner, File.mime == "application/pdf", File.sha256 == sha
    )
    for f in d.scalars(stmt):
        paper = d.get(Paper, f.paper_id)
        if paper is not None and paper.owner == owner:
            return paper
    if doi:
        for paper in d.scalars(
            select(Paper).where(Paper.owner == owner, Paper.external_id == "doi:" + doi)
        ):
            has_pdf = d.scalar(
                select(File.id).where(
                    File.paper_id == paper.id,
                    File.owner == owner,
                    File.mime == "application/pdf",
                )
            )
            if has_pdf:
                return paper
    return None


def import_url_paper(d, settings, actor, url, snapshot, *, local=False):
    """Returns (paper, file); file is None when the paper was already there."""
    url = url.strip()
    if not re.match(r"https?://", url, re.IGNORECASE):
        raise HTTPException(422, "请输入以 https:// 开头的论文链接")
    arxiv = arxiv_target(url)
    if arxiv:
        return import_arxiv_paper(d, settings, actor, arxiv, snapshot)

    report("metadata")
    meta = PageMeta()
    try:
        final, kind, body, _ = fetch(url, local)
        if kind == "html":
            meta = read_page(body)
            pdf_url = meta.first("citation_pdf_url")
            if not pdf_url:
                raise Refused(NO_PDF_LINK)
            pdf_url = urljoin(final, pdf_url)
            arxiv = arxiv_target(pdf_url)
            if arxiv:
                return import_arxiv_paper(d, settings, actor, arxiv, snapshot)
            report("pdf", received=0, total=None)
            final, kind, body, _ = fetch(pdf_url, local, accept_page=False)
    except Refused as error:
        raise HTTPException(422, str(error)) from None
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "导入失败，请检查链接或稍后重试") from None

    raw = body
    doi = clean_doi(meta.first("citation_doi") or meta.first("dc.identifier"))
    sha = hashlib.sha256(raw).hexdigest()
    report("checking")
    lock_owner(d, actor["id"])
    existing = find_existing(d, actor["id"], sha, doi)
    if existing is not None:
        return existing, None
    title = (
        " ".join((meta.first("citation_title") or meta.first("og:title")).split())[:300]
        or pdf_title(raw)
        or title_from(final)
    )
    p = Paper(
        owner=actor["id"],
        title=title,
        authors="; ".join(meta.values.get("citation_author", []))[:1000],
        abstract=meta.first("citation_abstract"),
        external_id="doi:" + doi if doi else "",
        tags=[],
    )
    d.add(p)
    d.flush()
    v = Version(owner=actor["id"], paper_id=p.id, label="pdf", provenance=final)
    d.add(v)
    d.flush()
    report("saving")
    f = store_file(d, settings, p, v.id, filename_for(final, title), raw)
    try:
        p.current_version = v.id
        snapshot(d, p, actor)
        from .notebooks import default_note

        snapshot(d, default_note(d, p, actor["actor"]), actor)
    except Exception:
        (Path(settings.storage) / f.id).unlink(missing_ok=True)
        raise
    return p, f


def install_url_routes(app, settings, db, auth, snapshot, idem, save):
    @app.post("/api/v1/import/url")
    def import_url(body: UrlInput, request: Request, a=Depends(auth), d=Depends(db)):
        key, fp, old = idem(d, a, request, body.model_dump())
        if old is not None:
            return old
        with tracking(settings, a["id"], request.headers.get("X-Import-ID", "")):
            p, f = import_url_paper(
                d, settings, a, body.url, snapshot, local=settings.mode == "local"
            )
            try:
                return save(d, a, key, fp, public(p))
            except Exception:
                if f is not None:
                    (Path(settings.storage) / f.id).unlink(missing_ok=True)
                raise
