"""Run-bound controls are durable and use Pi's cooperative control methods."""

import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select

from backend import agent_worker as worker
from backend.models import AgentControl, AgentRun, AgentSession, AgentSessionEntry
from backend.tests.test_acceptance import env  # noqa: F401
from backend.tests.test_agents import configure


def running(env, **runtime):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        session = AgentSession(owner=owner, title="Controls")
        d.add(session)
        d.flush()
        run = AgentRun(
            owner=owner,
            session_id=session.id,
            model_config_id=model,
            model="MiniMax-M3",
            prompt="first question",
            status="running",
            runtime=runtime,
        )
        d.add(run)
        d.commit()
        return session.id, run.id


def control(a, session, run, kind="steer", text="new instruction", client_id=None):
    return a.post(
        f"/api/v1/agent/sessions/{session}/controls",
        json={
            "expected_run_id": run,
            "kind": kind,
            "text": text,
            "client_id": client_id or str(uuid.uuid4()),
        },
    )


def test_control_is_owned_durable_idempotent_and_never_moves_to_the_next_run(env):
    app, a, b, _settings = env
    session, run = running(env)
    client_id = str(uuid.uuid4())
    first = control(a, session, run, client_id=client_id)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "queued"
    assert (
        control(a, session, run, client_id=client_id).json()["id"] == first.json()["id"]
    )
    assert (
        control(a, session, run, text="different", client_id=client_id).status_code
        == 409
    )
    assert control(b, session, run).status_code == 404
    assert b.get(f"/api/v1/agent/sessions/{session}/controls").status_code == 404
    with app.state.maker() as d:
        row = d.get(AgentRun, run)
        row.status = "completed"
        following = AgentRun(
            owner=row.owner,
            session_id=session,
            model_config_id=row.model_config_id,
            model=row.model,
            prompt="next question",
            status="running",
        )
        d.add(following)
        d.commit()
        next_id = following.id
    assert control(a, session, run).status_code == 409
    assert control(a, session, run, client_id=client_id).json()["run_id"] == run
    assert control(a, session, next_id, client_id=client_id).status_code == 409
    with app.state.maker() as d:
        rows = list(d.scalars(select(AgentControl)))
        assert len(rows) == 1 and rows[0].run_id == run


@pytest.mark.parametrize(
    "runtime",
    [
        {"research": {"role": "executor"}},
        {"research": {"role": "scoping"}},
        {"reading_artifact_id": "artifact"},
        {"command": "compact"},
    ],
)
def test_internal_tasks_cannot_receive_generic_steering(env, runtime):
    _app, a, _b, _settings = env
    session, run = running(env, **runtime)
    assert control(a, session, run).status_code == 409
    assert control(a, session, run, kind="follow_up").status_code == 409


def test_abort_waits_for_confirmation_and_prevents_further_input(env):
    app, a, _b, _settings = env
    session, run = running(env)
    result = control(a, session, run, kind="abort", text="")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "queued"
    with app.state.maker() as d:
        row = d.get(AgentRun, run)
        assert row.status == "running" and row.runtime["phase"] == "stopping"
    assert control(a, session, run).status_code == 409
    response = a.get(f"/api/v1/agent/sessions/{session}/controls?run_id={run}")
    assert [row["id"] for row in response.json()] == [result.json()["id"]]


def test_simultaneous_legacy_cancels_are_idempotent(env, monkeypatch):
    from backend import agent_controls

    app, a, _b, _settings = env
    session, run = running(env)
    original = agent_controls.request_abort
    barrier = threading.Barrier(2)

    def together(*args, **kwargs):
        barrier.wait(timeout=5)
        return original(*args, **kwargs)

    monkeypatch.setattr(agent_controls, "request_abort", together)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: a.post(f"/api/v1/agent/runs/{run}/cancel", json={}), range(2)
            )
        )
    assert [response.status_code for response in results] == [200, 200], [
        response.text for response in results
    ]
    with app.state.maker() as d:
        controls = list(
            d.scalars(select(AgentControl).where(AgentControl.run_id == run))
        )
        assert len(controls) == 1 and controls[0].client_id == f"cancel:{run}"
        assert d.get(AgentRun, run).runtime["phase"] == "stopping"


@pytest.mark.parametrize(
    "kind", ["archived_session", "archived_lead", "archived_project_chat", "artifact"]
)
def test_controls_enforce_authoritative_session_capabilities_but_allow_stop(env, kind):
    from backend import research_workspaces
    from backend.models import now

    app, a, _b, _settings = env
    session_id, run = running(env)
    with app.state.maker() as d:
        session = d.get(AgentSession, session_id)
        if kind == "archived_session":
            session.archived_at = now()
        elif kind == "artifact":
            session.kind = "artifact"
        else:
            workspace = research_workspaces.create(
                d, session.owner, "Legacy archived workspace"
            )
            workspace.archived = True
            session.workspace_id = workspace.id
            session.kind = "project_lead" if kind == "archived_lead" else "project_chat"
            if kind == "archived_lead":
                workspace.session_id = session.id
        d.commit()
    assert control(a, session_id, run).status_code == 409
    assert control(a, session_id, run, kind="follow_up").status_code == 409
    result = control(a, session_id, run, kind="abort", text="")
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "queued"


@pytest.fixture
def blocked_model(env, monkeypatch):
    requests, streamed, release = [], threading.Event(), threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            requests.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            number = len(requests)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

            def frame(delta, finish=None):
                value = {
                    "id": "x",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
                self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
                self.wfile.flush()

            try:
                frame(
                    {
                        "content": (
                            "partial response" if number == 1 else "after instruction"
                        )
                    }
                )
                if number == 1:
                    streamed.set()
                    release.wait(8)
                frame({}, "stop")
                self.wfile.write(b"data: [DONE]\n\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

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
    yield requests, streamed, release
    release.set()
    server.shutdown()
    server.server_close()


def wait_for(app, identifier, statuses):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with app.state.maker() as d:
            row = d.get(AgentControl, identifier)
            if row.status in statuses:
                return row
        time.sleep(0.02)
    raise AssertionError("Pi did not acknowledge control")


@pytest.mark.parametrize("kind", ["steer", "follow_up", "abort"])
def test_worker_delivers_native_controls_and_saves_the_confirmed_pi_history(
    env, blocked_model, kind
):
    app, a, _b, _settings = env
    session, run = running(env)
    requests, streamed, release = blocked_model
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(worker.process, app, run)
        assert streamed.wait(5)
        parked = None
        if kind == "abort":
            parked = control(
                a, session, run, kind="follow_up", text="do not run after abort"
            ).json()["id"]
            wait_for(app, parked, {"accepted"})
        result = control(
            a,
            session,
            run,
            kind=kind,
            text="" if kind == "abort" else "change the plan",
        )
        assert result.status_code == 200, result.text
        identifier = result.json()["id"]
        wait_for(app, identifier, {"accepted", "applied"})
        if kind != "abort":
            release.set()
        try:
            task.result(timeout=5)
        finally:
            release.set()
    with app.state.maker() as d:
        row = d.get(AgentRun, run)
        assert row.status == (
            "cancelled" if kind == "abort" else "completed"
        ), row.error
        assert d.get(AgentControl, identifier).status == "applied"
        entries = [
            entry.entry
            for entry in d.scalars(
                select(AgentSessionEntry).where(
                    AgentSessionEntry.session_id == session,
                )
            )
        ]
        saved = json.dumps(entries)
        assert "first question" in saved and "partial response" in saved
        if kind == "abort":
            assert row.runtime["abort_confirmed"] is True
            assert len(requests) == 1
            assert d.get(AgentControl, parked).status == "rejected"
            assert "do not run after abort" not in saved
        else:
            assert "change the plan" in saved and "after instruction" in saved
            assert len(requests) == 2
        messages = row.runtime["conversation_messages"]
        assert [message["role"] for message in messages] == (
            ["assistant"] if kind == "abort" else ["assistant", "user", "assistant"]
        )
        assert messages[0]["text"] == "partial response"


def test_stop_is_received_while_a_host_tool_is_finishing(env, monkeypatch):
    from backend.tests.test_research_worker import ScriptedModel

    app, a, _b, _settings = env
    session, run = running(env)
    model = ScriptedModel([("tool", "list_papers", {})])
    original = worker.read_config
    monkeypatch.setattr(
        worker, "read_config", lambda *args: {**original(*args), "base_url": model.url}
    )
    monkeypatch.setattr(worker, "validate_endpoint", lambda value: value)
    entered, release = threading.Event(), threading.Event()

    async def execute(*args, **kwargs):
        entered.set()
        release.wait(6)
        return {"items": []}

    monkeypatch.setattr(worker, "execute", execute)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            task = pool.submit(worker.process, app, run)
            assert entered.wait(5)
            result = control(a, session, run, kind="abort", text="")
            assert result.status_code == 200, result.text
            wait_for(app, result.json()["id"], {"applied"})
            with app.state.maker() as d:
                assert d.get(AgentRun, run).status == "running"
                assert d.scalar(
                    select(AgentSessionEntry.id).where(
                        AgentSessionEntry.session_id == session
                    )
                )
            release.set()
            task.result(timeout=5)
        with app.state.maker() as d:
            row = d.get(AgentRun, run)
            assert row.status == "cancelled" and row.runtime["abort_confirmed"]
            assert row.steps[0]["status"] == "completed"
        assert len(model.requests) == 1
    finally:
        release.set()
        model.server.shutdown()
        model.server.server_close()


def test_controls_migration_adds_a_durable_table_without_changing_old_runs(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect, text
    from backend.config import Settings, database
    from backend.models import Base

    url = "sqlite:///" + str(tmp_path / "controls.db")
    monkeypatch.setenv("DATABASE_URL", url)
    engine, _maker = database(Settings(database_url=url, testing=True))
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE agent_controls"))
        connection.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        connection.execute(text("INSERT INTO alembic_version VALUES ('0035')"))
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    assert "agent_controls" in inspect(engine).get_table_names()
    command.downgrade(Config(toml_file="pyproject.toml"), "0035")
    assert "agent_controls" not in inspect(engine).get_table_names()
    engine.dispose()
