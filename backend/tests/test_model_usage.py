import pytest
from sqlalchemy import select

from backend import model_usage as usage
from backend.models import ModelUsage, User
from backend.tests.test_acceptance import env as env  # noqa: PLC0414


@pytest.mark.parametrize(
    "protocol,value,total",
    [
        (
            "openai",
            {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "prompt_tokens_details": {"cached_tokens": 40},
            },
            120,
        ),
        (
            "anthropic",
            {
                "input_tokens": 100,
                "output_tokens": 20,
                "cache_read_input_tokens": 40,
                "cache_creation_input_tokens": 10,
            },
            170,
        ),
        ("pi", {"input": 100, "output": 20, "cacheRead": 40, "cacheWrite": 10}, 170),
        ("pi", {"input": 0, "output": 0}, None),
        ("openai", {}, None),
        ("openai", {"prompt_tokens": False, "completion_tokens": 20}, None),
        (
            "openai",
            {"prompt_tokens": 10, "completion_tokens": 20, "prompt_tokens_details": 42},
            None,
        ),
    ],
)
def test_provider_usage_normalization(protocol, value, total):
    result = usage.normalize(value, protocol)
    assert (result["total_tokens"] if result else None) == total


def test_private_usage_unknown_failures_and_no_double_count(env):
    app, a, b, _ = env
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    config = {"model": "test-model"}
    identifier = usage.start(app.state.maker, owner, "translation", "test-task", config)
    for _ in range(2):
        usage.finish(
            app.state.maker,
            identifier,
            {"prompt_tokens": 30, "completion_tokens": 20},
            "openai",
        )
    # Later validation failure changes status but preserves the returned usage.
    usage.finish(app.state.maker, identifier, None, "openai", "failed")
    usage.start(app.state.maker, owner, "agent", "interrupted", config)
    report = a.get("/api/v1/model-usage").json()
    assert report["total_tokens"] == 50
    assert report["requests"] == 2 and report["unknown_requests"] == 1
    assert b.get("/api/v1/model-usage").json()["requests"] == 0
    with app.state.maker() as d:
        assert d.get(ModelUsage, identifier).status == "failed"


@pytest.mark.parametrize(
    "protocol,value",
    [
        ("openai", {"prompt_tokens": 20, "completion_tokens": 10}),
        ("anthropic", {"input_tokens": 20, "output_tokens": 10}),
    ],
)
def test_translation_records_actual_response_before_validation(
    env, monkeypatch, protocol, value
):
    import httpx

    from backend import translation_settings as translation

    app, a, _, _ = env
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    cfg = {
        "model": "fixture",
        "base_url": "https://api.minimax.cn/v1",
        "api_key": "fixture",
        "protocol": protocol,
    }
    cfg["_usage_start"] = lambda: usage.start(
        app.state.maker, owner, "translation", "task", cfg
    )
    cfg["_usage_finish"] = lambda id, value, status: usage.finish(
        app.state.maker, id, value, protocol, status
    )
    real = httpx.Client
    body = {
        "usage": value,
        "stop_reason": "max_tokens",
        "content": [{"type": "text", "text": "partial"}],
        "choices": [{"finish_reason": "length", "message": {"content": "partial"}}],
    }
    monkeypatch.setattr(
        translation.httpx,
        "Client",
        lambda **kw: real(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=body)
            )
        ),
    )
    with pytest.raises(ValueError, match="截断"):
        translation.complete(cfg, "translate", "paper")
    report = a.get("/api/v1/model-usage").json()
    assert report["total_tokens"] == 30 and report["unknown_requests"] == 0


def test_usage_backup_roundtrip_and_previous_schema(env, tmp_path):
    import json
    import zipfile

    from backend.cli import backup, restore
    from backend.config import Settings, database
    from backend.models import Base

    app, _, _, settings = env
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    identifier = usage.start(
        app.state.maker, owner, "agent", "task", {"model": "fixture"}
    )
    usage.finish(app.state.maker, identifier, {"input": 10, "output": 20}, "pi")
    path = tmp_path / "backup.zip"
    backup(settings, path)
    for legacy in (False, 7, 8, 15):
        source = path
        if legacy:
            source = tmp_path / "legacy.zip"
            with (
                zipfile.ZipFile(path) as original,
                zipfile.ZipFile(source, "w") as target,
            ):
                payload = json.loads(original.read("backup.json"))
                payload["schema_version"] = legacy
                if legacy == 7:
                    payload["data"].pop("model_usage")
                elif legacy == 8:
                    for row in payload["data"]["model_usage"]:
                        row.pop("reserved_tokens")
                if legacy == 15:
                    for table in (
                        "preparation_settings",
                        "paper_preparations",
                        "translation_memory",
                    ):
                        payload["data"].pop(table)
                    for job in payload["data"]["translation_jobs"]:
                        job.pop("preparation_id")
                target.writestr("backup.json", json.dumps(payload))
        target_settings = Settings(
            database_url=f"sqlite:///{tmp_path}/restored-{legacy}.db",
            storage=str(tmp_path / f"files-{legacy}"),
            testing=True,
        )
        engine, maker = database(target_settings)
        Base.metadata.create_all(engine)
        assert restore(target_settings, source)["model_usage"] == (
            0 if legacy == 7 else 1
        )
        with maker() as d:
            assert usage.summary(d, owner)["total_tokens"] == (0 if legacy == 7 else 30)
        engine.dispose()


@pytest.mark.parametrize(
    "protocol,model,field,limit",
    [
        ("openai", "MiniMax-M3", "max_completion_tokens", 32768),
        ("openai", "other-model", "max_tokens", 8192),
        ("anthropic", "MiniMax-M3", "max_tokens", 32768),
        ("anthropic", "other-model", "max_tokens", 8192),
    ],
)
def test_translation_output_is_bounded(monkeypatch, protocol, model, field, limit):
    import json

    import httpx

    from backend import translation_settings as translation

    real = httpx.Client

    def reply(request):
        payload = json.loads(request.content)
        assert payload[field] == limit
        assert not ({"max_tokens", "max_completion_tokens"} - {field}) & payload.keys()
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "中文"}],
                "choices": [{"message": {"content": "中文"}}],
            },
        )

    monkeypatch.setattr(
        translation.httpx,
        "Client",
        lambda **kw: real(transport=httpx.MockTransport(reply)),
    )
    assert (
        translation.complete(
            {
                "base_url": "https://api.minimax.cn/v1",
                "api_key": "fixture",
                "model": model,
                "protocol": protocol,
            },
            "translate",
            "paper",
        )
        == "中文"
    )


def test_budget_reservation_settlement_unknown_and_separate_pools(env):
    from dataclasses import replace

    app, _a, _, settings = env
    settings = replace(
        settings,
        shared_daily_tokens=100,
        private_daily_tokens=50,
        model_request_reserve=40,
    )
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    shared = {"model": "fixture", "_platform_limit_dir": "shared-alias"}
    first = usage.start(app.state.maker, owner, "agent", "one", shared, settings)
    second = usage.start(app.state.maker, owner, "translation", "two", shared, settings)
    with pytest.raises(usage.ModelBudgetExceeded):
        usage.start(app.state.maker, owner, "agent", "denied", shared, settings)
    usage.finish(app.state.maker, first, {"input": 10, "output": 5}, "pi")
    third = usage.start(app.state.maker, owner, "agent", "three", shared, settings)
    usage.finish(app.state.maker, second, None, "pi", "failed")
    with pytest.raises(usage.ModelBudgetExceeded):
        usage.start(app.state.maker, owner, "agent", "denied-again", shared, settings)
    # A private key has its own pool; an unknown failure does not release reserve.
    usage.start(
        app.state.maker, owner, "agent", "private", {"model": "private"}, settings
    )
    with pytest.raises(usage.ModelBudgetExceeded):
        usage.start(
            app.state.maker, owner, "agent", "private-2", {"model": "private"}, settings
        )
    # Actual usage may exceed the configured allowance: debit actual, never truncate it.
    usage.finish(app.state.maker, third, {"input": 80, "output": 20}, "pi")
    with app.state.maker() as d:
        state = usage.summary(d, owner, settings)
        assert state["budgets"][0]["charged_tokens"] == 155
        assert state["budgets"][0]["remaining_tokens"] == 0
        assert state["budgets"][0]["over_reservation_requests"] == 1
        assert state["budgets"][1]["charged_tokens"] == 40
        assert state["requests"] == 4
        d.get(ModelUsage, second).created_at = "2000-01-01T00:00:00+00:00"
        d.commit()
        assert usage.summary(d, owner, settings)["budgets"][0]["charged_tokens"] == 115


def test_translation_budget_denies_before_network(env, monkeypatch):
    from dataclasses import replace

    from backend import translation_settings as translation

    app, _, _, settings = env
    settings = replace(settings, shared_daily_tokens=10, model_request_reserve=20)
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    cfg = {"model": "fixture", "shared": True}
    cfg["_usage_start"] = lambda: usage.start(
        app.state.maker, owner, "translation", "job", cfg, settings
    )

    def forbidden(*args, **kwargs):
        pytest.fail("Budget rejection must happen before network access")

    monkeypatch.setattr(translation, "_complete", forbidden)
    with pytest.raises(usage.ModelBudgetExceeded):
        translation.complete(cfg, "translate", "content")


@pytest.mark.parametrize(
    "suffix", ["/test", "/configs/{model}/test", "/configs/{model}/vision-test"]
)
def test_model_probes_cannot_bypass_budget(env, monkeypatch, suffix):
    from backend import translation_settings
    from backend.tests.test_agents import configure

    app, a, _, settings = env
    _, model = configure(app, a, settings)
    settings.private_daily_tokens = 1

    def forbidden(*args, **kwargs):
        pytest.fail("Probe must be rejected before contacting the provider")

    monkeypatch.setattr(translation_settings, "_complete", forbidden)
    response = a.post(
        "/api/v1/translation-settings" + suffix.format(model=model), json={}
    )
    assert response.status_code == 429, response.text
    assert a.get("/api/v1/model-usage").json()["requests"] == 0


@pytest.mark.parametrize(
    "name,value",
    [
        ("SHARED_MODEL_DAILY_TOKENS", "-1"),
        ("PRIVATE_MODEL_DAILY_TOKENS", "-2"),
        ("MODEL_REQUEST_RESERVE_TOKENS", "0"),
    ],
)
def test_invalid_budget_config_fails_closed(monkeypatch, name, value):
    from backend.config import Settings

    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        Settings.env()
