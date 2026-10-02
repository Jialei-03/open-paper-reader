"""Public web retrieval with pinned public IPs, bounded downloads and redirect checks."""

import http.client
import ipaddress
import json
import socket
import ssl
import time
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin, urlsplit


def addresses(host, port):
    found = list(
        dict.fromkeys(
            x[4][0] for x in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        )
    )
    if not found or any(
        not ipaddress.ip_address(x).is_global or ipaddress.ip_address(x).is_multicast
        for x in found
    ):
        raise ValueError("网络工具不能访问内网、回环或服务器元数据地址")
    return found


def fetch(url, limit=20 * 1024 * 1024):
    deadline = time.monotonic() + 45
    for _ in range(5):
        u = urlsplit(url)
        if (
            u.scheme not in {"http", "https"}
            or not u.hostname
            or u.username
            or u.password
            or u.port not in {None, 80, 443}
        ):
            raise ValueError("请输入公开 HTTP/HTTPS 链接，不支持账号凭据或自定义端口")
        port = u.port or (443 if u.scheme == "https" else 80)
        ips = addresses(u.hostname, port)
        connection = http.client.HTTPConnection(u.hostname, port, timeout=15)
        raw = socket.create_connection((ips[0], port), timeout=15)
        connection.sock = (
            ssl.create_default_context().wrap_socket(raw, server_hostname=u.hostname)
            if u.scheme == "https"
            else raw
        )
        try:
            connection.request(
                "GET",
                u.path + ("?" + u.query if u.query else "") or "/",
                headers={
                    "User-Agent": "PaperWorkspace/1.0",
                    "Accept-Encoding": "identity",
                },
            )
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if response.status >= 400:
                raise ValueError(f"网站返回 HTTP {response.status}")
            data = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise ValueError("下载超时")
                chunk = response.read(65536)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > limit:
                    raise ValueError("下载文件超过大小限制")
            return bytes(data), response.getheader("Content-Type", ""), url
        finally:
            connection.close()
    raise ValueError("网页跳转次数过多")


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.text.append(data.strip())


def read(url):
    data, _mime, final = fetch(url, 3 * 1024 * 1024)
    if data.startswith(b"%PDF-"):
        return {
            "url": final,
            "notice": "这是 PDF，请用 download_file 下载，然后 read_file 或隔离终端处理。",
        }
    page = Page()
    page.feed(data.decode("utf-8", errors="replace"))
    return {
        "url": final,
        "text": "\n".join(page.text)[:40000],
        "links": list(
            dict.fromkeys(
                urljoin(final, x)
                for x in page.links
                if urlsplit(urljoin(final, x)).scheme in {"http", "https"}
            )
        )[:80],
    }


def search(query):
    raw, _, _ = fetch(
        "https://api.crossref.org/works?" + urlencode({"query": query, "rows": 8}),
        2 * 1024 * 1024,
    )
    rows = json.loads(raw)["message"]["items"]
    return {
        "source": "Crossref",
        "papers": [
            {
                "title": x.get("title", []),
                "doi": x.get("DOI"),
                "url": x.get("URL"),
                "links": x.get("link", []),
            }
            for x in rows
        ],
    }
