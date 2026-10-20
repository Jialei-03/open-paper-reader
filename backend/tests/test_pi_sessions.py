"""Conversations are Pi sessions: kept entry by entry, continued, compacted on request."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select

from backend.agent_worker import process
from backend.models import AgentRun, AgentSessionEntry
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure


@pytest.fixture
def model(env, monkeypatch):
    """A local OpenAI-style model that answers each request with its number."""
    import backend.agent_worker as worker

    app, _a, _b, _settings = env
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            chunk = {"id": "x", "object": "chat.completion.chunk", "created": 1}
            for choice in (
                {"delta": {"content": f"第 {len(calls)} 次回答"}, "finish_reason": None},
                {"delta": {}, "finish_reason": "stop"},
            ):
                self.wfile.write(
                    f"data: {json.dumps({**chunk, 'choices': [{'index': 0, **choice}]})}\n\n".encode()
                )
            usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            self.wfile.write(
                f"data: {json.dumps({**chunk, 'choices': [], 'usage': usage})}\n\n".encode()
            )
            self.wfile.write(b"data: [DONE]\n\n")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    original = worker.read_config
    monkeypatch.setattr(
        worker,
        "read_config",
        lambda *args: {
            **original(*args),
            "base_url": f"http://127.0.0.1:{server.server_port}/v1",
        },
    )
    monkeypatch.setattr(worker, "validate_endpoint", lambda value: value)
    yield calls
    server.shutdown()
    server.server_close()


def ask(app, a, session, model_id, prompt, **extra):
    run = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": prompt, "model_config_id": model_id, **extra},
    )
    assert run.status_code == 200, run.text
    with app.state.maker() as d:
        d.get(AgentRun, run.json()["id"]).status = "running"
        d.commit()
    process(app, run.json()["id"])
    return a.get(f"/api/v1/agent/sessions/{session}/runs").json()[-1]


def kept(app, session):
    with app.state.maker() as d:
        return [
            row.entry
            for row in d.scalars(
                select(AgentSessionEntry)
                .where(AgentSessionEntry.session_id == session)
                .order_by(AgentSessionEntry.seq)
            )
        ]


def test_a_conversation_is_kept_as_a_pi_session_and_continued(env, model):
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    first = ask(app, a, session, model_id, "第一个问题")
    assert first["status"] == "completed" and first["response"] == "第 1 次回答"
    entries = kept(app, session)
    roles = [e["message"]["role"] for e in entries if e["type"] == "message"]
    assert roles == ["user", "assistant"]
    assert any(e["type"] == "model_change" for e in entries)
    # How full the context is, for the composer.
    assert first["runtime"]["context"]["contextWindow"] > 0

    second = ask(app, a, session, model_id, "第二个问题")
    assert second["response"] == "第 2 次回答"
    said = json.dumps(model[1]["messages"], ensure_ascii=False)
    assert "第一个问题" in said and "第 1 次回答" in said
    assert len([e for e in kept(app, session) if e["type"] == "message"]) == 4


def test_compact_summarizes_the_conversation_and_it_goes_on_from_there(
    env, model, monkeypatch
):
    from backend import agent_limits

    # Keep almost nothing recent, so even this short conversation has something to summarize.
    monkeypatch.setattr(agent_limits, "COMPACTION", {"keepRecentTokens": 1})
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    # Two exchanges: the earlier one is history Pi summarizes with the instructions
    # (a lone exchange cut midway is only summarized as a turn, without them).
    ask(app, a, session, model_id, "第一个问题")
    ask(app, a, session, model_id, "第二个问题")
    title = a.get("/api/v1/agent/sessions").json()[0]["title"]
    compacted = ask(
        app, a, session, model_id, "/compact 只留结论", command="compact"
    )
    assert compacted["status"] == "completed", compacted["error"]
    assert compacted["runtime"]["command"] == "compact"
    assert compacted["runtime"]["instructions"] == "只留结论"
    assert compacted["runtime"]["compaction"]["reason"] == "manual"
    assert any(e["type"] == "compaction" for e in kept(app, session))
    # Compacting names nothing: the conversation keeps its title.
    assert a.get("/api/v1/agent/sessions").json()[0]["title"] == title
    # The summary request asked the model to keep the conclusions.
    assert "只留结论" in json.dumps(model, ensure_ascii=False)
    after = ask(app, a, session, model_id, "然后呢")
    # The next question goes to the model with the summary in place of the old turns.
    assert "第一个问题" not in json.dumps(model[-1]["messages"][-1], ensure_ascii=False)
    assert after["status"] == "completed"


def test_deleting_a_conversation_deletes_its_session(env, model):
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    ask(app, a, session, model_id, "问题")
    assert kept(app, session)
    assert a.delete(f"/api/v1/agent/sessions/{session}").status_code == 200
    assert kept(app, session) == []


def test_compacting_a_short_conversation_only_says_so(env, model):
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    ask(app, a, session, model_id, "问题")
    done = ask(app, a, session, model_id, "/compact", command="compact")
    assert done["status"] == "completed"
    assert "没有需要压缩" in done["runtime"]["compaction"]["error"]
    assert not any(e["type"] == "compaction" for e in kept(app, session))
