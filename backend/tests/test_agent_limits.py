"""A user's agent tasks are not limited for now; each limit can be switched back on."""

from backend.models import AgentQuota, AgentRun
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_agents import configure


def ask(a, model, session=None):
    session = session or write(a, "/agent/sessions", {}).json()["id"]
    return write(
        a,
        f"/agent/sessions/{session}/runs",
        {"prompt": "hello", "model_config_id": model},
    )


def test_tasks_are_not_limited_by_default(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    # Several at once, in one session or several: all are accepted and queued.
    session = write(a, "/agent/sessions", {}).json()["id"]
    for _ in range(4):
        assert ask(a, model, session).status_code == 200
    with app.state.maker() as d:
        # No allowance is counted while there is no daily limit.
        assert d.get(AgentQuota, owner) is None
        queued = d.query(AgentRun).filter(AgentRun.status == "queued").count()
    assert queued == 4


def test_one_active_task_per_user_can_be_switched_back_on(env):
    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    settings.agent_active_limit = 1
    first = ask(a, model)
    assert first.status_code == 200
    second = ask(a, model)
    assert second.status_code == 409
    assert "你已有一个 Agent 任务" in second.json()["detail"]
    settings.agent_active_limit = 2
    assert ask(a, model).status_code == 200
    assert ask(a, model).status_code == 409


def test_a_daily_allowance_can_be_switched_back_on(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    settings.agent_daily_runs = 2
    for _ in range(2):
        made = ask(a, model)
        assert made.status_code == 200
        assert (
            write(a, f"/agent/runs/{made.json()['id']}/cancel", {}).status_code == 200
        )
    limited = ask(a, model)
    assert limited.status_code == 429
    assert "每日 2 次" in limited.json()["detail"]
    with app.state.maker() as d:
        assert d.get(AgentQuota, owner).runs == 2


def test_the_site_wide_queue_limit_is_high_but_still_there(env):
    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    assert settings.agent_queue_limit >= 500
    settings.agent_queue_limit = 2
    assert ask(a, model).status_code == 200
    assert ask(a, model).status_code == 200
    limited = ask(a, model)
    assert limited.status_code == 429
    assert "队列已满" in limited.json()["detail"]


def test_limits_come_from_the_environment(monkeypatch):
    from backend.config import Settings

    monkeypatch.delenv("APP_ENV", raising=False)
    defaults = Settings.env()
    assert (defaults.agent_active_limit, defaults.agent_daily_runs) == (0, 0)
    assert defaults.translation_active_limit == 0
    assert defaults.agent_worker_concurrency == 0
    assert defaults.agent_translation_workers == 0
    monkeypatch.setenv("AGENT_ACTIVE_LIMIT", "1")
    monkeypatch.setenv("AGENT_DAILY_RUNS", "100")
    monkeypatch.setenv("AGENT_QUEUE_LIMIT", "32")
    monkeypatch.setenv("AGENT_TRANSLATION_ACTIVE", "3")
    monkeypatch.setenv("AGENT_WORKER_CONCURRENCY", "5")
    monkeypatch.setenv("AGENT_TRANSLATION_WORKERS", "4")
    limited = Settings.env()
    assert limited.agent_active_limit == 1
    assert limited.agent_daily_runs == 100
    assert limited.agent_queue_limit == 32
    assert limited.translation_active_limit == 3
    assert limited.agent_worker_concurrency == 5
    assert limited.agent_translation_workers == 4
