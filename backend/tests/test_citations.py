import io
import json
import zipfile

import httpx
import pytest
from fastapi import HTTPException

from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper, write

CARD = {
    "title": "Memory evidence",
    "authors": ["Test Author"],
    "year": 2026,
    "doi": "10.1234/memory",
    "arxiv": "2601.12345",
    "s2_id": "a" * 40,
}


def test_citations_lookup_is_explicit_public_identifier_only_and_paginated(env):
    app, a, b, _ = env
    p = write(
        a, "/papers", {"title": "Source", "external_id": "arxiv:2504.19413v1"}
    ).json()
    calls = []

    def lookup(identifier, relation, offset):
        calls.append((identifier, relation, offset))
        return {
            "items": [CARD],
            "next": 50 if offset == 0 else None,
            "source": "Semantic Scholar",
        }

    app.state.citation_fetcher = lookup
    assert a.get(f"/api/v1/papers/{p['id']}/citations").json()["items"] == []
    assert calls == []
    response = a.get(f"/api/v1/papers/{p['id']}/citations?relation=references")
    assert response.json()["next"] == 50
    assert calls == [("ARXIV:2504.19413", "references", 0)]
    assert (
        a.get(
            f"/api/v1/papers/{p['id']}/citations?relation=citations&offset=50"
        ).json()["next"]
        is None
    )
    assert (
        b.get(f"/api/v1/papers/{p['id']}/citations?relation=references").status_code
        == 404
    )
    missing = write(
        a,
        "/papers",
        {"title": "Private", "external_id": "private project notes 2504.19413"},
    ).json()
    assert (
        a.get(
            f"/api/v1/papers/{missing['id']}/citations?relation=references"
        ).status_code
        == 422
    )


def test_saved_citation_ownership_deduplication_accounting_export_and_delete(env):
    _, a, b, _ = env
    p, other = paper(a), paper(b)
    before = a.get("/api/v1/storage-usage").json()
    response = write(a, f"/papers/{p['id']}/citations", CARD)
    assert response.status_code == 200, response.text
    card = response.json()
    assert (
        write(a, f"/papers/{p['id']}/citations", CARD).json()["saved_id"]
        == card["saved_id"]
    )
    assert len(a.get(f"/api/v1/papers/{p['id']}/citations").json()["items"]) == 1
    assert a.get("/api/v1/storage-usage").json() != before
    assert write(b, f"/papers/{p['id']}/citations", CARD).status_code == 404
    assert (
        b.delete(
            f"/api/v1/papers/{other['id']}/citations/{card['saved_id']}"
        ).status_code
        == 404
    )
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as archive:
        rows = json.loads(archive.read("workspace.json"))["data"]["saved_citations"]
        assert rows[0]["id"] == card["saved_id"]
    assert (
        a.delete(f"/api/v1/papers/{p['id']}/citations/{card['saved_id']}").status_code
        == 200
    )
    assert a.get(f"/api/v1/papers/{p['id']}/citations").json()["items"] == []
    card = write(a, f"/papers/{p['id']}/citations", CARD).json()
    assert (
        a.delete(
            f"/api/v1/papers/{p['id']}",
            headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
        ).status_code
        == 200
    )
    assert a.get(f"/api/v1/papers/{p['id']}/citations").status_code == 404


def test_citation_http_protocol_and_errors_are_not_empty_results(monkeypatch):
    from backend import citations

    original_client = httpx.Client
    requests = []
    payload = {
        "data": [
            {
                "citedPaper": {
                    "title": "Test",
                    "authors": [{"name": "Author"}],
                    "year": 2025,
                    "externalIds": {"DOI": "10.1000/example"},
                    "paperId": "a" * 40,
                }
            }
        ],
        "next": 50,
    }

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(
        citations.httpx,
        "Client",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(respond), **kwargs
        ),
    )
    citations._cache.clear()
    result = citations.fetch_relations("DOI:10.1000/example", "references", 0)
    assert result["items"][0]["title"] == "Test" and result["next"] == 50
    assert requests[0].url.host == "api.semanticscholar.org"
    assert requests[0].url.params["limit"] == "50"
    assert requests[0].url.params["fields"] == "title,authors,year,externalIds,abstract"
    assert citations.fetch_relations("DOI:10.1000/example", "references", 0) == result
    assert len(requests) == 1
    citations._cache.clear()
    payload.clear()
    with pytest.raises(HTTPException) as error:
        citations.fetch_relations("DOI:10.1000/example", "references", 0)
    assert error.value.status_code == 503
    monkeypatch.setattr(
        citations.httpx,
        "Client",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(lambda request: httpx.Response(429)), **kwargs
        ),
    )
    with pytest.raises(HTTPException) as error:
        citations.fetch_relations("DOI:10.1000/example", "citations", 0)
    assert error.value.status_code == 503


def test_citations_survive_backup_restore(env, tmp_path):
    from sqlalchemy import select

    from backend.citations import SavedCitation
    from backend.cli import backup, restore
    from backend.config import Settings, database
    from backend.models import Base

    _, a, _, settings = env
    p = paper(a)
    card = write(a, f"/papers/{p['id']}/citations", CARD).json()
    path = tmp_path / "citations.zip"
    backup(settings, path)
    target = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored"),
        testing=True,
    )
    engine, maker = database(target)
    Base.metadata.create_all(engine)
    restore(target, path)
    with maker() as d:
        assert d.scalar(select(SavedCitation)).id == card["saved_id"]
    engine.dispose()


def test_inline_citation_matches_full_title_without_disclosing_excerpt(env):
    app, a, b, _ = env
    p = write(
        a, "/papers", {"title": "Private title", "external_id": "arxiv:2504.19413"}
    ).json()
    calls = []
    card = {**CARD, "abstract": "Source-provided abstract"}

    def lookup(identifier, relation, offset):
        calls.append((identifier, relation, offset))
        return {
            "items": [card] if offset == 50 else [],
            "next": 50 if offset == 0 else None,
        }

    app.state.citation_fetcher = lookup
    url = f"/api/v1/papers/{p['id']}/citation-preview"
    response = a.get(
        url, params={"excerpt": "Author. Memory\n evidence. Private draft text."}
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["abstract"] == card["abstract"]
    assert calls == [
        ("ARXIV:2504.19413", "references", 0),
        ("ARXIV:2504.19413", "references", 50),
    ]
    assert (
        a.get(url, params={"excerpt": "Memory and other things"}).json()["items"] == []
    )
    assert b.get(url, params={"excerpt": "Memory evidence"}).status_code == 404
    saved = write(a, f"/papers/{p['id']}/citations", card).json()
    assert saved["abstract"] == card["abstract"]
    assert (
        a.get(f"/api/v1/papers/{p['id']}/citations").json()["items"][0]["abstract"]
        == card["abstract"]
    )


S2_ROW = {
    "title": "Attention Is All You Need",
    "authors": [{"name": "Ashish Vaswani"}, {"name": "Noam Shazeer"}],
    "year": 2017,
    "venue": "NeurIPS",
    "abstract": "The dominant sequence transduction models...",
    "citationCount": 100000,
    "referenceCount": 40,
    "externalIds": {"DOI": "10.5555/3295222.3295349", "ArXiv": "1706.03762"},
    "url": "https://www.semanticscholar.org/paper/x",
}


@pytest.fixture
def meta(monkeypatch):
    from backend import citations

    monkeypatch.setattr(citations, "_SPACING", 0)
    citations._meta_cache.clear()
    calls = []
    answers = {}

    def get(url, params=None):
        calls.append((url, params))
        for part, answer in answers.items():
            if part in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        return None

    monkeypatch.setattr(citations, "_get", get)
    return citations, calls, answers


def test_lookup_reads_ids_from_an_entry_and_caches(meta):
    citations, calls, answers = meta
    answers["semanticscholar"] = S2_ROW
    assert citations.references_in(
        "A. Vaswani. Attention. doi:10.5555/3295222.3295349. arXiv:1706.03762v5."
    ) == ("10.5555/3295222.3295349", "1706.03762")
    item = citations.lookup(doi="10.5555/3295222.3295349")
    assert item["title"] == "Attention Is All You Need"
    assert item["authors"] == ["Ashish Vaswani", "Noam Shazeer"]
    assert (item["year"], item["venue"], item["citation_count"]) == (
        2017,
        "NeurIPS",
        100000,
    )
    assert item["reference_count"] == 40 and item["arxiv"] == "1706.03762"
    assert "DOI:10.5555" in calls[0][0]
    citations.lookup(doi="10.5555/3295222.3295349")
    assert len(calls) == 1


def test_lookup_falls_back_to_openalex_then_arxiv_and_reports_outage(meta):
    citations, _, answers = meta
    answers["semanticscholar"] = httpx.ConnectTimeout("slow")
    answers["openalex"] = {
        "title": "Attention Is All You Need",
        "publication_year": 2017,
        "cited_by_count": 9,
        "doi": "https://doi.org/10.48550/arXiv.1706.03762",
        "authorships": [{"author": {"display_name": "A. V."}}],
        "abstract_inverted_index": {"Hello": [0], "world": [1]},
        "primary_location": {"source": {"display_name": "NeurIPS"}},
    }
    item = citations.lookup(arxiv="1706.03762v2")
    assert item["abstract"] == "Hello world" and item["arxiv"] == "1706.03762"
    assert item["venue"] == "NeurIPS" and item["citation_count"] == 9
    citations._meta_cache.clear()
    answers["openalex"] = httpx.ReadTimeout("slow")
    monkey = pytest.MonkeyPatch()
    monkey.setattr(
        citations,
        "_from_arxiv",
        lambda a: {"title": "T", "authors": [], "arxiv": a, "doi": ""},
    )
    try:
        assert citations.lookup(arxiv="1706.03762")["title"] == "T"
        citations._meta_cache.clear()

        def broken(a):
            raise ValueError("down")

        monkey.setattr(citations, "_from_arxiv", broken)
        with pytest.raises(HTTPException) as error:
            citations.lookup(arxiv="1706.03762")
        assert error.value.status_code == 503
    finally:
        monkey.undo()


def test_lookup_by_title_needs_a_plausible_match_and_missing_is_none(meta):
    citations, _, answers = meta
    entry = (
        "Y. LeCun et al. Gradient-based learning applied to document recognition. 1998."
    )
    answers["search/match"] = {
        "data": [{**S2_ROW, "title": "Something unrelated entirely"}]
    }
    answers["openalex"] = {"results": []}
    assert citations.lookup(title=entry) is None
    citations._meta_cache.clear()
    answers["search/match"] = {
        "data": [
            {
                **S2_ROW,
                "title": "Gradient-based learning applied to document recognition",
            }
        ]
    }
    assert citations.lookup(title=entry)["title"].startswith("Gradient-based")


def test_lookup_route_sends_only_public_ids_and_needs_sign_in(env):
    app, a, _, _ = env
    asked = []

    def fake(**kw):
        asked.append(kw)
        return {"title": "X"}

    app.state.citation_lookup = fake
    entry = "A. B. Title of it. arXiv:1706.03762v5, 2017."
    r = a.get("/api/v1/citations/lookup", params={"entry": entry})
    assert r.json() == {"item": {"title": "X"}}
    assert asked == [{"doi": None, "arxiv": "1706.03762", "title": None}]
    a.get("/api/v1/citations/lookup", params={"entry": "Plain Title Words Here 1999"})
    assert asked[1]["title"] == "Plain Title Words Here 1999"
    assert a.get("/api/v1/citations/lookup").status_code == 422
    from fastapi.testclient import TestClient

    assert TestClient(app).get("/api/v1/citations/lookup?doi=10.1/x").status_code in {
        401,
        403,
    }


def test_arxiv_pdf_route_validates_and_streams(env, monkeypatch):
    _, a, _, _ = env
    from backend import arxiv_import

    monkeypatch.setattr(arxiv_import, "download", lambda path, limit: b"%PDF-1.4 x")
    r = a.get("/api/v1/citations/arxiv-pdf", params={"id": "arXiv:1706.03762"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert (
        a.get("/api/v1/citations/arxiv-pdf", params={"id": "http://evil/x"}).status_code
        == 422
    )
    monkeypatch.setattr(arxiv_import, "download", lambda path, limit: b"<html>")
    assert (
        a.get("/api/v1/citations/arxiv-pdf", params={"id": "1706.03762"}).status_code
        == 502
    )
