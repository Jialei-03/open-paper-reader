"""Recommendations from the library. Nothing here reaches the network."""

import httpx
import pytest

from backend import recommendations, scholar
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.delenv("SCHOLAR_OFFLINE", raising=False)
    scholar.clear_cache()
    monkeypatch.setattr(scholar, "MIN_GAP", {})

    def blocked(*args, **kwargs):
        raise AssertionError("a test reached for the network")

    monkeypatch.setattr(httpx.Client, "stream", blocked)
    yield
    scholar.clear_cache()


def rec(title, **extra):
    return {
        "title": title,
        "authors": ["A. Writer"],
        "year": 2024,
        "venue": "",
        "abstract": "About " + title,
        "citation_count": 7,
        "doi": "",
        "arxiv": "",
        "url": "",
        **extra,
    }


def library(client):
    seed = write(client, "/papers", {"title": "Seed paper about memory", "external_id": "arxiv:2504.19413"}).json()
    write(client, "/papers", {"title": "No identifier here at all", "external_id": ""})
    return seed


def fetcher(calls, items):
    def fetch(seeds):
        calls.append([ident for _, ident in seeds])
        out = []
        for item in items:
            key = recommendations.primary_key(item)
            out.append({**item, "key": key, "why": [{"paper_id": seeds[0][0].id, "title": seeds[0][0].title}]})
        return out, "Semantic Scholar"

    return fetch


def test_no_identifiable_papers_explains_itself_and_asks_nobody(env):
    app, a, _, _ = env
    write(a, "/papers", {"title": "A scan with no id", "external_id": ""})
    app.state.recommendation_fetcher = lambda seeds: pytest.fail("asked upstream")
    assert a.get("/api/v1/discover/recommendations").json() == {"state": "no_seeds", "items": []}


def test_discovery_survives_string_venue_and_ignores_malformed_titles(env, monkeypatch):
    app, a, _, _ = env
    library(a)
    monkeypatch.setattr(recommendations, "_post", lambda *args: {
        "recommendedPapers": [
            {"title": ["malformed"]},
            {
                "title": "A useful new recommendation",
                "publicationVenue": "NeurIPS",
                "externalIds": {"DOI": "10.1234/recommendation"},
            },
        ]
    })
    app.state.recommendation_fetcher = recommendations.gather
    result = a.get("/api/v1/discover/recommendations")
    assert result.status_code == 200, result.text
    assert result.json()["state"] == "ok"
    assert len(result.json()["items"]) == 1
    assert result.json()["items"][0]["venue"] == "NeurIPS"


def test_recommendations_are_kept_a_day_left_out_when_known_or_dismissed(env):
    app, a, b, _ = env
    seed = library(a)
    write(a, "/papers", {"title": "Already in my library", "external_id": "arxiv:2401.00001"})
    calls = []
    items = [
        rec("Fresh paper on agent memory", arxiv="2402.00002"),
        rec("Already in my library", arxiv="2401.00001"),
        rec("Another by a title only, long enough"),
    ]
    app.state.recommendation_fetcher = fetcher(calls, items)
    first = a.get("/api/v1/discover/recommendations").json()
    assert first["state"] == "ok"
    assert [i["title"] for i in first["items"]] == [
        "Fresh paper on agent memory",
        "Another by a title only, long enough",
    ]
    assert [w["paper_id"] for w in first["items"][0]["why"]] in ([seed["id"]], [first["items"][0]["why"][0]["paper_id"]])
    assert len(first["items"][0]["why"]) == 1
    assert sorted(calls[0]) == ["ARXIV:2401.00001", "ARXIV:2504.19413"]
    # Read again: kept, nobody is asked.
    assert a.get("/api/v1/discover/recommendations").json()["items"] == first["items"]
    assert len(calls) == 1
    # Someone else has their own, which is empty.
    assert b.get("/api/v1/discover/recommendations").json()["state"] == "no_seeds"

    key = first["items"][0]["key"]
    assert key == "arxiv:2402.00002"
    assert a.post("/api/v1/discover/dismissed", json={"key": key, "title": "x"}).status_code == 200
    again = a.get("/api/v1/discover/recommendations?limit=5").json()
    assert [i["key"] for i in again["items"]] == ["title:anotherbyatitleonlylongenough"]
    assert a.delete("/api/v1/discover/dismissed", params={"key": key}).status_code == 200
    assert len(a.get("/api/v1/discover/recommendations").json()["items"]) == 2
    assert a.post("/api/v1/discover/dismissed", json={"key": "nonsense"}).status_code == 422


def test_refresh_on_demand_at_most_once_a_minute(env):
    app, a, _, _ = env
    library(a)
    calls = []
    app.state.recommendation_fetcher = fetcher(calls, [rec("Some fresh paper title", arxiv="2402.00002")])
    a.get("/api/v1/discover/recommendations")
    assert a.get("/api/v1/discover/recommendations?refresh=true").status_code == 429
    with env_clock(recommendations, 120):
        assert a.get("/api/v1/discover/recommendations?refresh=true").status_code == 200
    assert len(calls) == 2


class env_clock:
    """The kept answer looks `seconds` older."""

    def __init__(self, module, seconds):
        self.module, self.seconds = module, seconds

    def __enter__(self):
        import time

        self.real = time.time
        offset = self.seconds
        self.module.time = type("T", (), {"time": staticmethod(lambda: self.real() + offset), "monotonic": staticmethod(time.monotonic)})

    def __exit__(self, *exc):
        import time

        self.module.time = time


def test_offline_and_unreachable_are_told_apart_and_stale_answers_still_serve(env, monkeypatch):
    app, a, _, _ = env
    library(a)
    monkeypatch.setenv("SCHOLAR_OFFLINE", "1")
    assert a.get("/api/v1/discover/recommendations").json()["state"] == "offline"
    monkeypatch.delenv("SCHOLAR_OFFLINE")

    def down(seeds):
        raise scholar.ScholarUnavailable("down")

    app.state.recommendation_fetcher = down
    assert a.get("/api/v1/discover/recommendations").json()["state"] == "unavailable"
    app.state.recommendation_fetcher = fetcher([], [rec("Some fresh paper title", arxiv="2402.00002")])
    assert a.get("/api/v1/discover/recommendations").json()["state"] == "ok"
    app.state.recommendation_fetcher = down
    with env_clock(recommendations, 2 * 24 * 3600):
        stale = a.get("/api/v1/discover/recommendations").json()
    assert stale["state"] == "ok" and stale["stale"] == "unavailable" and len(stale["items"]) == 1


def test_gather_asks_each_seed_and_credits_it_then_falls_back_to_openalex(env, monkeypatch):
    app, a, _, _ = env
    first = write(a, "/papers", {"title": "Seed one", "external_id": "arxiv:2504.19413"}).json()
    second = write(a, "/papers", {"title": "Seed two", "external_id": "doi:10.1234/two"}).json()
    from sqlalchemy import select

    from backend.models import Paper

    with app.state.maker() as d:
        papers = list(d.scalars(select(Paper)))
    seeds = recommendations.seeds_of(papers, {})
    assert {ident for _, ident in seeds} == {"ARXIV:2504.19413", "DOI:10.1234/two"}

    posted = []

    def post(url, params, body):
        posted.append((url, body))
        shared = {"title": "Shared by both seeds", "year": 2023, "externalIds": {"ArXiv": "2301.00001"}, "citationCount": 5, "authors": []}
        own = {"title": "Only for " + body["positivePaperIds"][0], "externalIds": {"DOI": "10.1234/" + body["positivePaperIds"][0][-3:]}}
        return {"recommendedPapers": [shared, own]}

    monkeypatch.setattr(recommendations, "_post", post)
    items, source = recommendations.gather(seeds)
    assert source == "Semantic Scholar"
    assert all(url == recommendations.S2_RECOMMEND and set(body) == {"positivePaperIds"} for url, body in posted)
    assert items[0]["title"] == "Shared by both seeds"
    assert {w["paper_id"] for w in items[0]["why"]} == {first["id"], second["id"]}
    assert all(len(i["why"]) == 1 for i in items[1:])

    def refused(url, params, body):
        raise scholar.ScholarUnavailable("429")

    monkeypatch.setattr(recommendations, "_post", refused)

    def get(url, params=None, accept=""):
        import json

        if params is None:
            return json.dumps({"related_works": ["https://openalex.org/W1"]}).encode()
        return json.dumps({"results": [{"title": "Related by OpenAlex", "publication_year": 2022, "doi": "https://doi.org/10.1234/rel", "cited_by_count": 3}]}).encode()

    monkeypatch.setattr(scholar, "_get", get)
    items, source = recommendations.gather(seeds[:1])
    assert source == "OpenAlex"
    assert items[0]["title"] == "Related by OpenAlex" and items[0]["doi"] == "10.1234/rel"
