"""Real PostgreSQL migration, concurrency and continuation gates.

Requires TEST_POSTGRES_URL pointing to a disposable PostgreSQL instance.
Every test owns a random schema; no public tables are read or modified.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.config import Settings
from backend.main import PASSWORD, create_app
from backend.models import AgentQuota, AgentRun, User
from backend.tests import test_agent_checkpoint as recovery
from backend.tests.test_acceptance import PASSWORD_TEXT, paper
from backend.tests.test_agents import configure


@pytest.fixture
def pg_env(tmp_path, monkeypatch):
    value = os.getenv("TEST_POSTGRES_URL")
    if not value:
        pytest.skip("TEST_POSTGRES_URL not configured")
    url = make_url(value)
    assert url.get_backend_name() == "postgresql"
    schema = "paper_test_" + uuid.uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(CreateSchema(schema))
    scoped = url.update_query_dict({"options": "-csearch_path=" + schema})
    settings = Settings(
        database_url=scoped.render_as_string(hide_password=False),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    app = None
    clients = []
    try:
        monkeypatch.setenv("DATABASE_URL", settings.database_url)
        monkeypatch.setenv("APP_ENV", "development")
        command.upgrade(Config(toml_file="pyproject.toml"), "head")
        app = create_app(settings)
        with app.state.engine.connect() as connection:
            assert connection.scalar(text("SELECT current_schema()")) == schema
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == ScriptDirectory.from_config(Config(toml_file="pyproject.toml")).get_current_head()
            )
        with app.state.maker() as d:
            for name in ("alice", "bob"):
                d.add(
                    User(
                        username=name,
                        password=PASSWORD.hash(PASSWORD_TEXT),
                        admin=name == "alice",
                    )
                )
            d.commit()
        for name in ("alice", "bob"):
            client = TestClient(app)
            login = client.post(
                "/api/v1/auth/login", json={"username": name, "password": PASSWORD_TEXT}
            )
            assert login.status_code == 200
            client.headers["X-CSRF-Token"] = login.json()["csrf"]
            clients.append(client)
        yield app, *clients, settings
    finally:
        for client in clients:
            client.close()
        if app:
            app.state.engine.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


def parallel_requests(app, client, path, payloads, method="POST"):
    barrier = Barrier(len(payloads))

    def submit(payload):
        with TestClient(app) as peer:
            peer.cookies.update(client.cookies)
            peer.headers.update({"X-CSRF-Token": client.headers["X-CSRF-Token"]})
            barrier.wait(timeout=10)
            return peer.request(method, path, **payload)

    with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
        return list(pool.map(submit, payloads))


def test_concurrent_enqueue_and_resume_are_single_tasks(pg_env):
    app, a, _, settings = pg_env
    owner, model = configure(app, a, settings)
    # The per-account limits are off by default; this test is about how they hold
    # when requests arrive at the same moment.
    settings.agent_active_limit = 1
    settings.agent_daily_runs = 100
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    path = f"/api/v1/agent/sessions/{session}/runs"
    payload = {"json": {"prompt": "one task", "model_config_id": model}}
    responses = parallel_requests(app, a, path, [payload] * 6)
    assert sorted(r.status_code for r in responses) == [200, 409, 409, 409, 409, 409]
    original = next(r.json() for r in responses if r.status_code == 200)
    assert (
        a.post(f"/api/v1/agent/runs/{original['id']}/cancel", json={}).status_code
        == 200
    )
    resumed = {"json": {**payload["json"], "resume_run_id": original["id"]}}
    responses = parallel_requests(app, a, path, [resumed] * 6)
    assert [r.status_code for r in responses] == [200] * 6
    assert len({r.json()["id"] for r in responses}) == 1
    with app.state.maker() as d:
        assert d.scalar(select(func.count()).select_from(AgentRun)) == 2
        assert d.get(AgentQuota, owner).runs == 2


def test_default_unlimited_tasks_accept_parallel_requests(pg_env):
    app, a, _, settings = pg_env
    owner, model = configure(app, a, settings)
    assert settings.agent_active_limit == 0
    assert settings.agent_daily_runs == 0
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    responses = parallel_requests(
        app, a, f"/api/v1/agent/sessions/{session}/runs",
        [{"json": {"prompt": "parallel task", "model_config_id": model}}] * 6,
    )
    assert [r.status_code for r in responses] == [200] * 6
    assert len({r.json()["id"] for r in responses}) == 6
    with app.state.maker() as d:
        assert d.scalar(select(func.count()).select_from(AgentRun)) == 6
        assert d.get(AgentQuota, owner) is None


def test_concurrent_note_writes_preserve_revision(pg_env):
    app, a, _, _ = pg_env
    p = paper(a)
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])
    payloads = [
        {
            "json": {
                **{k: note[k] for k in ("kind", "title", "paper_id")},
                "body": body,
            },
            "headers": {
                "If-Match": str(note["revision"]),
                "Idempotency-Key": uuid.uuid4().hex,
            },
        }
        for body in ("first edit", "second edit")
    ]
    responses = parallel_requests(
        app, a, "/api/v1/items/" + note["id"], payloads, "PUT"
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    current = a.get("/api/v1/items/" + note["id"]).json()
    assert current["revision"] == note["revision"] + 1
    assert current["body"] == next(
        r.json()["body"] for r in responses if r.status_code == 200
    )


def test_commit_before_checkpoint_failure(pg_env):
    recovery.test_committed_write_survives_missing_tool_receipt_and_resume_is_idempotent(
        pg_env
    )


def test_checkpoint_pagination_and_uncertain_result(pg_env):
    recovery.test_checkpoint_pages_all_steps_and_unknown_write_is_not_replayed(pg_env)


def test_cancelled_worker_must_settle(pg_env):
    recovery.test_cannot_resume_until_cancelled_worker_settles(pg_env)


def test_existing_task_survives_runtime_column_upgrade(pg_env):
    app, a, _, settings = pg_env
    _, model = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    created = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": "Keep this existing task", "model_config_id": model},
    ).json()
    app.state.engine.dispose()
    command.downgrade(Config(toml_file="pyproject.toml"), "0009")
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    rows = a.get(f"/api/v1/agent/sessions/{session}/runs").json()
    assert len(rows) == 1
    assert rows[0]["id"] == created["id"]
    assert rows[0]["prompt"] == created["prompt"]
    assert rows[0]["runtime"]["phase"] == "queued"


def test_busy_model_admission_on_postgres(pg_env, tmp_path, monkeypatch):
    from backend.tests.test_platform_model import (
        test_busy_shared_jobs_do_not_hide_ready_private_job,
    )

    test_busy_shared_jobs_do_not_hide_ready_private_job(pg_env, tmp_path, monkeypatch)


def test_concurrent_uploads_cannot_exceed_owner_budget(pg_env):
    app, a, _, settings = pg_env
    p = paper(a)
    settings.storage_limit = 3
    requests = [
        {
            "data": {"version_id": p["current_version"]},
            "files": {"file": (f"{i}.txt", b"ab")},
            "headers": {"Idempotency-Key": uuid.uuid4().hex},
        }
        for i in range(2)
    ]
    responses = parallel_requests(app, a, f"/api/v1/papers/{p['id']}/files", requests)
    assert sorted(r.status_code for r in responses) == [200, 413]
    assert a.get("/api/v1/storage-usage").json()["used_bytes"] == 2


def test_cleanup_and_new_reference_serialize(pg_env):
    from backend.tests.test_acceptance import write
    from backend.tests.test_storage_files import erase, upload_image

    app, a, _, _ = pg_env
    p = paper(a)
    note = next(
        row for row in a.get("/api/v1/items").json() if row["paper_id"] == p["id"]
    )
    for _ in range(4):
        image = upload_image(a, note)
        gate = Barrier(2)

        def request(remove, gate=gate, image=image):
            with TestClient(app) as client:
                client.cookies.update(a.cookies)
                client.headers["X-CSRF-Token"] = a.headers["X-CSRF-Token"]
                gate.wait(timeout=10)
                if remove:
                    return erase(client, "note_images", image["id"]).status_code
                return write(
                    client,
                    "/items",
                    {
                        "kind": "note",
                        "title": "Race",
                        "body": f"![image]({image['url']})",
                    },
                ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            deleted, saved = list(pool.map(request, (True, False)))
        assert (deleted, saved) in ((200, 422), (409, 200))
        if saved == 200:
            created = next(
                row for row in a.get("/api/v1/items").json() if row["title"] == "Race"
            )
            assert (
                a.delete(
                    "/api/v1/items/" + created["id"],
                    headers={"If-Match": str(created["revision"])},
                ).status_code
                == 200
            )


def test_provider_usage_persists_and_is_private(pg_env):
    from backend.tests.test_model_usage import (
        test_private_usage_unknown_failures_and_no_double_count,
    )

    test_private_usage_unknown_failures_and_no_double_count(pg_env)


def test_model_budget_parallel_admission(pg_env):
    from dataclasses import replace

    from backend import model_usage
    from backend.models import ModelUsage

    app, a, _, settings = pg_env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    settings = replace(settings, shared_daily_tokens=100, model_request_reserve=40)
    gate = Barrier(6)

    def attempt(index):
        gate.wait(timeout=10)
        try:
            return model_usage.start(
                app.state.maker,
                owner,
                "agent" if index % 2 else "translation",
                str(index),
                {"model": "fixture", "shared": True},
                settings,
            )
        except model_usage.ModelBudgetExceeded:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert len([r for r in results if r]) == 2
    with app.state.maker() as d:
        assert (
            d.scalar(
                select(func.sum(ModelUsage.reserved_tokens)).where(
                    ModelUsage.owner == owner
                )
            )
            == 80
        )
        assert (
            model_usage.summary(d, owner, settings)["budgets"][0]["charged_tokens"]
            == 80
        )


def test_translation_cache_publication_guard(pg_env):
    from backend.tests.test_translation_cache import (
        test_completed_cache_requires_age_and_intact_outputs,
    )

    test_completed_cache_requires_age_and_intact_outputs(pg_env)


def test_encrypted_operations_recovery(pg_env, tmp_path, monkeypatch):
    import subprocess

    from backend.tests.test_ops_backup import (
        test_encrypted_recovery_includes_private_config_and_checkpoints,
    )

    identity = tmp_path / "recovery-identity.txt"
    subprocess.run(["age-keygen", "-o", str(identity)], check=True, capture_output=True)
    recipient = subprocess.run(
        ["age-keygen", "-y", str(identity)], check=True, capture_output=True, text=True
    ).stdout.strip()
    test_encrypted_recovery_includes_private_config_and_checkpoints(
        pg_env, tmp_path, monkeypatch, (identity, recipient)
    )


def test_handwriting_roundtrip_on_postgres(pg_env, tmp_path):
    from backend.tests.test_ink import (
        test_ink_isolated_idempotent_validated_and_restored,
    )
    test_ink_isolated_idempotent_validated_and_restored(pg_env, tmp_path)
