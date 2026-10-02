from types import SimpleNamespace

from backend import agent_state


def test_stage_time_accumulates_without_poll_writes(monkeypatch):
    monkeypatch.setattr(agent_state, "now", lambda: "2026-09-27T10:00:00+00:00")
    runtime = agent_state.transition({}, "waiting_model")
    monkeypatch.setattr(agent_state, "now", lambda: "2026-09-27T10:00:20+00:00")
    run = SimpleNamespace(
        runtime=runtime, status="running", updated_at="2026-09-27T10:00:00+00:00"
    )
    assert agent_state.presentation(run)["waiting_seconds"] == 20
    assert "waiting_seconds" not in runtime
    runtime = agent_state.transition(runtime, "model")
    monkeypatch.setattr(agent_state, "now", lambda: "2026-09-27T10:00:25+00:00")
    runtime = agent_state.transition(runtime, "tool")
    assert runtime["execution_seconds"] == 5
    run = SimpleNamespace(
        runtime=runtime, status="cancelled", updated_at="2026-09-27T10:00:28+00:00"
    )
    monkeypatch.setattr(agent_state, "now", lambda: "2026-10-27T10:00:00+00:00")
    result = agent_state.presentation(run)
    assert result["waiting_seconds"] == 20
    assert result["execution_seconds"] == 8
    assert result["phase"] == "cancelled"


def test_historical_runs_do_not_invent_durations():
    run = SimpleNamespace(
        runtime={}, status="completed", updated_at="2026-09-27T10:00:00+00:00"
    )
    assert agent_state.presentation(run) == {"phase": "completed"}


def test_runtime_migration_preserves_existing_runs(tmp_path, monkeypatch):
    import sqlite3

    from alembic import command
    from alembic.config import Config

    db = tmp_path / "old.db"
    with sqlite3.connect(db) as connection:
        connection.execute(
            "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, response TEXT)"
        )
        connection.execute("INSERT INTO agent_runs VALUES ('old', 'existing response')")
        connection.execute(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"
        )
        connection.execute("INSERT INTO alembic_version VALUES ('0009')")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + str(db))
    monkeypatch.setenv("APP_ENV", "development")
    command.upgrade(Config("alembic.ini"), "0012")
    with sqlite3.connect(db) as connection:
        assert connection.execute(
            "SELECT response, runtime FROM agent_runs"
        ).fetchone() == ("existing response", "{}")
    command.downgrade(Config("alembic.ini"), "0009")
    with sqlite3.connect(db) as connection:
        assert connection.execute("SELECT response FROM agent_runs").fetchone() == (
            "existing response",
        )
