"""Schedules are local, owner-scoped message deliveries, never experiment approval."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import importlib

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select

from backend import research_map, research_schedules, research_worker
from backend.models import (
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchProject,
    ResearchSchedule,
    ResearchScheduleRun,
    ResearchWorkspace,
)
from backend.tests.test_acceptance import bearer, env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure

BASE = "/api/v1/research/schedules"


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


@pytest.fixture
def setup(env):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = ResearchWorkspace(
            owner=owner, name="Project", model_config_id=model
        )
        d.add(workspace)
        d.commit()
        return owner, model, workspace.id


def create(env, setup, **extra):
    response = env[1].post(
        BASE,
        json={
            "title": "Daily papers",
            "prompt": "Find today's relevant papers",
            "workspace_id": setup[2],
            "timezone": "Asia/Singapore",
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def due(app, item, at="2026-10-20T01:00:00+00:00"):
    with app.state.maker() as d:
        d.get(ResearchSchedule, item["id"]).next_run_at = research_schedules.stamp(
            datetime.fromisoformat(at)
        )
        d.commit()


def existing(app, setup, *, status="active", stage="scoping"):
    owner, model, wid = setup
    with app.state.maker() as d:
        project = research_map.create_project(d, owner, "Existing question", "", model)
        project.workspace_id = wid
        project.status, project.stage = status, stage
        d.get(AgentSession, project.session_id).workspace_id = wid
        d.commit()
        return project.id


def test_due_creates_scoping_conversation_once_and_preserves_prompt(env, setup):
    app, a, _, settings = env
    item = create(env, setup)
    due(app, item)
    before = datetime.fromisoformat("2026-10-20T00:59:59+00:00")
    research_schedules.tick(settings, app.state.maker, before)
    assert a.get(f"{BASE}/{item['id']}").json()["runs"] == []
    at = datetime.fromisoformat("2026-10-20T01:00:00+00:00")
    research_schedules.tick(settings, app.state.maker, at)
    research_schedules.tick(settings, app.state.maker, at)
    detail = a.get(f"{BASE}/{item['id']}").json()
    assert detail["next_run_at"] == "2026-10-21T01:00:00.000000+00:00"
    [run] = detail["runs"]
    assert run["status"] == "succeeded" and run["trigger"] == "scheduled"
    assert run["conversation_url"] == "#research/" + run["research_id"]
    with app.state.maker() as d:
        project = d.get(ResearchProject, run["research_id"])
        assert project.stage == "scoping" and project.status == "active"
        assert project.title == item["title"] and project.workspace_id == setup[2]
        assert project.spawned_by == "schedule"
        messages = list(
            d.scalars(
                select(ResearchEvent).where(
                    ResearchEvent.project_id == project.id,
                    ResearchEvent.action == "message",
                )
            )
        )
        assert [e.detail["text"] for e in messages] == [item["prompt"]]
        assert d.scalar(select(func.count(AgentRun.id))) == 0


def test_sleep_catches_up_only_once_and_keeps_interval_phase(env, setup):
    app, a, _, settings = env
    item = create(env, setup, frequency="interval", interval_hours=4)
    due(app, item, "2026-10-20T01:00:00+00:00")
    at = datetime.fromisoformat("2026-10-23T08:30:00+00:00")
    for _ in range(3):
        research_schedules.tick(settings, app.state.maker, at)
    detail = a.get(f"{BASE}/{item['id']}").json()
    assert len(detail["runs"]) == 1
    assert detail["next_run_at"] == "2026-10-23T09:00:00.000000+00:00"


def test_paused_skipped_and_resume_starts_in_the_future(env, setup):
    app, a, _, settings = env
    item = create(env, setup, paused=True)
    due(app, item)
    research_schedules.tick(settings, app.state.maker)
    assert a.get(f"{BASE}/{item['id']}").json()["runs"] == []
    resumed = a.patch(f"{BASE}/{item['id']}", json={"paused": False})
    assert resumed.status_code == 200
    assert resumed.json()["next_run_at"] > research_schedules.stamp(
        datetime.now(research_schedules.UTC)
    )


def test_existing_destination_records_message_and_keeps_experiment_approval(env, setup):
    app, a, _, settings = env
    pid = existing(app, setup, status="paused", stage="experiments")
    item = create(env, setup, destination="existing", research_id=pid)
    due(app, item)
    research_schedules.tick(settings, app.state.maker)
    [run] = a.get(f"{BASE}/{item['id']}").json()["runs"]
    assert run["research_id"] == pid and run["status"] == "succeeded"
    with app.state.maker() as d:
        project = d.get(ResearchProject, pid)
        assert project.status == "paused" and project.stage == "experiments"
        assert d.scalar(select(func.count(ResearchProject.id))) == 1
        messages = list(
            d.scalars(
                select(ResearchEvent).where(
                    ResearchEvent.project_id == pid, ResearchEvent.action == "message"
                )
            )
        )
        assert [e.detail["text"] for e in messages] == [item["prompt"]]
        [run] = list(d.scalars(select(AgentRun)))
        assert run.writable is False and run.runtime["research"]["role"] == "discussion"


def test_manual_run_works_while_paused_without_changing_next_occurrence(env, setup):
    app, a, _, _ = env
    item = create(env, setup, paused=True)
    result = a.post(f"{BASE}/{item['id']}/run", json={})
    assert result.status_code == 200, result.text
    assert (
        result.json()["status"] == "succeeded" and result.json()["trigger"] == "manual"
    )
    detail = a.get(f"{BASE}/{item['id']}").json()
    assert detail["paused"] and detail["next_run_at"] == item["next_run_at"]
    edited = a.patch(
        f"{BASE}/{item['id']}", json={"title": "Renamed", "prompt": "A new message"}
    )
    assert edited.status_code == 200 and edited.json()["prompt"] == "A new message"
    assert edited.json()["next_run_at"] == item["next_run_at"]
    assert a.delete(f"{BASE}/{item['id']}").status_code == 200
    assert a.get(f"{BASE}/{item['id']}").status_code == 404
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchScheduleRun.id))) == 0


def test_failure_rolls_back_partial_delivery_and_does_not_retry_storm(
    env, setup, monkeypatch
):
    app, a, _, settings = env
    item = create(env, setup)
    due(app, item)
    original = research_schedules.deliver

    def fail(settings, d, task):
        original(settings, d, task)
        raise OSError("Delivery unavailable")

    monkeypatch.setattr(research_schedules, "deliver", fail)
    at = datetime.fromisoformat("2026-10-23T01:00:00+00:00")
    research_schedules.tick(settings, app.state.maker, at)
    research_schedules.tick(settings, app.state.maker, at)
    detail = a.get(f"{BASE}/{item['id']}").json()
    [run] = detail["runs"]
    assert run["status"] == "failed" and run["error"] == "Delivery unavailable"
    assert run["research_id"] is None and run["conversation_url"] is None
    assert detail["next_run_at"] == "2026-10-24T01:00:00.000000+00:00"
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchProject.id))) == 0
        assert d.scalar(select(func.count(ResearchEvent.id))) == 0


def test_cross_user_invisible_and_cannot_target_others(env, setup):
    app, a, b, _ = env
    item = create(env, setup)
    pid = existing(app, setup)
    assert b.get(BASE).json() == []
    for method, path, body in [
        ("GET", f"{BASE}/{item['id']}", None),
        ("PATCH", f"{BASE}/{item['id']}", {"paused": True}),
        ("POST", f"{BASE}/{item['id']}/run", {}),
        ("DELETE", f"{BASE}/{item['id']}", None),
    ]:
        assert b.request(method, path, json=body).status_code == 404
    assert (
        b.post(
            BASE,
            json={
                "title": "Other",
                "prompt": "hello",
                "workspace_id": setup[2],
                "timezone": "UTC",
            },
        ).status_code
        == 404
    )
    bob_workspace = b.post("/api/v1/research/workspaces", json={"name": "Bob"}).json()[
        "id"
    ]
    assert (
        b.post(
            BASE,
            json={
                "title": "Other",
                "prompt": "hello",
                "workspace_id": bob_workspace,
                "timezone": "UTC",
                "destination": "existing",
                "research_id": pid,
            },
        ).status_code
        == 404
    )
    assert a.get(f"{BASE}/{item['id']}").json()["runs"] == []


def test_cloud_and_agent_tokens_cannot_use_schedules(env, setup):
    app, a, _, settings = env
    item = create(env, setup)
    agent, _ = bearer(app, a)
    assert agent.get(BASE).status_code == 403
    agent.close()
    settings.mode = "cloud"
    for method, path, body in [
        ("GET", BASE, None),
        ("GET", f"{BASE}/{item['id']}", None),
        ("POST", f"{BASE}/{item['id']}/run", {}),
        ("PATCH", f"{BASE}/{item['id']}", {"paused": False}),
        ("DELETE", f"{BASE}/{item['id']}", None),
    ]:
        assert a.request(method, path, json=body).status_code == 403
    due(app, item)
    research_schedules.tick(settings, app.state.maker)
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchScheduleRun.id))) == 0


@pytest.mark.parametrize(
    "change",
    [
        {"timezone": "Unknown/Timezone"},
        {"frequency": "minutely"},
        {"local_time": "24:00"},
        {"weekday": 7},
        {"interval_hours": 0},
        {"title": "   "},
        {"prompt": "   "},
        {"timezone": None},
        {"destination": "existing"},
    ],
)
def test_invalid_fields_rejected_on_create_and_edit(env, setup, change):
    item = create(env, setup)
    body = {
        "title": "Task",
        "prompt": "hi",
        "workspace_id": setup[2],
        "timezone": "UTC",
        **change,
    }
    assert env[1].post(BASE, json=body).status_code == 422
    assert env[1].patch(f"{BASE}/{item['id']}", json=change).status_code == 422


def test_destination_must_match_project_and_archived_target_fails_cleanly(env, setup):
    app, a, _, settings = env
    pid = existing(app, setup)
    other = a.post("/api/v1/research/workspaces", json={"name": "Other"}).json()["id"]
    body = {
        "title": "Task",
        "prompt": "hi",
        "workspace_id": other,
        "timezone": "UTC",
        "destination": "existing",
        "research_id": pid,
    }
    assert a.post(BASE, json=body).status_code == 422
    item = create(env, setup, destination="existing", research_id=pid)
    with app.state.maker() as d:
        d.get(ResearchWorkspace, setup[2]).archived = True
        d.commit()
    due(app, item)
    research_schedules.tick(settings, app.state.maker)
    [run] = a.get(f"{BASE}/{item['id']}").json()["runs"]
    assert run["status"] == "failed" and "恢复" in run["error"]
    assert a.patch(f"{BASE}/{item['id']}", json={"paused": True}).status_code == 200
    assert a.patch(f"{BASE}/{item['id']}", json={"paused": False}).status_code == 409


def test_concurrent_ticks_claim_only_one_delivery(env, setup):
    app, a, _, settings = env
    item = create(env, setup)
    due(app, item)
    at = datetime.fromisoformat("2026-10-23T01:00:00+00:00")
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(
            pool.map(
                lambda _: research_schedules.tick(settings, app.state.maker, at),
                range(2),
            )
        )
    assert len(a.get(f"{BASE}/{item['id']}").json()["runs"]) == 1


@pytest.mark.parametrize(
    "fields,after,expected",
    [
        ({}, "2026-10-23T00:00:00+00:00", "2026-10-23T01:00:00.000000+00:00"),
        (
            {"frequency": "weekly", "weekday": 0},
            "2026-10-23T01:00:00+00:00",
            "2026-10-26T01:00:00.000000+00:00",
        ),
        (
            {"timezone": "America/New_York", "local_time": "09:00"},
            "2026-03-07T14:00:00+00:00",
            "2026-03-08T13:00:00.000000+00:00",
        ),
        (
            {"timezone": "America/New_York", "local_time": "02:30"},
            "2026-03-08T06:00:00+00:00",
            "2026-03-08T07:30:00.000000+00:00",
        ),
        (
            {"timezone": "America/New_York", "local_time": "01:30"},
            "2026-11-01T05:30:00+00:00",
            "2026-11-02T06:30:00.000000+00:00",
        ),
    ],
)
def test_local_recurrence_and_dst(fields, after, expected):
    spec = research_schedules.ScheduleInput(
        title="Task",
        prompt="hi",
        workspace_id="workspace",
        **({"timezone": "Asia/Singapore"} | fields),
    )
    assert research_schedules.next_time(spec, datetime.fromisoformat(after)) == expected


def test_worker_tick_includes_schedules_without_running_agents(env, setup, monkeypatch):
    from backend import (
        research_datasets,
        research_dialogue,
        research_repo,
        research_sandbox,
        research_tracker,
    )

    app, a, _, _ = env
    item = create(env, setup)
    due(app, item)
    for module, names in [
        (research_dialogue, ["settle"]),
        (research_sandbox, ["sweep"]),
        (research_datasets, ["start_fetching"]),
        (research_tracker, ["sync_pending"]),
        (research_repo, ["settle", "checkpoints"]),
    ]:
        for name in names:
            monkeypatch.setattr(module, name, lambda *_: None)
    monkeypatch.setattr(research_worker, "_plan", lambda *_: None)
    research_worker.tick(app)
    assert len(a.get(f"{BASE}/{item['id']}").json()["runs"]) == 1


def test_migration_is_additive_idempotent_and_reversible(env, setup):
    app = env[0]
    migration = importlib.import_module(
        "backend.migrations.versions.0041_research_schedules"
    )
    assert migration.down_revision == "0040"
    with app.state.engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
            migration.upgrade()
            migration.upgrade()
            migration.downgrade()
            migration.upgrade()
    item = create(env, setup)
    assert (
        env[1].post(f"{BASE}/{item['id']}/run", json={}).json()["status"] == "succeeded"
    )
