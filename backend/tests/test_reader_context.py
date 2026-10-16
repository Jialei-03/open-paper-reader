"""Reading evidence is owner-bound and frozen without making a model request."""

import pytest

from backend.agent_state import transition
from backend.models import AgentRun, Paper
from backend.reader_context import ReaderContextInput
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes


def setup_context(env):
    app, a, b, settings = env
    _, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "source.pdf", pdf_bytes())
    session = a.post("/api/v1/agent/sessions", json={}).json()
    return (
        a,
        b,
        p,
        f,
        f"/api/v1/agent/sessions/{session['id']}/runs",
        {
            "prompt": "解释所选文字",
            "model_config_id": model,
            "reader_context": {
                "paper_id": p["id"],
                "file_id": f["id"],
                "version_id": f["version_id"],
                "source": "selection",
                "page": 2,
                "quote": "A selected sentence",
                "prefix": "Prior context",
                "rects": [{"x": 0.1, "y": 0.2, "w": 0.4, "h": 0.02}],
            },
        },
    )


def test_reading_snapshot_owned_file_and_resume(env):
    app, _, _, _ = env
    a, b, p, f, endpoint, payload = setup_context(env)
    other = paper(b)
    other_file = attach(b, other, "private.pdf", pdf_bytes())
    invalid = [
        ({"paper_id": other["id"]}, 404),
        ({"file_id": other_file["id"]}, 404),
        ({"paper_id": paper(a)["id"]}, 422),
        ({"version_id": other["current_version"]}, 422),
        ({"page": 13}, 422),
        ({"file_id": attach(a, p)["id"]}, 422),
    ]
    for update, status in invalid:
        response = a.post(
            endpoint,
            json={**payload, "reader_context": {**payload["reader_context"], **update}},
        )
        assert response.status_code == status, response.text
    response = a.post(endpoint, json=payload)
    assert response.status_code == 200, response.text
    run = response.json()
    frozen = run["runtime"]["reader_context"]
    assert frozen["rects"] == payload["reader_context"]["rects"]
    activity = a.get(f"/api/v1/papers/{p['id']}/reading-activity").json()["items"][0]
    assert activity["rects"] == frozen["rects"]
    assert activity["prefix"] == "Prior context"
    assert frozen["title"] == p["title"]
    assert frozen["file_sha256"] == f["sha256"]
    assert f"file={f['id']}" in frozen["source_url"]
    assert "page=2" in frozen["source_url"]
    with app.state.maker() as d:
        row = d.get(AgentRun, run["id"])
        d.get(Paper, p["id"]).title = "Renamed after selection"
        row.status = "failed"
        row.runtime = transition(row.runtime, "failed")
        d.commit()
    # The original evidence survives a retry even if the caller supplies a new selection.
    resumed = a.post(
        endpoint,
        json={
            **payload,
            "resume_run_id": run["id"],
            "reader_context": {**payload["reader_context"], "page": 3, "quote": "new"},
        },
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["runtime"]["reader_context"] == frozen


@pytest.mark.parametrize(
    "update",
    [
        {"rects": [{"x": 0.9, "y": 0, "w": 0.2, "h": 0.1}]},
        {"rects": [{"x": 0, "y": 0, "w": 1, "h": 0.1}] * 65},
        {"page": 0},
        {"page": True},
        {"page": 1.5},
        {"quote": ""},
        {"quote": "x" * 10001},
        {"title": "client title"},
        {"action": "summarize"},
        {"source": "page", "quote": "text"},
        {"source": "region", "quote": "", "rect": [0, 0, 0, 0.2]},
        {"source": "region", "quote": "", "rect": [0.9, 0, 0.2, 0.2]},
        {"source": "region", "quote": "", "rect": [0, 0, float("nan"), 0.2]},
        {"source": "region", "quote": "", "rect": None},
    ],
)
def test_reader_context_schema_rejects_ambiguous_or_unbounded_selection(update):
    with pytest.raises(ValueError):
        ReaderContextInput.model_validate(
            {
                "paper_id": "a" * 36,
                "file_id": "b" * 36,
                "page": 1,
                "source": "selection",
                "quote": "selected",
                **update,
            }
        )


def test_page_region_and_paper_context_require_no_quote(env):
    app, _, _, _ = env
    a, _, _, _, endpoint, payload = setup_context(env)
    for source in ("page", "paper", "region"):
        context = {
            **payload["reader_context"],
            "source": source,
            "quote": "",
            "prefix": "",
            "rects": [],
        }
        if source == "region":
            context["rect"] = [0.1, 0.2, 0.3, 0.4]
        response = a.post(endpoint, json={**payload, "reader_context": context})
        assert response.status_code == 200, response.text
        frozen = response.json()["runtime"]["reader_context"]
        assert frozen["source"] == source
        if source == "region":
            assert "rect=" in frozen["source_url"]
        with app.state.maker() as d:
            d.get(AgentRun, response.json()["id"]).status = "completed"
            d.commit()


@pytest.mark.parametrize(
    "action", ["ask", "explain", "translate", "formula", "guide", None]
)
def test_reader_context_records_what_the_reader_asked_for(action):
    value = ReaderContextInput.model_validate(
        {
            "paper_id": "a" * 36,
            "file_id": "b" * 36,
            "page": 1,
            "source": "selection",
            "quote": "selected",
            **({"action": action} if action else {}),
        }
    )
    assert value.action == action


def test_whole_paper_discussion_has_no_automatic_page_link(env):
    a, _, _, _, endpoint, payload = setup_context(env)
    payload["reader_context"].update(source="paper", quote="", prefix="", rects=[])
    response = a.post(endpoint, json=payload)
    assert response.status_code == 200
    assert "page=" not in response.json()["runtime"]["reader_context"]["source_url"]
