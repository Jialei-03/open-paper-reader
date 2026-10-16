from contextlib import ExitStack

import pytest

from backend import agent_budget
from backend.platform_model import model_slot


def test_wait_does_not_consume_execution_and_is_cumulative(tmp_path, monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(agent_budget.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        agent_budget.time, "sleep", lambda n: clock.__setitem__(0, clock[0] + n)
    )
    config = {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3}
    budget = agent_budget.RunBudget(execution=10, waiting=1)
    with ExitStack() as slots:
        for _ in range(3):
            slots.enter_context(model_slot(config, timeout=0))

        def ready():
            if clock[0] >= 0.4:
                slots.close()
            return False

        budget.acquire(config, ready)
    assert budget.remaining() == pytest.approx(10)
    assert budget.waiting == pytest.approx(0.6)
    budget.release()
    clock[0] += 2
    with ExitStack() as slots:
        for _ in range(3):
            slots.enter_context(model_slot(config, timeout=0))
        with pytest.raises(ValueError, match="累计等待超时"):
            budget.acquire(config, lambda: False)
    assert budget.remaining() == pytest.approx(8)
    assert budget.waiting == 0


def test_wait_cancelled_and_slot_reusable(tmp_path):
    config = {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3}
    budget = agent_budget.RunBudget()
    with pytest.raises(ValueError, match="任务已停止"):
        budget.acquire(config, lambda: True)
    budget.acquire(config, lambda: False)
    budget.release()
    budget.release()
    with ExitStack() as slots:
        for _ in range(3):
            slots.enter_context(model_slot(config, timeout=0))


def test_sandbox_lifetime_covers_queue_and_execution():
    from deploy.sandbox_broker import SANDBOX_TTL

    assert SANDBOX_TTL > agent_budget.WALL_SECONDS


def test_cancellation_during_busy_wait(tmp_path, monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(agent_budget.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        agent_budget.time, "sleep", lambda n: clock.__setitem__(0, clock[0] + n)
    )
    config = {"_platform_limit_dir": str(tmp_path), "_platform_concurrency_limit": 3}
    budget = agent_budget.RunBudget(execution=10)
    with ExitStack() as slots:
        for _ in range(3):
            slots.enter_context(model_slot(config, timeout=0))
        with pytest.raises(ValueError, match="任务已停止"):
            budget.acquire(config, lambda: clock[0] >= 0.2)
    assert budget.remaining() == pytest.approx(10)
    assert budget.slot is None
