"""A failed model call says what happened and what to do, in plain words.

Every fault comes from the real fake model server (backend/devtools/fake_model),
through the same ``complete`` the app uses, once as a plain request and once as
a stream; then through the assistant's Node runtime and the automatic guide,
which must end and keep what they had already done.
"""

import json
import os
import re
import subprocess
import time
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from backend import (
    agent_budget,
    agent_worker,
    direct_runs,
    model_errors,
    preparation_worker,
    translation_settings,
)
from backend.devtools.fake_model import FakeModel
from backend.model_errors import MALFORMED, ModelError, from_status, from_transport
from backend.models import AgentRun, PaperPreparation, ReadingArtifact, TranslationJob
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_direct_runs import no_wait as no_wait  # noqa: PLC0414
from backend.tests.test_direct_runs import selection_run, work
from backend.tests.test_paper_preparation import fixture as paper_fixture
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


def test_a_request_timeout_status_is_a_timeout_and_is_still_retried():
    error = from_status(408)
    assert error.code == "timeout"
    assert str(error) == "模型服务返回 HTTP 408：请求超时，请稍后重试"
    assert direct_runs.TRANSIENT.search(str(error))


@pytest.mark.parametrize("status", [400, 402, 405, 409, 413, 422, 451, 301])
def test_other_refusals_stay_bad_requests(status):
    error = from_status(status)
    assert error.code == "bad_request"
    assert f"HTTP {status}" in str(error)


def test_an_unrecognised_answer_does_not_assume_the_openai_protocol():
    assert MALFORMED == "模型服务返回的内容无法识别，请确认地址和接口协议设置正确后重试"
    assert "OpenAI" not in MALFORMED


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


# -- the assistant (the Pi runtime) when the model fails -----------------------

# What a reader is never shown: an exception class name or a stack trace.
INTERNALS = re.compile(
    r"[A-Z][a-z]+(?:Error|Exception)|Traceback|^\s*at ", re.MULTILINE
)


def assert_ended_plainly(run):
    """The run is over, and it says why in words a reader can act on."""
    assert run["status"] == "failed", run
    assert run["error"].strip(), run
    assert INTERNALS.search(run["error"]) is None, run["error"]


@pytest.fixture
def assistant(env, monkeypatch):
    """Ask the assistant to explain a selection: the agent, not a direct call."""
    # How long the runtime waits on a silent model; only the silence test is short.
    monkeypatch.setattr(translation_settings, "MODEL_TIMEOUT_SECONDS", 30)

    def ask(server, model):
        app, a, session, run = selection_run(env, action="explain")
        with app.state.maker() as d:
            assert not (d.get(AgentRun, run["id"]).runtime or {}).get("direct")
        point_at(app, run["id"], server, model, monkeypatch)
        work(app, run["id"])
        return a.get(f"/api/v1/agent/sessions/{session}/runs").json()[0]

    return ask


def test_the_assistant_and_the_backend_say_the_same_thing():
    """The Node runtime words a failure exactly as backend/model_errors does."""
    statuses = [400, 401, 403, 404, 408, 429, 500, 503]
    script = (
        "import * as m from './model-call.mjs';"
        f"console.log(JSON.stringify([{statuses}.map(m.statusMessage),"
        " m.CONNECTION, m.INTERRUPTED, m.MALFORMED, m.STREAM_FAILED,"
        " m.silenceMessage(0.5)]))"
    )
    shown = subprocess.run(
        [os.getenv("AGENT_NODE", "node"), "--input-type=module", "-e", script],
        cwd=Path(agent_worker.ROOT) / "agent-runtime",
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert json.loads(shown) == [
        [str(from_status(status)) for status in statuses],
        model_errors.CONNECTION,
        model_errors.INTERRUPTED,
        model_errors.MALFORMED,
        model_errors.STREAM_FAILED,
        # MODEL_TIMEOUT_SECONDS is 0.5 here (the autouse fixture).
        str(from_transport(httpx.ReadTimeout("silent"))),
    ]


def test_agent_answer_that_drops_ends_failed_and_keeps_what_streamed(assistant):
    reply = "这一段解释说明了所选文字在上下文中的含义。" * 4
    with FakeModel(reply=reply, chunk_size=4) as server:
        done = assistant(server, "fake-drop")
    assert_ended_plainly(done)
    # What the reader watched stream in is still there.
    assert done["response"]
    assert reply.startswith(done["response"])
    assert "中途断开" in done["error"]


def test_agent_server_error_ends_failed(assistant):
    with FakeModel(reply=REPLY) as server:
        done = assistant(server, "fake-500")
    assert_ended_plainly(done)
    assert "HTTP 500" in done["error"]


def test_agent_hang_ends_within_the_budget(assistant, monkeypatch):
    monkeypatch.setattr(agent_budget, "EXECUTION_SECONDS", 3)
    monkeypatch.setattr(agent_budget, "WALL_SECONDS", 6)
    started = time.monotonic()
    # It hangs for longer than the test allows: only the budget can end it.
    with FakeModel(reply=REPLY, hang_seconds=30) as server:
        done = assistant(server, "fake-hang")
    assert time.monotonic() - started < 15
    assert_ended_plainly(done)
    assert "3 秒" in done["error"]
    assert "已完成操作保留" in done["error"]


def test_agent_model_that_says_nothing_times_out(assistant, monkeypatch):
    monkeypatch.setattr(translation_settings, "MODEL_TIMEOUT_SECONDS", 1)
    started = time.monotonic()
    with FakeModel(reply=REPLY, hang_seconds=30) as server:
        done = assistant(server, "fake-hang")
    assert time.monotonic() - started < 15
    assert_ended_plainly(done)
    assert "超过 1 秒没有回应" in done["error"]


# -- the automatic guide (preparation worker) when the model fails -------------

PAGE_PROMPTS = ("Translate each", "You translate one page")
TRANSLATED = {"original": "Hello world.", "translation": "你好世界。", "kind": "text"}
GUIDE = {
    "keywords": ["memory"],
    "summary": ["一", "二", "三"],
    "sections": [
        {"title": t, "body": "正文", "pages": [1]}
        for t in ["研究问题", "方法", "主要结果", "适用边界"]
    ],
}


def prepared(messages):
    """What a good model answers to each kind of preparation request."""
    system = messages[0]["content"]
    if system.startswith("Translate each"):
        return json.dumps(
            {"sentences": [{"id": 0, "kind": "text", "translation": "你好世界。"}]},
            ensure_ascii=False,
        )
    if system.startswith("You translate one page"):
        return json.dumps({"paragraphs": [TRANSLATED]}, ensure_ascii=False)
    return json.dumps(GUIDE, ensure_ascii=False)


def page_request(body):
    return body["messages"][0]["content"].startswith(PAGE_PROMPTS)


@pytest.fixture
def preparation(env, monkeypatch):
    """Prepare a one-page paper against a fake model; return what was kept."""
    app, _a, _b, settings, p, f = paper_fixture(env)
    monkeypatch.setattr(
        preparation_worker, "extract_pdf_pages", lambda *args, **kw: ["Hello world."]
    )
    settings.pdf_layout_image = "test-image"
    maker = app.state.maker

    def prepare(server, model, *, layout_ready=False):
        config = {
            "id": "test",
            "api_key": "test",
            "model": model,
            "base_url": server.base_url,
            "protocol": "openai",
        }
        monkeypatch.setattr(preparation_worker, "read_config", lambda *args: config)
        preparation_worker.reconcile(settings, maker)
        with maker() as d:
            row = d.scalar(select(PaperPreparation))
            row.status = "running"
            identifier = row.id
            if layout_ready:
                # The layout PDF is another worker's job; here it is already done.
                d.add(
                    TranslationJob(
                        arxiv_id="",
                        owner=row.owner,
                        paper_id=p["id"],
                        version_id=p["current_version"],
                        source_file=f["id"],
                        status="completed",
                    )
                )
            d.commit()
        preparation_worker.process(settings, maker, identifier)
        with maker() as d:
            row = d.get(PaperPreparation, identifier)
            pages = [
                a.result
                for a in d.scalars(
                    select(ReadingArtifact).where(
                        ReadingArtifact.kind == "page_translation",
                        ReadingArtifact.status == "completed",
                    )
                )
            ]
            return {
                "status": row.status,
                "stage": row.stage,
                "error": row.error,
                "guide_status": row.guide_status,
                "translation_status": row.translation_status,
                "pages": pages,
            }

    return prepare


def test_preparation_guide_failure_keeps_page_translations(preparation):
    def drop_the_guide(body):
        return None if page_request(body) else "fake-drop"

    with FakeModel(reply=prepared, fault=drop_the_guide) as server:
        done = preparation(server, "fake-ok")
    assert done["status"] == "failed", done
    assert done["stage"] == "准备未完成，已完成内容保留"
    assert "中途断开" in done["error"]
    assert INTERNALS.search(done["error"]) is None, done["error"]
    assert done["guide_status"] == "failed"
    # The page translation done alongside the failed guide is kept.
    assert done["translation_status"] == "completed"
    assert done["pages"] == [{"paragraphs": [TRANSLATED]}]


def test_preparation_rate_limit_is_retried(preparation):
    started = time.monotonic()
    with FakeModel(reply=prepared) as server:
        done = preparation(server, "fake-429x2", layout_ready=True)
        # Two requests were turned away, then the page and the guide answered.
        assert len(server.requests) == 4
    assert done["status"] == "completed", done
    assert done["guide_status"] == "completed"
    assert done["translation_status"] == "completed"
    assert done["error"] == ""
    assert len(done["pages"]) == 1
    assert time.monotonic() - started < 10
