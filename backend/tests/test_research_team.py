"""Team delivery, adapter and isolation checks; no external models."""

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from backend import agent_worker
from backend import research_team as team
from backend.agent_tools import execute
from backend.models import (
    AgentControl,
    AgentRun,
    ResearchJob,
    ResearchSprint,
    ResearchWorkspace,
    TeamDelivery,
    TeamMember,
    TeamMessage,
)
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agent_controls import blocked_model, wait_for  # noqa: F401
from backend.tests.test_agents import configure
from backend.tests.test_research_routes import env  # noqa: F401


@pytest.fixture
def world(env):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    result = a.post("/api/v1/research/workspaces", json={"name": "Team"})
    assert result.status_code == 200, result.text
    wid = result.json()["id"]
    a.patch(f"/api/v1/research/workspaces/{wid}", json={"model_config_id": model})
    base = f"/api/v1/research/workspaces/{wid}/team"
    overview = a.get(base).json()
    return app, a, b, settings, owner, model, wid, base, overview


def send(world, text, channel=None, **extra):
    _, a, _, _, _, _, _, base, overview = world
    channel = channel or next(
        c["id"] for c in overview["channels"] if c["key"] == "general"
    )
    result = a.post(
        f"{base}/channels/{channel}/messages",
        json={"text": text, "client_id": str(uuid.uuid4()), **extra},
    )
    assert result.status_code == 200, result.text
    return result.json()


def deliveries(app):
    with app.state.maker() as d:
        return list(
            d.scalars(
                select(TeamDelivery).order_by(TeamDelivery.created_at, TeamDelivery.id)
            )
        )


def finish(app, run_id, text, to=()):
    with app.state.maker() as d:
        run = d.get(AgentRun, run_id)
        run.status, run.response = "completed", text
        if to:
            # Agents wake members by naming them in team_send_message's `to`.
            response = d.scalar(
                select(TeamMessage).where(TeamMessage.source_key == f"run:{run_id}")
            )
            workspace = d.get(ResearchWorkspace, run.runtime["team"]["workspace_id"])
            response.data = {**response.data, "to": team.addressed(d, workspace, to)}
        d.commit()


def test_defaults_channels_and_silent_channel(world):
    app, a, _, _, _, _, wid, base, overview = world
    assert {m["role"] for m in overview["members"]} == set(team.ROLES)
    assert {c["name"] for c in overview["channels"] if not c["member_id"]} == set(
        team.CHANNELS.values()
    )
    assert len(overview["channels"]) == 10
    send(world, "no automatic reply")
    assert not deliveries(app)
    created = a.post(base + "/channels", json={"name": "Ideas"}).json()["id"]
    assert (
        a.patch(base + f"/channels/{created}", json={"name": "Notes"}).status_code
        == 200
    )
    assert a.delete(base + f"/channels/{created}").status_code == 200
    with app.state.maker() as d:
        assert len(team.ensure(d, d.get(ResearchWorkspace, wid))) == 7


def test_mentions_reply_location_and_uncapped_relay(world):
    app, a, _, settings, _, _, _, base, _ = world
    first = send(world, "@librarian find papers")
    initial = deliveries(app)[0]
    finish(app, initial.run_id, "@reviewer check this", ["reviewer"])
    team.settle(settings, app.state.maker)
    second = deliveries(app)[1]
    with app.state.maker() as d:
        run = d.get(AgentRun, second.run_id)
        assert run.runtime["team"]["channel_id"] == first["channel_id"]
        reply = d.scalar(
            select(TeamMessage).where(TeamMessage.source_key == f"run:{initial.run_id}")
        )
        assert run.runtime["team"]["thread_id"] == first["id"]
    for n in range(13):
        last = deliveries(app)[-1]
        with app.state.maker() as d:
            role = d.get(TeamMember, last.member_id).role
        finish(
            app,
            last.run_id,
            "continue",
            ["librarian" if role == "reviewer" else "reviewer"],
        )
        team.settle(settings, app.state.maker)
    with app.state.maker() as d:
        assert not d.scalar(
            select(TeamMessage).where(TeamMessage.kind == "relay_limit")
        )
    assert len(deliveries(app)) == 15  # Handoffs are never cut off.
    response = a.get(
        base + f"/channels/{first['channel_id']}/messages",
        params={"thread_id": first["id"]},
    ).json()["messages"]
    assert any(
        m.get("run", {}).get("response") == "@reviewer check this" for m in response
    )


def test_queue_edit_withdraw_immediate_and_fifo(world):
    app, a, _, settings, _, _, _, base, overview = world
    dm = next(c["id"] for c in overview["channels"] if c["key"] == "dm:advisor")
    send(world, "first", dm)
    run_id = deliveries(app)[0].run_id
    send(world, "second", dm)
    queued = deliveries(app)[1]
    assert queued.status == "queued" and queued.run_id is None
    path = base + f"/deliveries/{queued.id}"
    assert a.patch(path, json={"text": "edited"}).status_code == 200
    assert a.patch(path, json={"mode": "immediate"}).status_code == 200
    with app.state.maker() as d:
        row = d.get(TeamDelivery, queued.id)
        control = d.get(AgentControl, row.control_id)
        assert (
            control.kind == "steer"
            and control.run_id == run_id
            and control.text == "edited"
        )
        control.status = "applied"
        d.commit()
    send(world, "withdraw me", dm)
    assert (
        a.patch(
            base + f"/deliveries/{deliveries(app)[-1].id}", json={"cancel": True}
        ).status_code
        == 200
    )
    send(world, "third", dm)
    finish(app, run_id, "first done")
    team.settle(settings, app.state.maker)
    assert deliveries(app)[-1].status == "running"
    assert deliveries(app)[-1].run_id != run_id


def test_native_steering_reaches_the_working_member(world, env, blocked_model):
    app, _, _, settings, _, _, _, _, overview = world
    dm = next(c["id"] for c in overview["channels"] if c["key"] == "dm:librarian")
    # This fake upstream omits usage, so requests consume conservative reserves.
    from backend.agent_files import read_member, render, save_member

    with app.state.maker() as d:
        member = d.get(
            TeamMember,
            next(c["member_id"] for c in overview["channels"] if c["id"] == dm),
        )
        source, values = read_member(member)
        save_member(
            member, render({**values, "wake_tokens": 1000000}, source), world[4]
        )
        d.commit()
    send(world, "first", dm)
    run_id = deliveries(app)[0].run_id
    with app.state.maker() as d:
        d.get(AgentRun, run_id).status = "running"
        d.commit()
    requests, streamed, release = blocked_model
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(agent_worker.process, app, run_id)
        assert streamed.wait(5)
        send(world, "change now", dm, mode="immediate")
        control_id = deliveries(app)[-1].control_id
        wait_for(app, control_id, {"accepted", "applied"})
        release.set()
        task.result(timeout=10)
    team.settle(settings, app.state.maker)
    assert any("change now" in str(request["messages"]) for request in requests)
    with app.state.maker() as d:
        assert d.get(AgentRun, run_id).status == "completed"


def test_research_adapter_jobs_legacy_and_normalized_text(world):
    app, a, _, settings, owner, model, wid, base, overview = world
    from backend import research_chat, research_map

    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        project = research_map.create_project(d, owner, "Old question", "", model)
        project.workspace_id = wid
        project.plan = {"summary": "Plan"}
        research_map.event(
            d, project, None, "human", "message", {"text": "old message"}
        )
        sprint = ResearchSprint(
            project_id=project.id, number=1, run_id="old", summary="handoff"
        )
        d.add(sprint)
        d.flush()
        d.add(
            ResearchJob(
                project_id=project.id,
                sprint_id=sprint.id,
                node_id=research_map.root(d, project).id,
                command="test",
                finished_at=team.now(),
                status="succeeded",
                exit_code=0,
            )
        )
        session = research_chat.main_session(d, workspace)
        d.add(
            AgentRun(
                owner=owner,
                session_id=session.id,
                model_config_id=model,
                model="test",
                prompt="old chat",
                response="old answer",
                status="completed",
            )
        )
        d.commit()
        pid = project.id
    experiments = next(
        c["id"] for c in overview["channels"] if c["key"] == "experiments"
    )
    root = a.get(base + f"/channels/{experiments}/messages").json()["messages"][0]
    assert root["id"] == f"research:{pid}"
    assert root["replies"] == 2
    adapted = a.get(
        base + f"/channels/{experiments}/messages", params={"thread_id": root["id"]}
    ).json()
    assert adapted["research"]["events"][-1]["detail"]["text"] == "old message"
    assert adapted["research"]["sprints"][0]["summary"] == "handoff"
    assert adapted["research"]["jobs"][0]["command"] == "test"
    team.settle(settings, app.state.maker)
    team.settle(settings, app.state.maker)
    with app.state.maker() as d:
        assert (
            len(list(d.scalars(select(TeamMessage).where(TeamMessage.kind == "job"))))
            == 1
        )
    dm = next(c["id"] for c in overview["channels"] if c["key"] == "dm:advisor")
    legacy = a.get(base + f"/channels/{dm}/messages").json()["messages"]
    assert [m["text"] for m in legacy] == ["old chat", "old answer"]
    assert send(world, "line1\\nline2")["text"] == "line1\nline2"


def test_isolation_local_only_thread_validation_idempotency_and_budget(world):
    app, a, b, settings, _, _, wid, base, overview = world
    assert b.get(base).status_code == 404
    settings.mode = "hosted"
    assert a.get(base).status_code == 403
    settings.mode = "local"
    other = a.post("/api/v1/research/workspaces", json={"name": "Other"}).json()["id"]
    other_channels = a.get(f"/api/v1/research/workspaces/{other}/team").json()[
        "channels"
    ]
    channel = overview["channels"][0]["id"]
    path = base + f"/channels/{channel}/messages"
    assert (
        a.post(
            base + f"/channels/{other_channels[0]['id']}/messages",
            json={"text": "bad", "client_id": "wrong"},
        ).status_code
        == 404
    )
    assert (
        a.post(
            path,
            json={"text": "bad", "thread_id": str(uuid.uuid4()), "client_id": "bad"},
        ).status_code
        == 409
    )
    body = {"text": "@writer draft", "client_id": "same"}
    first = a.post(path, json=body).json()
    assert a.post(path, json=body).json()["id"] == first["id"]
    assert len(deliveries(app)) == 1
    with app.state.maker() as d:
        writer = d.scalar(
            select(TeamMember).where(
                TeamMember.workspace_id == wid, TeamMember.role == "writer"
            )
        )
        writer.tokens = 10**9
        d.get(AgentRun, deliveries(app)[0].run_id).status = "completed"
        d.commit()
    team.settle(settings, app.state.maker)
    send(world, "@writer again")
    # Members have no token limit unless their file sets budget.total_tokens.
    assert deliveries(app)[-1].status == "running"
    assert not any(
        m["data"].get("reason") == "member_total_tokens"
        for m in a.get(base).json()["notifications"]
    )


def test_member_tools_reject_cross_team_and_role_writes(world):
    app, _, _, _, owner, _, _, _, overview = world
    send(world, "@reviewer check")
    run_id = deliveries(app)[0].run_id
    with app.state.maker() as d:
        run = d.get(AgentRun, run_id)
        run.status = "running"
        d.commit()
    with pytest.raises(ValueError, match="Tool unavailable"):
        asyncio.run(
            execute(
                app,
                owner,
                run.session_id,
                "write",
                {"path": "x", "content": "bad"},
                "test",
                sandbox_id=run_id,
            )
        )
    with pytest.raises(ValueError, match="Channel not found"):
        asyncio.run(
            execute(
                app,
                owner,
                run.session_id,
                "team_read_channel",
                {"channel_id": str(uuid.uuid4())},
                "test",
                sandbox_id=run_id,
            )
        )
    result = asyncio.run(
        execute(
            app,
            owner,
            run.session_id,
            "team_send_message",
            {"text": "@writer improve"},
            "test",
            sandbox_id=run_id,
        )
    )
    assert result["message_id"]


def test_message_reads_do_not_consume_unopened_thread_replies(world):
    app, a, _, _, _, _, wid, base, overview = world
    root = send(world, "my thread")
    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        member = d.scalar(
            select(TeamMember).where(
                TeamMember.workspace_id == wid, TeamMember.role == "writer"
            )
        )
        channel = team.channel_of(d, workspace, root["channel_id"])
        reply = team.post(
            d, workspace, channel, "@human review", author=member, thread_id=root["id"]
        )
        d.commit()
        through = reply.created_at
    assert a.get(base).json()["notifications"]
    read = base + f"/channels/{root['channel_id']}/read"
    assert a.post(read, json={"through": through}).status_code == 200
    assert a.get(base).json()["notifications"]
    assert (
        a.post(read, json={"through": through, "thread_id": root["id"]}).status_code
        == 200
    )
    assert not a.get(base).json()["notifications"]


def test_runner_exit_reason_is_preserved(world, monkeypatch):
    app, _, _, _, _, _, _, _, _ = world
    send(world, "@librarian hello")
    run_id = deliveries(app)[0].run_id
    with app.state.maker() as d:
        d.get(AgentRun, run_id).status = "running"
        d.commit()
    monkeypatch.setenv("AGENT_NODE", "/usr/bin/false")
    agent_worker.process(app, run_id)
    with app.state.maker() as d:
        run = d.get(AgentRun, run_id)
        assert run.status == "failed"
        assert "Runner exited with code 1" in run.error
    assert (
        agent_worker.failure_reason(RuntimeError("first\nlast secret"), ["secret"])
        == "RuntimeError: last [redacted]"
    )


def test_research_handoff_mentions_wake_members_without_copying_history(world):
    app, a, _, settings, owner, model, wid, base, overview = world
    from backend import research_map

    with app.state.maker() as d:
        project = research_map.create_project(d, owner, "Question", "", model)
        project.workspace_id = wid
        sprint = ResearchSprint(
            project_id=project.id,
            number=1,
            run_id="old",
            role="executor",
            status="ended",
            summary="@librarian find a reference",
        )
        d.add(sprint)
        d.flush()
        info = team.research_context(
            d, {"project_id": project.id, "role": "executor"}, owner
        )
        assert info["research_round"] and info["thread_id"] == f"research:{project.id}"
        d.commit()
    team.settle(settings, app.state.maker)
    team.settle(settings, app.state.maker)
    with app.state.maker() as d:
        reference = d.scalar(
            select(TeamMessage).where(TeamMessage.kind == "sprint_reference")
        )
        assert reference.text == ""
        assert team.message_out(d, reference)["text"] == "@librarian find a reference"
        delivery = d.scalar(
            select(TeamDelivery).where(TeamDelivery.message_id == reference.id)
        )
        assert d.get(TeamMember, delivery.member_id).role == "librarian"
        run = d.get(AgentRun, delivery.run_id)
        assert run.runtime["team"]["thread_id"] == info["thread_id"]


def test_completion_is_unread_when_the_running_message_was_read(world):
    app, a, _, settings, _, _, _, base, overview = world
    dm = next(c["id"] for c in overview["channels"] if c["key"] == "dm:advisor")
    send(world, "hello", dm)
    run_id = deliveries(app)[0].run_id
    with app.state.maker() as d:
        response = d.scalar(
            select(TeamMessage).where(TeamMessage.source_key == f"run:{run_id}")
        )
        response.data = {**response.data, "read": True}
        d.commit()
    finish(app, run_id, "finished while you were away")
    team.settle(settings, app.state.maker)
    assert (
        a.get(base).json()["notifications"][0]["text"] == "finished while you were away"
    )


@pytest.mark.parametrize("status", ["completed", "cancelled", "failed"])
def test_member_reply_uses_terminal_time_and_keeps_active_position(world, status):
    app, a, _, settings, _, _, _, base, _ = world
    root = send(world, "@librarian find papers")
    delivery = deliveries(app)[0]
    progress = send(world, "Another update", thread_id=root["id"])
    started = "2026-10-23T15:27:00+00:00"
    working = "2026-10-23T15:35:00+00:00"
    finished = "2026-10-23T15:44:00+00:00"
    path = base + f"/channels/{root['channel_id']}/messages"

    def messages():
        return a.get(path, params={"thread_id": root["id"]}).json()["messages"]

    with app.state.maker() as d:
        response = d.scalar(
            select(TeamMessage).where(
                TeamMessage.source_key == f"run:{delivery.run_id}"
            )
        )
        response_id = response.id
        response.created_at = started
        d.get(TeamMessage, progress["id"]).created_at = working
        run = d.get(AgentRun, delivery.run_id)
        run.created_at, run.updated_at = started, working
        d.commit()
    for active_status in ("queued", "running"):
        with app.state.maker() as d:
            d.get(AgentRun, delivery.run_id).status = active_status
            d.commit()
        team.settle(settings, app.state.maker)
        rows = messages()
        assert [m["id"] for m in rows] == [response_id, progress["id"]]
        assert rows[0]["created_at"] == started
        assert rows[0]["run"]["status"] == active_status
    with app.state.maker() as d:
        run = d.get(AgentRun, delivery.run_id)
        run.status, run.updated_at = status, finished
        run.response = "Saved answer"
        run.error = "Test failure" if status == "failed" else ""
        d.commit()
    for _ in range(2):
        team.settle(settings, app.state.maker)
        rows = messages()
        assert [m["id"] for m in rows] == [progress["id"], response_id]
        assert rows[-1]["created_at"] == finished
        assert rows[-1]["text"] == "Saved answer"
        assert rows[-1]["run"]["status"] == status
    assert deliveries(app)[0].status == ("applied" if status == "completed" else status)
    if status == "cancelled":
        assert a.get(base + "/deliveries").json() == []


def test_research_immediate_targets_current_round_and_cross_channel_reply(world):
    app, a, _, settings, owner, model, wid, base, overview = world
    from backend import research_map

    with app.state.maker() as d:
        project = research_map.create_project(d, owner, "Question", "", model)
        project.workspace_id = wid
        project.stage = "experiments"
        run = AgentRun(
            owner=owner,
            session_id=project.session_id,
            model_config_id=model,
            model="Fake",
            prompt="work",
            status="running",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=project.id, number=1, role="executor", run_id=run.id
        )
        d.add(sprint)
        d.flush()
        run.runtime = {
            "research": {
                "project_id": project.id,
                "sprint_id": sprint.id,
                "role": "executor",
            },
            "team": team.research_context(
                d, {"project_id": project.id, "role": "executor"}, owner
            ),
        }
        d.commit()
        pid, run_id = project.id, run.id
    experiments = next(
        c["id"] for c in overview["channels"] if c["key"] == "experiments"
    )
    send(
        world, "change now", experiments, thread_id=f"research:{pid}", mode="immediate"
    )
    dm = next(c["id"] for c in overview["channels"] if c["key"] == "dm:executor")
    incoming = send(world, "answer here too", dm, mode="immediate")
    rows = deliveries(app)
    assert all(row.run_id == run_id and row.status == "steering" for row in rows)
    with app.state.maker() as d:
        for row in rows:
            d.get(AgentControl, row.control_id).status = "applied"
        d.commit()
    finish(app, run_id, "adjusted the work")
    team.settle(settings, app.state.maker)
    history = a.get(
        base + f"/channels/{dm}/messages", params={"thread_id": incoming["id"]}
    ).json()["messages"]
    assert any(
        m["author_id"]
        != next(m["id"] for m in overview["members"] if m["role"] == "human")
        and m["text"] == "adjusted the work"
        for m in history
    )
