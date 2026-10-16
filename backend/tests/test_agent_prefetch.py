"""The first explanation receives owned PDF evidence, without trusting the quote."""

import json

import pytest

from backend import agent_prefetch
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes


def test_prefetch_reads_owned_page_and_never_echoes_unverified_quote(env):
    app, a, b, settings = env
    owner, _ = configure(app, a, settings)
    f = attach(a, paper(a), "selection.pdf", pdf_bytes())
    snapshot = {
        "source": "selection",
        "action": "explain",
        "file_id": f["id"],
        "page": 7,
        "quote": "UNVERIFIED QUOTE WITH MADE UP RESULTS",
    }
    text = agent_prefetch.selection_context(app, owner, "session", "run", snapshot)
    assert "Evidence on page 7" in text
    assert f["id"] in text
    assert "UNVERIFIED" not in text
    assert '"page": 7' in text
    assert '"truncated": false' in text
    other = b.get("/api/v1/auth/me").json()["user"]["id"]
    assert (
        agent_prefetch.selection_context(app, other, "session", "run", snapshot) == ""
    )
    assert (
        agent_prefetch.selection_context(
            app, owner, "session", "run", {**snapshot, "page": 500}
        )
        == ""
    )


@pytest.mark.parametrize("action", ["explain", "formula"])
def test_prefetch_bounds_text_and_records_only_delivered_evidence(monkeypatch, action):
    async def execute(*args):
        assert args[3] == "read_file"
        assert args[4] == {"id": "file", "page": 2, "pages": 1}
        assert args[6] is False
        return {"file_id": "file", "pages": [{"page": 2, "text": "a" * 17000}]}

    delivered = []
    monkeypatch.setattr(agent_prefetch, "execute", execute)
    monkeypatch.setattr(
        agent_prefetch,
        "record_reading_evidence",
        lambda *args: delivered.append(args[-1]),
    )
    text = agent_prefetch.selection_context(
        None,
        "owner",
        "session",
        "run",
        {"source": "selection", "action": action, "file_id": "file", "page": 2},
    )
    assert len(delivered[0]["pages"][0]["text"]) == 16000
    assert delivered[0]["pages"][0]["truncated"] is True
    assert json.dumps(delivered[0], ensure_ascii=False) in text


@pytest.mark.parametrize(
    "snapshot",
    [
        None,
        {"source": "selection", "action": "translate"},
        {"source": "selection", "action": "ask"},
        {"source": "region", "action": "explain"},
    ],
)
def test_other_tasks_do_not_prefetch(monkeypatch, snapshot):
    async def unexpected(*args):
        pytest.fail("unrelated task must not read a page")

    monkeypatch.setattr(agent_prefetch, "execute", unexpected)
    assert (
        agent_prefetch.selection_context(None, "owner", "session", "run", snapshot)
        == ""
    )


@pytest.mark.parametrize(
    "result",
    [
        {"file_id": "another", "pages": []},
        {"file_id": "file", "pages": [{"page": 2, "text": ""}]},
        {"file_id": "file", "pages": [{"page": 3, "text": "wrong page"}]},
    ],
)
def test_missing_or_mismatched_evidence_falls_back(monkeypatch, result):
    async def execute(*args):
        return result

    monkeypatch.setattr(agent_prefetch, "execute", execute)
    assert (
        agent_prefetch.selection_context(
            None,
            "owner",
            "session",
            "run",
            {"source": "selection", "action": "formula", "file_id": "file", "page": 2},
        )
        == ""
    )


def test_failure_falls_back_without_leaking_internal_error(monkeypatch):
    async def execute(*args):
        raise RuntimeError("sensitive internal failure")

    monkeypatch.setattr(agent_prefetch, "execute", execute)
    assert (
        agent_prefetch.selection_context(
            None,
            "owner",
            "session",
            "run",
            {"source": "selection", "action": "explain", "file_id": "file", "page": 2},
        )
        == ""
    )
