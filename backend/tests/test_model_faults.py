"""A failed model call says what happened and what to do, in plain words.

Every fault comes from the real fake model server (backend/devtools/fake_model),
through the same ``complete`` the app uses, once as a plain request and once as
a stream.
"""

import re
import time

import pytest

from backend import agent_worker, direct_runs, translation_settings
from backend.devtools.fake_model import FakeModel
from backend.model_errors import ModelError
from backend.models import AgentRun
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_direct_runs import no_wait as no_wait  # noqa: PLC0414
from backend.tests.test_direct_runs import selection_run, work
from backend.translation_settings import complete

REPLY = "你好，世界。这是一段测试回答。"


@pytest.fixture
def fake():
    with FakeModel(reply=REPLY) as server:
        yield server


@pytest.fixture(autouse=True)
def local_model(monkeypatch):
    monkeypatch.setattr(
        translation_settings, "validate_endpoint", lambda value: value.rstrip("/")
    )
    monkeypatch.setattr(translation_settings, "MODEL_TIMEOUT_SECONDS", 0.5)


def cfg(server, model):
    return {
        "base_url": server.base_url,
        "model": model,
        "api_key": "test",
        "protocol": "openai",
    }


def ask(server, model, streamed, deltas=None):
    deltas = [] if deltas is None else deltas
    if streamed:
        return complete(
            cfg(server, model),
            "s",
            "c",
            cancelled=lambda: False,
            on_delta=deltas.append,
        )
    return complete(cfg(server, model), "s", "c")


@pytest.mark.parametrize("streamed", [False, True])
@pytest.mark.parametrize(
    "model, code, needle",
    [
        ("fake-429", "rate_limited", "HTTP 429"),
        ("fake-500", "server_error", "HTTP 500"),
        ("fake-401", "auth", "HTTP 401"),
        ("fake-404", "not_found", "HTTP 404"),
        ("fake-hang", "timeout", "秒没有回应"),
        ("fake-drop", "interrupted", "中途断开"),
        ("fake-malformed", "malformed", "无法识别"),
        ("fake-length", "truncated", "截断"),
        ("fake-empty", "empty", "空内容"),
    ],
)
def test_each_fault_has_a_code_and_a_plain_reason(fake, streamed, model, code, needle):
    started = time.monotonic()
    with pytest.raises(ModelError) as caught:
        ask(fake, model, streamed)
    error = caught.value
    assert error.code == code
    assert needle in str(error)
    # The reader is never shown an exception class name.
    assert re.search(r"[A-Z][a-z]+(Error|Exception|Timeout)", str(error)) is None
    assert time.monotonic() - started < 3


@pytest.mark.parametrize("streamed", [False, True])
def test_the_timeout_says_how_long_it_waited(fake, streamed):
    with pytest.raises(ModelError) as caught:
        ask(fake, "fake-hang", streamed)
    assert "0.5 秒" in str(caught.value)


def test_a_dropped_stream_has_already_delivered_its_partial_text(fake):
    deltas = []
    with pytest.raises(ModelError) as caught:
        ask(fake, "fake-drop", True, deltas)
    assert caught.value.code == "interrupted"
    assert deltas
    assert REPLY.startswith("".join(deltas))


@pytest.mark.parametrize("streamed", [False, True])
def test_an_unreachable_service_is_a_connection_error(streamed):
    with FakeModel(reply=REPLY) as server:
        pass  # stopped: nothing listens on its port any more
    with pytest.raises(ModelError) as caught:
        ask(server, "fake-ok", streamed)
    assert caught.value.code == "connection"
    assert "连不上" in str(caught.value)


@pytest.mark.parametrize("streamed", [False, True])
def test_a_healthy_model_still_answers(fake, streamed):
    deltas = []
    assert ask(fake, "fake-ok", streamed, deltas) == REPLY
    if streamed:
        assert "".join(deltas) == REPLY
    else:
        assert deltas == []


# -- what a reader sees when translating a selection goes wrong ---------------


def point_at(app, run_id, server, model, monkeypatch):
    """Send the stored model's calls to the fake server, under the fake's name."""
    stored = agent_worker.read_config
    monkeypatch.setattr(
        agent_worker,
        "read_config",
        lambda *args: {**stored(*args), "base_url": server.base_url, "model": model},
    )
    for module in (agent_worker, direct_runs, translation_settings):
        monkeypatch.setattr(
            module, "validate_endpoint", lambda value: value.rstrip("/")
        )
    with app.state.maker() as d:
        d.get(AgentRun, run_id).model = model
        d.commit()


def run_selection(env, server, model, monkeypatch):
    app, a, session, run = selection_run(env)
    point_at(app, run["id"], server, model, monkeypatch)
    work(app, run["id"])
    return a.get(f"/api/v1/agent/sessions/{session}/runs").json()[0]


def test_selection_translation_that_drops_keeps_the_partial_answer(env, monkeypatch):
    # Many small pieces, delivered much faster than the partial answer is saved.
    reply = "这是一段比较长的测试译文，" * 6
    delivered = []
    real = direct_runs.complete

    def watch(config, system, content, *, cancelled=None, on_delta=None):
        return real(
            config,
            system,
            content,
            cancelled=cancelled,
            on_delta=lambda text: (delivered.append(text), on_delta(text))[0],
        )

    monkeypatch.setattr(direct_runs, "complete", watch)
    with FakeModel(reply=reply, chunk_size=4) as server:
        done = run_selection(env, server, "fake-drop", monkeypatch)
    assert done["status"] == "failed"
    assert "中途断开" in done["error"]
    assert len(delivered) > 1
    assert done["response"]
    assert reply.startswith(done["response"])
    # Everything the reader was shown while it streamed is still there.
    assert done["response"] == "".join(delivered)


def test_selection_translation_retries_a_rate_limit_once(env, monkeypatch, no_wait):
    with FakeModel(reply=REPLY) as server:
        done = run_selection(env, server, "fake-429x1", monkeypatch)
        assert len(server.requests) == 2
    assert done["status"] == "completed", done
    assert done["response"] == REPLY


def test_selection_translation_that_hangs_ends(env, monkeypatch, no_wait):
    started = time.monotonic()
    with FakeModel(reply=REPLY) as server:
        done = run_selection(env, server, "fake-hang", monkeypatch)
    assert done["status"] == "failed"
    assert "秒没有回应" in done["error"]
    assert time.monotonic() - started < 10
