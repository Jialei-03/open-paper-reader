"""Small public-link cards; reuse the network tool's public-IP and redirect checks."""

import threading
import time
from collections import OrderedDict
from html.parser import HTMLParser
from urllib.parse import urlsplit

from fastapi import HTTPException

from .agent_web import fetch


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = {}
        self.in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            key = (values.get("name") or values.get("property") or "").lower()
            self.fields.setdefault(key, (values.get("content") or "")[:2000])

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title = (self.title + data)[:500]


class LinkPreviews:
    def __init__(self):
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)

    def get(self, url):
        try:
            valid = urlsplit(url).scheme in {"http", "https"}
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(422, "仅支持公开网页链接")
        with self.lock:
            cached = self.cache.get(url)
            if cached and cached[0] > time.monotonic():
                return cached[1]
        if not self.slots.acquire(blocking=False):
            raise HTTPException(429, "链接预览繁忙，请稍后重试")
        try:
            try:
                data, mime, final = fetch(url, 2 * 1024 * 1024)
                if "html" not in mime.lower():
                    return {
                        "url": final,
                        "title": urlsplit(final).hostname,
                        "description": "此链接不是网页，可打开查看原文件。",
                    }
                parser = Metadata()
                parser.feed(data.decode("utf-8", errors="replace"))
                fields = parser.fields
                result = {
                    "url": final,
                    "title": fields.get("citation_title")
                    or fields.get("og:title")
                    or parser.title
                    or urlsplit(final).hostname,
                    "description": fields.get("citation_abstract")
                    or fields.get("description")
                    or fields.get("og:description")
                    or "来源没有提供摘要。",
                    "author": fields.get("citation_author", ""),
                    "date": fields.get("citation_publication_date", ""),
                }
            except (ValueError, OSError) as error:
                raise HTTPException(
                    422, "暂时无法预览此来源，请打开原链接查看"
                ) from error
            with self.lock:
                self.cache[url] = (time.monotonic() + 600, result)
                self.cache.move_to_end(url)
                while len(self.cache) > 64:
                    self.cache.popitem(last=False)
            return result
        finally:
            self.slots.release()
