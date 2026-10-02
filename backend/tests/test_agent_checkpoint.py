import asyncio

import pytest

from backend.agent_checkpoint import fingerprint, previous_write
from backend.agent_tools import execute
from backend.models import AgentRun
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure


def test_committed_write_survives_missing_tool_receipt_and_resume_is_idempotent(env):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    row = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": "创建论文并写笔记", "model_config_id": model},
    ).json()
    args = {"title": "Committed before interruption"}
    # Actual business commit, followed by a crash before recording the tool result.
    result = asyncio.run(
        execute(app, owner, session, "create_paper", args, f"agent:{row['id']}:1")
    )
    with app.state.maker() as d:
        old = d.get(AgentRun, row["id"])
        old.status = "failed"
        old.steps = [
            {
                "name": "create_paper",
                "status": "running",
                "arguments": args,
                "fingerprint": fingerprint("create_paper", args),
            }
        ]
        d.commit()
    checkpoint = asyncio.run(
        execute(
            app,
            owner,
            session,
            "read_task_checkpoint",
            {"id": row["id"]},
            "read",
            False,
        )
    )
    assert checkpoint["items"][0]["status"] == "committed"
    assert checkpoint["items"][0]["receipt"]["verification"] == "confirmed"
    assert checkpoint["items"][0]["receipt"]["entity_id"] == result["id"]
    reused = previous_write(app, owner, row["id"], "create_paper", args)
    assert reused["already_executed"] and reused["result"]["id"] == result["id"]
    payload = {
        "prompt": "ignored replacement",
        "model_config_id": model,
        "resume_run_id": row["id"],
    }
    child = a.post(f"/api/v1/agent/sessions/{session}/runs", json=payload)
    assert child.status_code == 200
    assert child.json()["prompt"] == row["prompt"]
    assert child.json()["runtime"]["resume_from"] == row["id"]
    again = a.post(f"/api/v1/agent/sessions/{session}/runs", json=payload)
    assert again.json()["id"] == child.json()["id"]
    assert (
        b.post(f"/api/v1/agent/sessions/{session}/runs", json=payload).status_code
        == 404
    )
    other_owner = b.get("/api/v1/auth/me").json()["user"]["id"]
    with pytest.raises(ValueError, match="任务不存在"):
        asyncio.run(
            execute(
                app,
                other_owner,
                session,
                "read_task_checkpoint",
                {"id": row["id"]},
                "read",
                False,
            )
        )
    assert len(a.get("/api/v1/papers").json()) == 1


def test_checkpoint_pages_all_steps_and_unknown_write_is_not_replayed(env):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    row = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": "task", "model_config_id": model},
    ).json()
    with app.state.maker() as d:
        run = d.get(AgentRun, row["id"])
        run.steps = [
            {
                "name": "create_paper",
                "arguments": {"title": str(i)},
                "status": "running",
            }
            for i in range(41)
        ]
        run.status = "failed"
        d.commit()
    ids, offset = [], 0
    while True:
        page = asyncio.run(
            execute(
                app,
                owner,
                session,
                "read_task_checkpoint",
                {"id": row["id"], "offset": offset},
                "read",
                False,
            )
        )
        assert page["total"] == 41
        ids.extend(item["operation_id"] for item in page["items"])
        if not page["has_more"]:
            break
        offset = page["next_offset"]
    assert len(ids) == len(set(ids)) == 41
    with pytest.raises(ValueError, match="结果不确定"):
        previous_write(app, owner, row["id"], "create_paper", {"title": "0"})


def test_cannot_resume_until_cancelled_worker_settles(env):
    app, a, _, settings = env
    _, model = configure(app, a, settings)
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    run = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": "task", "model_config_id": model},
    ).json()
    with app.state.maker() as d:
        row = d.get(AgentRun, run["id"])
        row.status = "cancelled"
        row.runtime = {"since": row.created_at, "phase": "tool"}
        d.commit()
    payload = {"prompt": "task", "model_config_id": model, "resume_run_id": run["id"]}
    assert (
        a.post(f"/api/v1/agent/sessions/{session}/runs", json=payload).status_code
        == 409
    )
    with app.state.maker() as d:
        row = d.get(AgentRun, run["id"])
        row.runtime = {**row.runtime, "settled": True}
        d.commit()
    assert (
        a.post(f"/api/v1/agent/sessions/{session}/runs", json=payload).status_code
        == 200
    )
