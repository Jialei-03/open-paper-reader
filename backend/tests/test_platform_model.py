import json
import multiprocessing
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.models import User
from backend.platform_model import PLATFORM_ID, model_slot
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.translation_settings import read_config, write_config


def configure_shared(settings):
    path = Path(settings.storage).parent / "platform-model.json"
    path.write_text(
        json.dumps(
            {
                "model": "MiniMax-M3",
                "protocol": "openai",
                "base_url": "https://api.minimax.cn/v1",
                "api_key": "platform-fixture-private-key",
                "vision": True,
                "concurrency_limit": 3,
            }
        )
    )
    return path


def test_open_registration_and_shared_model_privacy(env, monkeypatch):
    app, a, b, settings = env
    configure_shared(settings)
    c = TestClient(app, base_url=settings.origin)
    registration = {"username": "new_reader", "password": "Eight123"}
    assert (
        c.post(
            "/api/v1/auth/register", json={**registration, "password": "Seven12"}
        ).status_code
        == 422
    )
    assert c.post("/api/v1/auth/register", json=registration).status_code == 200
    assert c.post("/api/v1/auth/register", json=registration).status_code == 409
    assert (
        c.post(
            "/api/v1/auth/register", json={**registration, "username": "admin"}
        ).status_code
        == 422
    )
    assert c.post("/api/v1/auth/login", json=registration).status_code == 200
    c.headers["X-CSRF-Token"] = c.cookies["paper_csrf"]
    me = c.get("/api/v1/auth/me").json()["user"]
    with app.state.maker() as d:
        assert not d.get(User, me["id"]).admin
    for client in (a, b, c):
        cfg = client.get("/api/v1/translation-settings").json()
        assert cfg["active_id"] == PLATFORM_ID
        shared = cfg["models"][0]
        assert (
            shared["shared"]
            and shared["badge"] == ""
            and shared["concurrency_limit"] == 3
        )
        assert "platform-fixture-private-key" not in json.dumps(cfg)
        assert "_platform_limit_dir" not in json.dumps(cfg)
    assert c.get("/api/v1/papers").json() == []
    assert (
        c.delete(f"/api/v1/translation-settings/configs/{PLATFORM_ID}").status_code
        >= 400
    )
    assert (
        c.put(
            "/api/v1/translation-settings",
            json={
                "id": PLATFORM_ID,
                "base_url": "https://api.minimax.cn/v1",
                "model": "evil",
                "api_key": "evil",
            },
        ).status_code
        == 422
    )
    # Shared credentials cannot be borrowed by the arbitrary model-list query form.
    assert (
        c.post(
            "/api/v1/translation-settings/models",
            json={"id": PLATFORM_ID, "base_url": "https://api.minimax.cn/v1"},
        ).status_code
        == 422
    )
    session = c.post("/api/v1/agent/sessions", json={}).json()
    run = c.post(
        f"/api/v1/agent/sessions/{session['id']}/runs",
        json={"prompt": "列出我的论文", "model_config_id": PLATFORM_ID},
    ).json()
    assert run["status"] == "queued" and run["model"] == "MiniMax-M3"
    assert b.get(f"/api/v1/agent/sessions/{session['id']}/runs").status_code == 404
    # Existing personal aliases using the same credential share the same semaphore.
    private = write_config(
        settings,
        me["id"],
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3",
            "api_key": "platform-fixture-private-key",
        },
        create=True,
    )
    alias = next(row for row in private["models"] if not row["shared"])
    assert (
        read_config(settings, me["id"], alias["id"])["_platform_limit_dir"]
        == read_config(settings, me["id"], PLATFORM_ID)["_platform_limit_dir"]
    )
    assert (
        c.post(
            f"/api/v1/translation-settings/configs/{PLATFORM_ID}/select", json={}
        ).status_code
        == 200
    )


def occupy(directory, ready):
    with model_slot(
        {"_platform_limit_dir": directory, "_platform_concurrency_limit": 3}
    ):
        ready.put(True)
        time.sleep(30)


def test_three_slots_cross_process_and_crash_releases(tmp_path):
    context = multiprocessing.get_context("spawn")
    ready = context.Queue()
    children = [
        context.Process(target=occupy, args=(str(tmp_path), ready)) for _ in range(3)
    ]
    try:
        for child in children:
            child.start()
        for _ in children:
            assert ready.get(timeout=10)
        import pytest

        with (
            pytest.raises(ValueError, match="等待超时"),
            model_slot(
                {
                    "_platform_limit_dir": str(tmp_path),
                    "_platform_concurrency_limit": 3,
                },
                timeout=0.2,
            ),
        ):
            raise AssertionError("fourth call must wait")
        children[0].terminate()
        children[0].join(timeout=5)
        with model_slot(
            {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3},
            timeout=1,
        ):
            pass
    finally:
        for child in children:
            if child.is_alive():
                child.terminate()
            child.join(timeout=5)
            if child.is_alive():
                child.kill()
                child.join()


def test_translation_calls_share_agent_slots(tmp_path, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from backend import translation_settings as models

    config = {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3}
    guard = threading.Lock()
    active = maximum = 0

    def provider(*args, **kwargs):
        nonlocal active, maximum
        with guard:
            active += 1
            maximum = max(maximum, active)
        time.sleep(0.08)
        with guard:
            active -= 1
        return "translated"

    monkeypatch.setattr(models, "_complete", provider)
    # An Agent owns one slot while multiple translation chunks are dispatched.
    with model_slot(config), ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: models.complete(config, "", ""), range(5)))
    assert results == ["translated"] * 5
    assert maximum == 2


def test_agent_supervisor_starts_all_queued_jobs_by_default(env, monkeypatch):
    import pytest
    from sqlalchemy import select

    from backend import agent_worker, main
    from backend.models import AgentRun, AgentSession

    app, _, _, _ = env
    with app.state.maker() as d:
        for i in range(6):
            user = User(username=f"parallel_{i}", password="unused")
            d.add(user)
            d.flush()
            session = AgentSession(owner=user.id)
            d.add(session)
            d.flush()
            d.add(
                AgentRun(
                    owner=user.id,
                    session_id=session.id,
                    model_config_id=PLATFORM_ID,
                    model="MiniMax-M3",
                    prompt="test",
                )
            )
        d.commit()
    monkeypatch.setattr(main, "create_app", lambda: app)
    launched = []
    monkeypatch.setattr(
        agent_worker.subprocess, "Popen", lambda args, **kw: launched.append(args)
    )

    class StopLoop(Exception):
        pass

    def stop(_):
        raise StopLoop()

    monkeypatch.setattr(agent_worker.time, "sleep", stop)
    with pytest.raises(StopLoop):
        agent_worker.main()
    assert len(launched) == 6
    with app.state.maker() as d:
        states = list(d.scalars(select(AgentRun.status)))
    assert states.count("running") == 6 and states.count("queued") == 0


def test_unlimited_shared_concurrency_reaches_public_config_and_private_alias(
    env, monkeypatch
):
    from contextlib import ExitStack

    _app, a, _b, settings = env
    monkeypatch.setenv("PLATFORM_MODEL_CONCURRENCY", "0")
    configure_shared(settings)
    model = a.get("/api/v1/translation-settings").json()["models"][0]
    assert model["concurrency_limit"] == 0
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    primary = read_config(settings, owner, PLATFORM_ID)
    configured = write_config(
        settings,
        owner,
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3",
            "api_key": "platform-fixture-private-key",
        },
        create=True,
    )
    alias_id = next(row["id"] for row in configured["models"] if not row["shared"])
    alias = read_config(settings, owner, alias_id)
    assert alias["_platform_concurrency_limit"] == 0
    # More than three real nested leases succeed without a queue or timeout.
    with ExitStack() as slots:
        for config in [primary, alias] * 4:
            slots.enter_context(model_slot(config, timeout=0))


def _queued_model_request(config, number, results):
    with model_slot(config, timeout=5):
        results.put(number)
        time.sleep(0.05)


def test_model_waiters_are_fifo_and_dead_waiter_is_removed(tmp_path):
    import multiprocessing

    context = multiprocessing.get_context("spawn")
    config = {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3}
    holders = [model_slot(config) for _ in range(3)]
    for holder in holders:
        holder.__enter__()
    results = context.Queue()
    children = []
    try:
        for number in range(3):
            child = context.Process(
                target=_queued_model_request, args=(config, number, results)
            )
            child.start()
            children.append(child)
            deadline = time.monotonic() + 5
            while len(list(tmp_path.glob("waiter-*.lock"))) < number + 1:
                assert child.is_alive() and time.monotonic() < deadline
                time.sleep(0.01)
        # Simulate a process dying while it is first in the model queue.
        children[0].terminate()
        children[0].join(timeout=5)
        holders.pop().__exit__(None, None, None)
        assert [results.get(timeout=5), results.get(timeout=5)] == [1, 2]
        for child in children[1:]:
            child.join(timeout=5)
            assert child.exitcode == 0
        assert not list(tmp_path.glob("waiter-*.lock"))
    finally:
        for child in children:
            if child.is_alive():
                child.terminate()
            child.join(timeout=5)
        for holder in holders:
            holder.__exit__(None, None, None)
        results.close()


def test_busy_shared_jobs_do_not_hide_ready_private_job(env, tmp_path, monkeypatch):
    from contextlib import ExitStack

    from backend import agent_worker
    from backend.models import AgentRun, AgentSession

    app, _, _, settings = env
    shared = {
        "_platform_limit_dir": str(tmp_path / "slots"),
        "_platform_concurrency_limit": 3,
    }
    with app.state.maker() as d:
        ids = []
        for index in range(3):
            user = User(username=f"admission_{index}", password="unused")
            d.add(user)
            d.flush()
            session = AgentSession(owner=user.id)
            d.add(session)
            d.flush()
            run = AgentRun(
                owner=user.id,
                session_id=session.id,
                model_config_id="shared" if index < 2 else "private",
                model="fixture",
                prompt="test",
            )
            d.add(run)
            d.flush()
            ids.append(run.id)
        d.commit()
    monkeypatch.setattr(
        agent_worker,
        "read_config",
        lambda settings, owner, config_id: shared if config_id == "shared" else {},
    )
    with ExitStack() as slots:
        for _ in range(3):
            slots.enter_context(model_slot(shared))
        with app.state.maker() as d:
            # One shared job must enter the actual model FIFO, not endlessly probe.
            first = agent_worker.ready_job(d, settings)
            assert first.id == ids[0]
            first.status = "running"
            d.commit()
        with app.state.maker() as d:
            assert agent_worker.ready_job(d, settings).id == ids[2]
    with app.state.maker() as d:
        assert agent_worker.ready_job(d, settings).id == ids[1]


def test_missing_concurrency_configuration_allows_twenty_simultaneous_leases(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock

    config = {"_platform_limit_dir": str(tmp_path / "default-slots")}
    simultaneous = Barrier(20, timeout=5)
    guard = Lock()
    active = maximum = 0

    def request(number):
        nonlocal active, maximum
        with model_slot(config, timeout=0):
            with guard:
                active += 1
                maximum = max(maximum, active)
            try:
                # Every lease must coexist, rather than merely finish eventually.
                simultaneous.wait()
                return number
            finally:
                with guard:
                    active -= 1

    with ThreadPoolExecutor(max_workers=20) as pool:
        assert list(pool.map(request, range(20))) == list(range(20))
    assert maximum == 20
    assert active == 0
    assert not (tmp_path / "default-slots").exists()
