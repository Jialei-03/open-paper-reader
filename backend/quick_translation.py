# ruff: noqa: B008
"""Optional, bounded basic translation of an explicitly selected text passage."""

import hashlib
import json
import os
import threading
import time
from collections import OrderedDict, deque
from typing import Literal
from functools import lru_cache

import httpx
from fastapi import Depends, HTTPException
from pydantic import Field

from .models import File
from .schemas import Strict


class QuickTranslationInput(Strict):
    page: int = Field(ge=1, le=3000)
    text: str = Field(min_length=1, max_length=5000)
    language: Literal[
        "zh", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "pt", "ru", "ar", "hi"
    ] = "zh"


@lru_cache(maxsize=1)
def translation_client(proxy):
    # The proxy's first TLS handshake can take >5s; keep a bounded pool so
    # subsequent selections reuse it instead of paying that cost each time.
    return httpx.Client(
        proxy=proxy,
        timeout=httpx.Timeout(20, connect=15),
        limits=httpx.Limits(max_connections=3, max_keepalive_connections=3,
                           keepalive_expiry=120),
        trust_env=False,
        follow_redirects=False,
    )


def google_translate(text, language="zh"):
    # This optional public endpoint has no availability guarantee. Never silently
    # fall back to a paid model, redirect, or a user-supplied upstream address.
    client = translation_client(os.getenv("ARXIV_PROXY") or None)
    with (
        client.stream(
            "GET",
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": "auto", "tl": "zh-CN" if language == "zh" else language, "dt": "t", "q": text},
        ) as response,
    ):
        response.raise_for_status()
        raw = bytearray()
        for chunk in response.iter_bytes():
            raw.extend(chunk)
            if len(raw) > 256 * 1024:
                raise ValueError("Translation response too large")
    data = json.loads(raw)
    if not isinstance(data, list) or not data or not isinstance(data[0], list):
        raise ValueError("Invalid translation response")
    if any(not isinstance(row, list) for row in data[0]):
        raise ValueError("Invalid translation segment")
    result = "".join(
        row[0] for row in data[0] if row and isinstance(row[0], str)
    ).strip()
    if not result or len(result) > 20000:
        raise ValueError("Incomplete translation")
    return result


class QuickTranslator:
    def __init__(self):
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(3)
        self.cache = OrderedDict()
        self.starts = OrderedDict()

    def translate(self, owner, text, language="zh"):
        current = time.monotonic()
        key = (owner, language, hashlib.sha256(text.encode()).hexdigest())
        with self.lock:
            cached = self.cache.get(key)
            if cached and current - cached[0] < 600:
                self.cache.move_to_end(key)
                return cached[1]
            requests = self.starts.setdefault(owner, deque())
            while requests and current - requests[0] >= 60:
                requests.popleft()
            if len(requests) >= 20:
                raise HTTPException(429, "快速翻译请求较多，请稍后再试")
            requests.append(current)
            self.starts.move_to_end(owner)
            while len(self.starts) > 1024:
                self.starts.popitem(last=False)
        if not self.slots.acquire(blocking=False):
            raise HTTPException(429, "快速翻译繁忙，请稍后再试")
        try:
            result = google_translate(text, language)
        except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError):
            raise HTTPException(503, "免费基础翻译暂不可用，可改用 AI 翻译") from None
        finally:
            self.slots.release()
        with self.lock:
            self.cache[key] = (current, result)
            self.cache.move_to_end(key)
            while len(self.cache) > 256:
                self.cache.popitem(last=False)
        return result


def install_quick_translation_routes(app, db, auth, owned):
    translator = QuickTranslator()

    @app.post("/api/v1/files/{id}/quick-translation")
    def translate(id: str, body: QuickTranslationInput, a=Depends(auth), d=Depends(db)):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf" or not file.pages or body.page > file.pages:
            raise HTTPException(422, "请选择 PDF 中的文字段落")
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "请选择需要翻译的文字")
        return {
            "text": translator.translate(a["id"], text, body.language),
            "provider": "Google",
            "page": body.page,
        }
