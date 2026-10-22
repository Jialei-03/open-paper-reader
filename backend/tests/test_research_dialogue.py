"""Conversation admission and replies never silently resume experiments."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from backend import research_dialogue, research_map, research_stages, research_worker
from backend.agent_worker import research_tools
from backend.models import (
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.tests.test_research_hub import env, workspace  # noqa: F401
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure

BASE = "/api/v1/research/projects"


def project(env, status, stage):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    w = workspace(a)
    with app.state.maker() as d:
        p = research_map.create_project(
            d, owner, "Can this result generalize?", "", model
        )
        p.workspace_id, p.status, p.stage = w["id"], status, stage
        p.plan = {"version": 1, "approved_at": "before"}
        p.conclusion = {"accepted": status == "finished", "summary": "Previous result"}
        d.get(AgentSession, p.session_id).workspace_id = w["id"]
        d.commit()
        return p.id


def messages(d, pid):
    return list(
        d.scalars(
            select(ResearchEvent)
            .where(ResearchEvent.project_id == pid, ResearchEvent.action == "message")
            .order_by(ResearchEvent.created_at, ResearchEvent.id)
        )
    )


@pytest.mark.parametrize(
    ("status", "stage"),
    [("finished", "done"), ("waiting", "conclusion"), ("paused", "experiments")],
)
def test_idle_messages_open_readonly_discussion_without_resuming_experiments(
    env, monkeypatch, status, stage
):
    app, a, _, settings = env
    pid = project(env, status, stage)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        before = deepcopy((p.plan, p.conclusion, p.budget, p.spent))
    response = a.post(
        f"{BASE}/{pid}/messages", json={"text": "What does that result establish?"}
    )
    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["stage"]) == (status, stage)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        assert (p.plan, p.conclusion, p.budget, p.spent) == before
        sprint = d.scalar(
            select(ResearchSprint).where(ResearchSprint.project_id == pid)
        )
        run = d.get(AgentRun, sprint.run_id)
        assert sprint.role == "discussion" and run.writable is False
        assert run.runtime["research"]["role"] == "discussion"
        assert run.prompt == "What does that result establish?"
        assert f"{status} / {stage}" in run.context
        assert all(not tool["write"] for tool in research_tools("discussion"))
        assert d.scalar(select(func.count(ResearchJob.id))) == 0
        run.status, run.response = "completed", "It supports a bounded conclusion."
        d.commit()
    monkeypatch.setattr(research_worker, "capture_handoff", lambda *args: False)
    research_dialogue.settle(settings, app.state.maker)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        assert (p.status, p.stage) == (status, stage)
        assert (p.plan, p.conclusion, p.budget, p.spent) == before
        assert (
            messages(d, pid)[-1].detail["text"] == "It supports a bounded conclusion."
        )
        assert research_stages.unanswered(d, p) == []


def test_paused_scoping_message_only_resumes_scoping_until_plan_approval(env):
    app, a, _, _ = env
    pid = project(env, "paused", "scoping")
    response = a.post(
        f"{BASE}/{pid}/messages", json={"text": "Help refine the hypotheses."}
    )
    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["stage"]) == (
        "active",
        "scoping",
    )
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        research_worker._plan(app, d, p)
        d.commit()
        sprint = d.scalar(
            select(ResearchSprint).where(ResearchSprint.project_id == pid)
        )
        assert sprint.role == "scoping" and p.stage == "scoping"
        assert p.spent["sprints"] == 0
        assert d.scalar(select(func.count(ResearchJob.id))) == 0


def test_active_experiment_message_is_guidance_without_new_run(env):
    app, a, _, _ = env
    pid = project(env, "active", "experiments")
    response = a.post(
        f"{BASE}/{pid}/messages", json={"text": "Use another seed next round."}
    )
    assert response.status_code == 200
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        assert (p.status, p.stage) == ("active", "experiments")
        assert research_stages.unanswered(d, p) == ["Use another seed next round."]
        assert d.scalar(select(func.count(AgentRun.id))) == 0


def test_discussion_owner_archive_and_concurrent_admission(env, monkeypatch):
    app, a, b, settings = env
    pid = project(env, "finished", "done")
    assert b.post(f"{BASE}/{pid}/messages", json={"text": "foreign"}).status_code == 404
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda text: a.post(f"{BASE}/{pid}/messages", json={"text": text}),
                ("First question", "Second question"),
            )
        )
    assert [r.status_code for r in responses] == [200, 200]
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        runs = list(
            d.scalars(select(AgentRun).where(AgentRun.session_id == p.session_id))
        )
        assert len(runs) == 1
        assert len([m for m in messages(d, pid) if m.actor == "human"]) == 2
        first = runs[0].prompt
        runs[0].status, runs[0].response = "completed", "First answer"
        d.commit()
    monkeypatch.setattr(research_worker, "capture_handoff", lambda *args: False)
    research_dialogue.settle(settings, app.state.maker)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        assert (p.status, p.stage) == ("finished", "done")
        runs = list(
            d.scalars(
                select(AgentRun)
                .where(AgentRun.session_id == p.session_id)
                .order_by(AgentRun.created_at)
            )
        )
        assert (
            len(runs) == 2
        ), "Messages received during a discussion need a subsequent readonly reply"
        assert runs[1].writable is False and runs[1].prompt != first
        assert len([m for m in messages(d, pid) if m.actor == "human"]) == 2
        d.get(ResearchWorkspace, p.workspace_id).archived = True
        d.commit()
    assert (
        a.post(f"{BASE}/{pid}/messages", json={"text": "Archived"}).status_code == 409
    )


def test_resume_does_not_seal_a_readonly_discussion_as_a_code_round(env, monkeypatch):
    from backend import research_sandbox

    app, a, _, _ = env
    pid = project(env, "paused", "experiments")
    assert (
        a.post(
            f"{BASE}/{pid}/messages", json={"text": "Explain this result"}
        ).status_code
        == 200
    )
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        run = d.scalar(select(AgentRun).where(AgentRun.session_id == p.session_id))
        run.status, run.response = "completed", "A readonly answer"
        p.status = "active"
        d.commit()
    monkeypatch.setattr(
        research_worker,
        "capture_handoff",
        lambda *args: pytest.fail(
            "Readonly discussion must not capture a code checkpoint"
        ),
    )
    monkeypatch.setattr(research_worker, "_start", lambda *args: None)
    monkeypatch.setattr(research_sandbox, "docker_status", lambda: {"available": True})
    with app.state.maker() as d:
        research_worker._plan(app, d, d.get(ResearchProject, pid))


def test_retrospective_waits_for_a_same_session_discussion(env):
    app, a, _, _ = env
    pid = project(env, "finished", "retrospective")
    with app.state.maker() as d:
        d.add(
            ResearchSprint(
                project_id=pid,
                number=1,
                role="executor",
                run_id="historical",
                status="ended",
            )
        )
        d.commit()
    assert (
        a.post(
            f"{BASE}/{pid}/messages", json={"text": "Explain the finished work"}
        ).status_code
        == 200
    )
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        research_worker._distill(app, d, p)
        assert (
            d.scalar(
                select(func.count(AgentRun.id)).where(
                    AgentRun.session_id == p.session_id
                )
            )
            == 1
        )
        assert not d.scalar(
            select(ResearchSprint.id).where(
                ResearchSprint.project_id == pid, ResearchSprint.role == "distiller"
            )
        )
