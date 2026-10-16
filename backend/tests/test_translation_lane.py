"""Translating pages is bulk work: it must not queue behind, or block, a conversation."""

import pytest
from sqlalchemy import select

from backend import agent_worker
from backend.models import AgentQuota, AgentRun
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_task_options import FLASH, setup, stop


def translate(a, p, f, page):
    response = write(
        a,
        f"/papers/{p['id']}/reading-artifacts",
        {
            "file_id": f["id"],
            "model_config_id": FLASH,
            "kind": "page_translation",
            "page": page,
        },
    )
    return response


def ask(a, session=None):
    session = session or write(a, "/agent/sessions", {}).json()["id"]
    return write(
        a,
        f"/agent/sessions/{session}/runs",
        {"prompt": "这篇论文讲什么？", "model_config_id": FLASH},
    )


def test_page_translations_run_beside_a_conversation(env):
    _app, a, settings, _owner, p, f = setup(env)
    settings.agent_active_limit = 1
    # A paper being translated does not stop the reader asking a question…
    assert translate(a, p, f, 1).status_code == 200
    first = ask(a)
    assert first.status_code == 200, first.text
    # …but the conversation itself is still one run at a time.
    assert ask(a).status_code == 409


def test_pages_at_once_can_be_limited(env):
    _app, a, settings, _owner, p, f = setup(env)
    settings.translation_active_limit = 3
    for page in (1, 2, 3):
        assert translate(a, p, f, page).status_code == 200
    refused = translate(a, p, f, 4)
    assert refused.status_code == 409
    assert "翻译" in refused.json()["detail"]
    # A page that finished makes room for the next one.
    running = a.get(f"/api/v1/papers/{p['id']}/reading-artifacts").json()
    stop(a, running[0]["run_id"])
    assert translate(a, p, f, 4).status_code == 200


def test_translated_pages_do_not_use_the_daily_allowance_for_conversation(env):
    app, a, settings, owner, p, f = setup(env)
    settings.agent_daily_runs = 100
    for page in (1, 2, 3):
        assert translate(a, p, f, page).status_code == 200
    with app.state.maker() as d:
        quota = d.get(AgentQuota, owner)
        assert quota is None or quota.runs == 0
    assert ask(a).status_code == 200
    with app.state.maker() as d:
        assert d.get(AgentQuota, owner).runs == 1


def test_bulk_translation_leaves_a_worker_for_conversation(env):
    app, a, settings, _owner, p, f = setup(env)
    settings.agent_translation_workers = 2
    ids = [translate(a, p, f, page).json()["run_id"] for page in (1, 2, 3)]
    question = ask(a).json()["id"]
    with app.state.maker() as d:
        for run_id in ids[:2]:
            d.get(AgentRun, run_id).status = "running"
        d.commit()
    with app.state.maker() as d:
        # Two pages are being translated: the third waits so that the reader's
        # question, which arrived later, is not stuck behind a whole paper.
        assert agent_worker.ready_job(d, settings).id == question
    with app.state.maker() as d:
        d.get(AgentRun, question).status = "running"
        d.commit()
    with app.state.maker() as d:
        assert agent_worker.ready_job(d, settings) is None
    with app.state.maker() as d:
        d.get(AgentRun, ids[0]).status = "completed"
        d.commit()
    with app.state.maker() as d:
        # One page finished: translating goes on with the next one.
        assert agent_worker.ready_job(d, settings).id == ids[2]


def test_translations_have_no_execution_concurrency_cap_by_default(env):
    app, a, settings, _owner, p, f = setup(env)
    ids = [translate(a, p, f, page).json()["run_id"] for page in (1, 2, 3, 4)]
    with app.state.maker() as d:
        for run_id in ids[:3]:
            d.get(AgentRun, run_id).status = "running"
        d.commit()
    with app.state.maker() as d:
        assert agent_worker.ready_job(d, settings).id == ids[3]


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_only_unfinished_translations_count_as_active(env, status):
    app, a, settings, _owner, p, f = setup(env)
    settings.translation_active_limit = 3
    for page in (1, 2, 3):
        made = translate(a, p, f, page)
        assert made.status_code == 200
    with app.state.maker() as d:
        for run in d.scalars(select(AgentRun)):
            run.status = status
        d.commit()
    assert translate(a, p, f, 4).status_code == 200


def test_lane_migration_keeps_existing_runs_and_drops_the_one_run_index(
    tmp_path, monkeypatch
):
    import sqlite3

    from alembic import command
    from alembic.config import Config

    db = tmp_path / "old.db"
    with sqlite3.connect(db) as connection:
        connection.execute(
            "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, owner TEXT, status TEXT)"
        )
        connection.execute(
            "CREATE UNIQUE INDEX uq_active_agent_owner ON agent_runs (owner) "
            "WHERE status IN ('queued', 'running')"
        )
        connection.execute("INSERT INTO agent_runs VALUES ('old', 'u', 'running')")
        connection.execute(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"
        )
        connection.execute("INSERT INTO alembic_version VALUES ('0020')")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + str(db))
    monkeypatch.setenv("APP_ENV", "development")
    command.upgrade(Config("alembic.ini"), "0021")
    with sqlite3.connect(db) as connection:
        assert connection.execute("SELECT id, lane FROM agent_runs").fetchall() == [
            ("old", "")
        ]
        # Several tasks at once are allowed: one per user is no longer enforced.
        connection.executemany(
            "INSERT INTO agent_runs (id, owner, status, lane) VALUES (?, 'u', 'queued', ?)",
            [("t1", "translation"), ("t2", "translation"), ("c", "")],
        )
    command.downgrade(Config("alembic.ini"), "0020")
    with sqlite3.connect(db) as connection:
        assert {
            row[1] for row in connection.execute("PRAGMA table_info(agent_runs)")
        } == {"id", "owner", "status"}
        # Back to one active run per owner: the running one stays, the rest stop.
        assert connection.execute(
            "SELECT id, status FROM agent_runs ORDER BY id"
        ).fetchall() == [
            ("c", "cancelled"),
            ("old", "running"),
            ("t1", "cancelled"),
            ("t2", "cancelled"),
        ]
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO agent_runs (id, owner, status) VALUES ('d', 'u', 'queued')"
            )
