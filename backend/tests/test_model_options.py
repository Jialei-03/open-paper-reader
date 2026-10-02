import json

import httpx
import pytest

from backend.model_options import request_options
from backend.platform_model import PLATFORM_ID
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_platform_model import configure_shared
from backend.translation_settings import complete, read_config


def test_shared_choices_and_user_options_are_isolated(env):
    app, a, b, settings = env
    path = configure_shared(settings)
    value = json.loads(path.read_text())
    value["models"] = [
        {
            "id": "platform-minimax-flash",
            "model": "MiniMax-M3.1-Flash-Preview",
            "vision": True,
        }
    ]
    path.write_text(json.dumps(value))
    cfg = a.get("/api/v1/translation-settings").json()
    assert len(cfg["models"]) == 2
    assert "platform-fixture-private-key" not in json.dumps(cfg)
    flash = "platform-minimax-flash"
    url = f"/translation-settings/configs/{flash}/options"
    assert write(a, url, {"thinking_mode": "disabled"}, "PUT").status_code == 422
    response = write(
        a, url, {"thinking_mode": "adaptive", "reasoning_effort": "low"}, "PUT"
    )
    assert response.status_code == 200
    assert response.json()["models"][1]["reasoning_effort"] == "low"
    assert (
        b.get("/api/v1/translation-settings").json()["models"][1]["reasoning_effort"]
        == "default"
    )
    assert (
        write(a, f"/translation-settings/configs/{flash}/select", {}).status_code == 200
    )
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    own = read_config(settings, owner)
    old = read_config(settings, owner, PLATFORM_ID)
    assert own["model"] == "MiniMax-M3.1-Flash-Preview"
    assert own["_platform_limit_dir"] == old["_platform_limit_dir"]
    assert request_options(own)["reasoning_effort"] == "low"
    assert (
        write(a, f"/translation-settings/configs/{flash}", {}, "DELETE").status_code
        == 422
    )
    # New runs capture the user's chosen parameters without exposing credentials.
    session = write(a, "/agent/sessions", {}).json()
    run = write(
        a,
        f"/agent/sessions/{session['id']}/runs",
        {
            "prompt": "hello",
            "model_config_id": flash,
        },
    )
    assert run.status_code == 200
    from backend.models import AgentRun

    with app.state.maker() as db:
        row = db.get(AgentRun, run.json()["id"])
        assert row.runtime["model_options"]["reasoning_effort"] == "low"
    assert (
        write(
            a, url, {"thinking_mode": "adaptive", "reasoning_effort": "high"}, "PUT"
        ).status_code
        == 200
    )
    with app.state.maker() as db:
        assert (
            db.get(AgentRun, run.json()["id"]).runtime["model_options"][
                "reasoning_effort"
            ]
            == "low"
        )

    paper = write(
        a, "/papers", {"title": "Preferences", "external_id": "2504.19413v1"}
    ).json()
    job = write(a, f"/papers/{paper['id']}/translations", {"model_config_id": flash})
    assert job.status_code == 200
    assert job.json()["model"] == "MiniMax-M3.1-Flash-Preview"
    # Translating is a fixed job: it runs at the lowest strength the model
    # allows, not at the "high" the reader chose for conversation.
    assert job.json()["model_options"]["reasoning_effort"] == "low"
    assert (
        write(
            a, url, {"thinking_mode": "adaptive", "reasoning_effort": "max"}, "PUT"
        ).status_code
        == 200
    )
    rows = a.get(f"/api/v1/papers/{paper['id']}/translations").json()
    assert rows[0]["model_options"]["reasoning_effort"] == "low"


@pytest.mark.parametrize(
    "protocol,model,mode,effort,expected",
    [
        (
            "openai",
            "MiniMax-M3",
            "disabled",
            "default",
            {"thinking": {"type": "disabled"}},
        ),
        (
            "openai",
            "MiniMax-M3.1-Flash-Preview",
            "adaptive",
            "high",
            {"thinking": {"type": "adaptive"}, "reasoning_effort": "high"},
        ),
        ("openai", "custom", "default", "low", {"reasoning_effort": "low"}),
        (
            "anthropic",
            "claude",
            "adaptive",
            "high",
            {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}},
        ),
        (
            "anthropic",
            "claude",
            "enabled",
            "default",
            {"thinking": {"type": "enabled", "budget_tokens": 1024}},
        ),
    ],
)
def test_preferences_reach_translation_provider(
    monkeypatch, protocol, model, mode, effort, expected
):
    from backend import translation_settings

    real = httpx.Client

    def reply(request):
        body = json.loads(request.content)
        for key, value in expected.items():
            assert body[key] == value
        return httpx.Response(
            200,
            json=(
                {
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "译文"}],
                }
                if protocol == "anthropic"
                else {
                    "choices": [
                        {"finish_reason": "stop", "message": {"content": "译文"}}
                    ]
                }
            ),
        )

    monkeypatch.setattr(
        translation_settings.httpx,
        "Client",
        lambda **kw: real(transport=httpx.MockTransport(reply)),
    )
    assert (
        complete(
            {
                "base_url": "https://api.minimax.cn/v1",
                "api_key": "fixture",
                "protocol": protocol,
                "model": model,
                "thinking_mode": mode,
                "reasoning_effort": effort,
            },
            "translate",
            "test",
        )
        == "译文"
    )


def test_translation_options_migration_preserves_existing_jobs(tmp_path, monkeypatch):
    import sqlite3

    from alembic import command
    from alembic.config import Config

    db = tmp_path / "old.db"
    with sqlite3.connect(db) as connection:
        connection.execute(
            "CREATE TABLE translation_jobs (id TEXT PRIMARY KEY, model TEXT)"
        )
        connection.execute("INSERT INTO translation_jobs VALUES ('old', 'MiniMax-M3')")
        connection.execute(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"
        )
        connection.execute("INSERT INTO alembic_version VALUES ('0012')")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + str(db))
    monkeypatch.setenv("APP_ENV", "development")
    command.upgrade(Config("alembic.ini"), "0013")
    with sqlite3.connect(db) as connection:
        assert connection.execute(
            "SELECT model, model_options FROM translation_jobs"
        ).fetchone() == ("MiniMax-M3", "{}")
    command.downgrade(Config("alembic.ini"), "0012")
    with sqlite3.connect(db) as connection:
        assert connection.execute("SELECT model FROM translation_jobs").fetchone() == (
            "MiniMax-M3",
        )
