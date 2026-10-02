import pytest
from fastapi import HTTPException

from backend import quick_translation
from backend.tests.test_acceptance import attach, paper, write
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_figure_catalog import fixture_pdf


def test_quick_translation_owned_selection_cache_failure(env, monkeypatch):
    _, alice, bob, _ = env
    calls = []

    def translate(text, language):
        calls.append((text, language))
        if text == "fail":
            raise ValueError("bad provider payload")
        return "译文：" + text

    monkeypatch.setattr(quick_translation, "google_translate", translate)
    p = paper(alice)
    f = attach(alice, p, name="source.pdf", data=fixture_pdf())
    url = f"/files/{f['id']}/quick-translation"
    body = {"page": 1, "text": "Memory retrieval"}
    assert write(bob, url, body).status_code == 404
    assert calls == []
    assert write(alice, url, {**body, "page": 2}).status_code == 422
    for _ in range(2):
        response = write(alice, url, body)
        assert response.status_code == 200, response.text
        assert response.json() == {
            "text": "译文：Memory retrieval",
            "provider": "Google",
            "page": 1,
        }
    assert calls == [("Memory retrieval", "zh")]
    assert write(alice, url, {**body, "language": "ja"}).status_code == 200
    assert write(alice, url, {**body, "language": "ja"}).status_code == 200
    assert calls == [("Memory retrieval", "zh"), ("Memory retrieval", "ja")]
    assert write(alice, url, {**body, "language": "invalid"}).status_code == 422
    assert write(alice, url, {**body, "text": "fail"}).status_code == 503
    assert write(alice, url, {**body, "text": " "}).status_code == 422
    assert write(alice, url, {**body, "text": "x" * 5001}).status_code == 422


def test_quick_translation_bounds_requests_without_spending_model_budget(monkeypatch):
    monkeypatch.setattr(quick_translation, "google_translate", lambda text, language: text)
    provider = quick_translation.QuickTranslator()
    for i in range(20):
        assert provider.translate("owner", str(i)) == str(i)
    assert provider.translate("owner", "0") == "0"
    with pytest.raises(HTTPException) as caught:
        provider.translate("owner", "another")
    assert caught.value.status_code == 429
    assert provider.translate("other", "another") == "another"
