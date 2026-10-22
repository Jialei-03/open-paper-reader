"""Public bibliographic lookup: Semantic Scholar first, OpenAlex and arXiv behind it.

``lookup(doi=, arxiv=, title=)`` is the one entry point other modules use. It
returns a plain dict (``title, authors, year, venue, abstract, citation_count,
reference_count, doi, arxiv, url``, plus ``kind``/``volume``/``issue``/``pages``/
``source`` when known) or ``None`` when no source knows the paper or none can be
reached. ``lookup_checked`` is the same but raises ``ScholarUnavailable`` when
every source failed, so a caller can tell "not found" from "try again later".

Only public identifiers or a public title ever leave the machine. Every call has
a timeout and a response size cap, upstream calls are paced per host and capped
in number at once, and answers (also "not found") are cached in memory for a
while, which suits both the hosted server and the one-person local build.
"""

import difflib
import json
import os
import re
import threading
import time
from collections import OrderedDict
from urllib.parse import quote
from xml.etree import ElementTree

import httpx

TIMEOUT = httpx.Timeout(8.0, connect=4.0)
MAX_BYTES = 2 * 1024**2
HIT_TTL = 6 * 3600
MISS_TTL = 10 * 60
CACHE_SIZE = 512
# Seconds between two calls to one host, and calls in flight at once overall.
MIN_GAP = {
    "api.semanticscholar.org": 0.4,
    "api.openalex.org": 0.15,
    "export.arxiv.org": 3.0,
}
MAX_PARALLEL = 3
USER_AGENT = "open-research-agent/0.3 (+https://github.com/Jialei-03/open-research-agent)"

FIELDS = (
    "title,authors,year,venue,abstract,citationCount,referenceCount,"
    "externalIds,url,publicationTypes,publicationVenue,journal,publicationDate"
)

DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s\"<>]+)", re.IGNORECASE)
ARXIV_NEW = re.compile(r"\d{4}\.\d{4,5}")
ARXIV_OLD = re.compile(r"[a-z-]+(?:\.[A-Z]{2})?/\d{7}", re.IGNORECASE)


class ScholarUnavailable(Exception):
    """No source could be reached (or all of them refused), so nothing is known."""


def clean_doi(value):
    match = DOI_RE.search(value or "")
    return match.group(1).rstrip(".,;)").lower() if match else ""


def clean_arxiv(value):
    text = re.sub(r"^(arxiv:|https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/)", "", (value or "").strip(), flags=re.IGNORECASE)
    text = re.sub(r"(\.pdf)?(v\d+)?$", "", text, flags=re.IGNORECASE)
    if ARXIV_NEW.fullmatch(text) or ARXIV_OLD.fullmatch(text):
        return text.lower()
    return ""


def _normal(text):
    return "".join(c for c in (text or "").casefold() if c.isalnum())


# ---- caching, pacing, transport -------------------------------------------

_cache = OrderedDict()
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(MAX_PARALLEL)
_next_at = {}
_pace = threading.Lock()


def clear_cache():
    with _lock:
        _cache.clear()
    with _pace:
        _next_at.clear()


def _remember(key, value, ttl):
    with _lock:
        _cache[key] = (time.monotonic() + ttl, value)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _recall(key):
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            _cache.move_to_end(key)
            return hit
        _cache.pop(key, None)
    return None


def _wait_turn(host):
    gap = MIN_GAP.get(host, 0.5)
    with _pace:
        now = time.monotonic()
        start = max(now, _next_at.get(host, 0.0))
        _next_at[host] = start + gap
    if start > now:
        # Never queue behind the pacing for long; the caller can retry later.
        if start - now > 8:
            raise ScholarUnavailable("rate limited")
        time.sleep(start - now)


def _get(url, params=None, accept="application/json"):
    """One GET with timeout, size cap and no redirects. Returns the body bytes,
    or None for a 404. Anything else that is not a 200 raises."""
    host = httpx.URL(url).host
    if os.environ.get("SCHOLAR_OFFLINE"):
        # Browser tests and demos: nothing leaves the machine.
        raise ScholarUnavailable("offline")
    _wait_turn(host)
    if not _slots.acquire(timeout=10):
        raise ScholarUnavailable("busy")
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT, "Accept": accept}) as client:  # noqa: SIM117
            with client.stream("GET", url, params=params) as response:
                if response.status_code == 404:
                    return None
                if response.status_code != 200:
                    raise ScholarUnavailable(f"{host} answered {response.status_code}")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_BYTES:
                        raise ScholarUnavailable("response too large")
                return bytes(raw)
    except httpx.HTTPError as error:
        raise ScholarUnavailable(f"{host} unreachable: {type(error).__name__}") from None
    finally:
        _slots.release()


def _json(url, params=None):
    body = _get(url, params)
    if body is None:
        return None
    try:
        data = json.loads(body)
    except ValueError:
        raise ScholarUnavailable("invalid response") from None
    if not isinstance(data, dict):
        raise ScholarUnavailable("invalid response")
    return data


# ---- sources ---------------------------------------------------------------


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _kind(types, venue_type, venue, arxiv):
    types = {str(t).lower() for t in (types or [])}
    venue_type = (venue_type or "").lower()
    if venue_type == "conference" or "conference" in types:
        return "conference"
    if venue_type == "journal" or "journalarticle" in types:
        return "journal"
    if arxiv and (not venue or venue.lower().startswith("arxiv")):
        return "preprint"
    if re.search(r"\b(proceedings|conference|workshop|symposium)\b", venue or "", re.IGNORECASE):
        return "conference"
    return "journal" if venue else ""


def _shape(**fields):
    base = {
        "title": "",
        "authors": [],
        "year": None,
        "venue": "",
        "abstract": "",
        "citation_count": None,
        "reference_count": None,
        "doi": "",
        "arxiv": "",
        "url": "",
        "kind": "",
        "volume": "",
        "issue": "",
        "pages": "",
        "source": "",
    }
    base.update(fields)
    return base


def _from_s2(data):
    def text(value):
        return value.strip() if isinstance(value, str) else ""

    if not isinstance(data, dict) or not text(data.get("title")):
        raise ScholarUnavailable("invalid paper metadata")
    ids = data.get("externalIds")
    ids = ids if isinstance(ids, dict) else {}
    venue_info = data.get("publicationVenue")
    # Recommendation responses sometimes supply the venue name directly.
    if isinstance(venue_info, str):
        venue_info = {"name": venue_info}
    elif not isinstance(venue_info, dict):
        venue_info = {}
    journal = data.get("journal")
    journal = journal if isinstance(journal, dict) else {}
    authors = data.get("authors")
    authors = authors if isinstance(authors, list) else []
    types = data.get("publicationTypes")
    types = [types] if isinstance(types, str) else types if isinstance(types, list) else []
    venue = text(venue_info.get("name")) or text(journal.get("name")) or text(data.get("venue"))
    arxiv = clean_arxiv(text(ids.get("ArXiv")))
    doi = clean_doi(text(ids.get("DOI")))
    if venue.lower() in {"arxiv.org", "arxiv"} or (arxiv and venue.lower().startswith("arxiv")):
        venue = ""
    return _shape(
        title=text(data.get("title")),
        authors=[text(a.get("name")) for a in authors if isinstance(a, dict) and text(a.get("name"))][:100],
        year=_int(data.get("year")),
        venue=venue,
        abstract=text(data.get("abstract"))[:20000],
        citation_count=_int(data.get("citationCount")),
        reference_count=_int(data.get("referenceCount")),
        doi=doi,
        arxiv=arxiv,
        url=text(data.get("url")),
        kind=_kind(types, text(venue_info.get("type")), venue, arxiv),
        volume=str(journal.get("volume") or "").strip(),
        pages=str(journal.get("pages") or "").strip().replace("--", "-"),
        source="Semantic Scholar",
    )


def _abstract_from_index(index):
    if not isinstance(index, dict):
        return ""
    slots = {}
    for word, places in index.items():
        for place in places if isinstance(places, list) else []:
            if isinstance(place, int):
                slots[place] = word
    return " ".join(slots[i] for i in sorted(slots))[:20000]


def _from_openalex(data):
    location = data.get("primary_location") or {}
    source = location.get("source") or {}
    ids = data.get("ids") or {}
    doi = clean_doi(data.get("doi") or ids.get("doi") or "")
    arxiv = ""
    for loc in data.get("locations") or []:
        landing = (loc or {}).get("landing_page_url") or ""
        found = re.search(r"arxiv\.org/abs/([^\s?#]+)", landing)
        if found:
            arxiv = clean_arxiv(found.group(1))
            break
    if not arxiv:
        found = re.search(r"10\.48550/arxiv\.(.+)$", doi)
        arxiv = clean_arxiv(found.group(1)) if found else ""
    venue = (source.get("display_name") or "").strip()
    if venue.lower() in {"arxiv.org", "arxiv"} or venue.lower().startswith("arxiv"):
        venue = ""
    biblio = data.get("biblio") or {}
    first, last = biblio.get("first_page"), biblio.get("last_page")
    kind = ""
    stype = (source.get("type") or "").lower()
    if stype == "conference":
        kind = "conference"
    elif stype == "journal":
        kind = "journal"
    elif arxiv and not venue:
        kind = "preprint"
    elif venue:
        kind = _kind([], "", venue, arxiv)
    return _shape(
        title=(data.get("title") or data.get("display_name") or "").strip(),
        authors=[
            (a.get("author") or {}).get("display_name", "").strip()
            for a in data.get("authorships") or []
            if (a.get("author") or {}).get("display_name")
        ][:100],
        year=_int(data.get("publication_year")),
        venue=venue,
        abstract=_abstract_from_index(data.get("abstract_inverted_index")),
        citation_count=_int(data.get("cited_by_count")),
        reference_count=_int(data.get("referenced_works_count")) if "referenced_works_count" in data else (len(data["referenced_works"]) if isinstance(data.get("referenced_works"), list) else None),
        doi=doi,
        arxiv=arxiv,
        url=(location.get("landing_page_url") or data.get("id") or ""),
        kind=kind,
        volume=str(biblio.get("volume") or ""),
        issue=str(biblio.get("issue") or ""),
        pages="-".join(str(p) for p in (first, last) if p) if first and last and first != last else str(first or ""),
        source="OpenAlex",
    )


ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"


def _from_arxiv(xml):
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        raise ScholarUnavailable("invalid response") from None
    entry = root.find(ATOM + "entry")
    if entry is None:
        return None
    title = " ".join((entry.findtext(ATOM + "title") or "").split())
    if not title or title.lower() == "error":
        return None
    link = entry.findtext(ATOM + "id") or ""
    arxiv = clean_arxiv(re.sub(r"^https?://arxiv\.org/abs/", "", link))
    published = entry.findtext(ATOM + "published") or ""
    ref = " ".join((entry.findtext(ARXIV_NS + "journal_ref") or "").split())
    return _shape(
        title=title,
        authors=[" ".join((a.findtext(ATOM + "name") or "").split()) for a in entry.findall(ATOM + "author") if a.findtext(ATOM + "name")][:100],
        year=int(published[:4]) if published[:4].isdigit() else None,
        venue=ref,
        abstract=" ".join((entry.findtext(ATOM + "summary") or "").split())[:20000],
        doi=clean_doi(entry.findtext(ARXIV_NS + "doi") or ""),
        arxiv=arxiv,
        url=f"https://arxiv.org/abs/{arxiv}" if arxiv else link,
        kind="journal" if ref else "preprint",
        source="arXiv",
    )


def _s2(doi, arxiv, title):
    base = "https://api.semanticscholar.org/graph/v1/paper/"
    if doi or arxiv:
        ident = ("DOI:" + doi) if doi else ("ARXIV:" + arxiv)
        data = _json(base + quote(ident, safe=":"), {"fields": FIELDS})
    else:
        found = _json(base + "search/match", {"query": title, "fields": FIELDS})
        rows = (found or {}).get("data")
        data = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    return _from_s2(data) if data and data.get("title") else None


def _openalex(doi, arxiv, title):
    base = "https://api.openalex.org/works"
    if doi or arxiv:
        ident = doi or "10.48550/arxiv." + arxiv
        data = _json(f"{base}/https://doi.org/{quote(ident, safe='/')}")
    else:
        found = _json(base, {"search": title, "per-page": 1})
        rows = (found or {}).get("results")
        data = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    return _from_openalex(data) if data and (data.get("title") or data.get("display_name")) else None


def _arxiv(doi, arxiv, title):
    if not arxiv:
        return None
    body = _get("https://export.arxiv.org/api/query", {"id_list": arxiv}, accept="application/atom+xml")
    return _from_arxiv(body) if body else None


SOURCES = (_s2, _openalex, _arxiv)

# What a later source may fill in when an earlier one left it empty.
FILL = ("authors", "year", "venue", "abstract", "citation_count", "reference_count", "doi", "arxiv", "url", "kind", "volume", "issue", "pages")


def _same_title(wanted, found):
    a, b = _normal(wanted), _normal(found)
    return bool(a and b) and (a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.9)


def _title_fits(wanted, found, within=None):
    if _same_title(wanted, found):
        return True
    # An entry carries authors, venue and year around the title.
    named = _normal(found)
    return bool(within and len(named) >= 12 and named in _normal(within))


def lookup_checked(*, doi=None, arxiv=None, title=None, within=None):
    """Look a paper up; ``None`` if no source knows it, ``ScholarUnavailable`` if none answered.

    ``within`` is a whole reference-list entry the title was taken from: a found
    work is then accepted when its title appears in that entry.
    """
    doi = clean_doi(doi or "")
    arxiv = clean_arxiv(arxiv or "")
    title = " ".join((title or "").split())[:300]
    if not (doi or arxiv or len(title) >= 8):
        return None
    key = ("doi", doi) if doi else ("arxiv", arxiv) if arxiv else ("title", _normal(title))
    hit = _recall(key)
    if hit:
        return dict(hit[1]) if hit[1] else None
    by_title = not (doi or arxiv)
    result = None
    answered = False
    failure = None
    for source in SOURCES:
        if source is _arxiv and not arxiv:
            continue  # arXiv can only be asked by its own number
        try:
            found = source(doi, arxiv, title if by_title else "")
        except ScholarUnavailable as error:
            failure = error
            continue
        answered = True
        if not found:
            continue
        if by_title and not _title_fits(title, found["title"], within):
            continue
        if result is None:
            result = found
        else:
            for field in FILL:
                if result[field] in ("", [], None):
                    result[field] = found[field]
        # Semantic Scholar alone gives counts and venue; others only top up gaps.
        if result["citation_count"] is not None and result["abstract"] and (result["venue"] or result["kind"] == "preprint"):
            break
    if result is None:
        if not answered:
            raise ScholarUnavailable(str(failure or "no source"))
        _remember(key, None, MISS_TTL)
        return None
    _remember(key, result, HIT_TTL)
    return dict(result)


def lookup(*, doi=None, arxiv=None, title=None, within=None):
    """Like ``lookup_checked``, but an unreachable network reads as "not found"."""
    try:
        return lookup_checked(doi=doi, arxiv=arxiv, title=title, within=within)
    except ScholarUnavailable:
        return None
