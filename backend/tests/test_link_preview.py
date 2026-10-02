import pytest
from fastapi import HTTPException

from backend.link_preview import LinkPreviews
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper


def test_metadata_cache_does_not_execute_html(monkeypatch):
    calls = []

    def fetch(url, limit):
        calls.append(url)
        return (
            b'<title>Fallback</title><meta name="citation_title" content="Memory study"><meta name="citation_author" content="Author"><meta name="description" content="Paper abstract"><script>evil()</script>',
            "text/html",
            url,
        )

    monkeypatch.setattr("backend.link_preview.fetch", fetch)
    preview = LinkPreviews()
    result = preview.get("https://example.org/paper")
    assert result["title"] == "Memory study"
    assert result["description"] == "Paper abstract"
    assert preview.get("https://example.org/paper") == result
    assert len(calls) == 1
    with pytest.raises(HTTPException):
        preview.get("file:///etc/passwd")


def test_preview_ownership_and_network_failures(env, monkeypatch):
    _, alice, bob, _ = env
    p = paper(alice)
    url = f"/api/v1/papers/{p['id']}/link-preview?url=http://127.0.0.1/private"
    assert bob.get(url).status_code == 404
    assert alice.get(url).status_code == 422


def test_upstream_failure_releases_slot(monkeypatch):
    def fail(*_):
        raise OSError("private diagnostic")

    monkeypatch.setattr("backend.link_preview.fetch", fail)
    previews = LinkPreviews()
    for _ in range(3):
        with pytest.raises(HTTPException) as result:
            previews.get("https://example.org/failure")
        assert result.value.status_code == 422
        assert "private" not in result.value.detail
