"""Sentence-level citations: the one syntax, and the one check that makes it true.

A claim sentence of a guide, an answer or a note ends with a marker that names
the page and the paper's own words it rests on::

    [[p3: "words copied from page 3"]]

Canonical form: `[[p<page>: "<quote>"]]`. A quote that itself holds a straight
double quote is written with corner brackets, `[[p3: 「…」]]`, and curly
quotes (`“…”`) are read too, since a model produces them unasked. The frontend
reads the same syntax (`frontend/src/reader/cite/marks.ts`); keep the two alike.

A model is never trusted about where its words are. `verify` looks every quote
up in the text of the paper's pages: a quote found on the page it names is kept
(written back as the page's own words, so the reader's text search finds it); one
found only on another page gets that page; one found nowhere is dropped and its
sentence stays without a citation. A marker is never kept pointing somewhere it
was not found.
"""

import re
import unicodedata
from dataclasses import dataclass

MAX_QUOTE = 300
# Shorter than this, a "quote" is a word that is anywhere on the page.
MIN_FOLDED = 8
MAX_PAGE = 3000

MARK = re.compile(
    r"\[\[\s*[pP]\.?\s*(?P<page>\d{1,4})\s*[:：]\s*"
    r'(?:"(?P<a>.+?)"|“(?P<b>.+?)”|「(?P<c>.+?)」)\s*\]\]',
    re.DOTALL,
)
# A marker that is closed but not well formed ([[p3]], [[p3: no quotes]]): never shown.
LOOSE = re.compile(r"[ \t]*\[\[\s*[pP]\.?\s*\d{1,4}\b[^\[\]\n]*\]\]")

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
_DASHES = str.maketrans({c: "-" for c in "‐‑‒–—―−"})
_DROPPED = "­​‌‍⁠﻿"


@dataclass(frozen=True)
class Mark:
    start: int
    end: int
    page: int
    quote: str


def parse(text):
    """The well-formed markers of `text`, in order."""
    marks = []
    for found in MARK.finditer(text):
        quote = found.group("a") or found.group("b") or found.group("c") or ""
        marks.append(Mark(found.start(), found.end(), int(found.group("page")), quote))
    return marks


def fold(text, loose=False):
    """`text` with only typography removed, and where each kept character came from.

    Whitespace, soft hyphens, ligatures (NFKC), curly quotes and the many dashes
    do not tell two texts apart. `loose` also drops hyphens, for a word the PDF
    broke across lines ("exam- ple") that a quote gives whole."""
    out, offsets = [], []
    for offset, char in enumerate(text):
        if char.isspace() or char in _DROPPED:
            continue
        for part in unicodedata.normalize("NFKC", char):
            if part.isspace() or part in _DROPPED:
                continue
            part = part.translate(_QUOTES).translate(_DASHES)
            if loose and part == "-":
                continue
            out.append(part)
            offsets.append(offset)
    return "".join(out), offsets


def locate(quote, page_text):
    """Where `quote` is in `page_text`: (start, end) in the page's own text, else None."""
    for loose in (False, True):
        wanted, _ = fold(quote, loose)
        if len(wanted) < MIN_FOLDED:
            return None
        source, offsets = fold(page_text, loose)
        at = source.find(wanted)
        if at >= 0:
            return offsets[at], offsets[at + len(wanted) - 1] + 1
    return None


def render(page, quote):
    """The canonical marker, or None for a quote that cannot be written in one."""
    quote = " ".join(quote.split())
    if not quote or len(quote) > MAX_QUOTE or "[[" in quote or "]]" in quote:
        return None
    if '"' not in quote:
        return f'[[p{page}: "{quote}"]]'
    if "」" not in quote:
        return f"[[p{page}: 「{quote}」]]"
    return None


def _nearest(pages, around):
    return sorted(pages, key=lambda n: (abs(n - around), n))


def check_quote(page, quote, pages):
    """(page, quote) as the pages really have it, or None when they do not have it.

    `pages` maps page numbers to text. The page named is tried first, then the
    others, nearest first."""
    if not isinstance(quote, str) or not quote.strip():
        return None
    if len(" ".join(quote.split())) > MAX_QUOTE:
        return None
    for number in _nearest(pages, page):
        text = pages[number]
        span = locate(quote, text) if isinstance(text, str) else None
        if span:
            return number, " ".join(text[span[0] : span[1]].split())
    return None


def verify(text, pages):
    """`text` with every marker checked against `pages` ({number: text}).

    Returns (new text, [(page, quote)] of the markers kept, in order)."""
    kept, out, at = [], [], 0
    for mark in parse(text):
        out.append(LOOSE.sub("", text[at : mark.start]))
        at = mark.end
        found = check_quote(mark.page, mark.quote, pages) if mark.page <= MAX_PAGE else None
        written = render(*found) if found else None
        if written:
            out.append(written)
            kept.append(found)
        else:
            # The sentence stays; the space the marker followed goes with it.
            out[-1] = out[-1].rstrip(" \t")
    out.append(LOOSE.sub("", text[at:]))
    return "".join(out), kept


def strip(text):
    """`text` without any marker (and without a half-written one at its end)."""
    text = LOOSE.sub("", MARK.sub("", text))
    return re.sub(r"[ \t]*\[\[\s*[pP]?[^\]]{0,700}$", "", text)


def install_cite_check_route(app, settings, db, auth, owned):
    """`POST /api/v1/files/{id}/citations/check`: where each quote of an answer really is.

    An answer is written as it streams, and its markers can only be checked once
    the paper's text is at hand, so the reader asks here and shows a marker only
    when it comes back found."""
    from fastapi import Depends
    from pydantic import Field

    from .agent_reading import page_texts
    from .models import File
    from .schemas import Strict

    class Claim(Strict):
        page: int = Field(ge=1, le=MAX_PAGE, strict=True)
        quote: str = Field(min_length=1, max_length=2000)

    class Claims(Strict):
        marks: list[Claim] = Field(min_length=1, max_length=120)

    @app.post("/api/v1/files/{id}/citations/check")
    def check_citations(id: str, body: Claims, a=Depends(auth), d=Depends(db)):
        file = owned(d, File, id, a)
        if file.mime != "application/pdf":
            return {"results": [None for _ in body.marks]}
        try:
            texts = page_texts(app, file)
        except ValueError:
            return {"results": [None for _ in body.marks]}
        pages = {n: t for n, t in enumerate(texts, 1)}
        results = []
        for claim in body.marks:
            found = check_quote(claim.page, claim.quote, pages)
            results.append(
                {"page": found[0], "quote": found[1]}
                if found and render(*found)
                else None
            )
        return {"results": results}
