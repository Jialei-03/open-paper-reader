"""Actionable reports follow their source requests, not their old badge text."""

import pytest

from backend import research_map as rm
from backend import research_notes, research_workspaces as rw
from backend.models import ResearchProject, ResearchWorkspace
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


def project(env):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        w = rw.create(d, owner, "Reports", "")
        p = rm.create_project(d, owner, "Which model works?", "", model)
        p.workspace_id = w.id
        d.commit()
        return w.id, p.id


def reports(env, wid):
    result = env[1].get(f"/api/v1/research/workspaces/{wid}/notes")
    assert result.status_code == 200, result.text
    return result.json()


def test_only_latest_unapproved_plan_is_actionable_and_completion_resolves_it(env):
    wid, pid = project(env)
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.stage = "scoping"
        for version in (1, 2):
            p.plan = {"version": version, "approved_at": None}
            rm.event(d, p, None, "advisor", "plan_proposed", {"plan": p.plan})
        d.commit()
    rows = reports(env, wid)
    assert [r["pending"] for r in rows] == [False, True]
    assert rows[0]["status"] == "resolved"
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.plan = {**p.plan, "approved_at": "2026-10-22T00:00:00+00:00"}
        p.stage = "experiments"
        d.commit()
    assert all(r["resolved"] for r in reports(env, wid))


def test_an_answered_request_does_not_return_when_a_later_decision_waits(env):
    wid, pid = project(env)
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.stage, p.status = "experiments", "waiting"
        old = rm.event(d, p, None, "advisor", "decision_requested", {"kind": "budget"})
        rm.event(d, p, None, "human", "human_decision", {"request_id": old.id})
        current = rm.event(d, p, None, "advisor", "decision_requested", {"kind": "budget"})
        rm.event(d, p, None, "system", "sprint_abnormal", {"reason": "old network failure"})
        d.commit()
        current_id = current.id
    rows = reports(env, wid)
    assert [r["id"] for r in rows if r["pending"]] == [current_id]
    error = next(r for r in rows if r["kind"] == "error")
    assert error["status"] == "historical" and not error["pending"]
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.stage, p.status = "done", "finished"
        d.commit()
        context = research_notes.context(d, d.get(ResearchWorkspace, wid))
        assert "当前待处理" not in context
        assert "历史记录" in context
    assert not any(r["pending"] for r in reports(env, wid))


def test_input_report_clears_after_a_reply_and_conclusion_after_acceptance(env):
    wid, pid = project(env)
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.stage, p.status = "experiments", "waiting"
        rm.event(d, p, None, "advisor", "input_needed", {"summary": "Which dataset?"})
        d.commit()
    assert reports(env, wid)[0]["pending"]
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        rm.event(d, p, None, "lead", "message", {"text": "Use the first dataset"})
        p.stage = "conclusion"
        p.conclusion = {"accepted": None}
        request = rm.event(d, p, None, "advisor", "decision_requested", {"kind": "conclusion"})
        d.commit()
        request_id = request.id
    assert [r["id"] for r in reports(env, wid) if r["pending"]] == [request_id]
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.conclusion = {"accepted": True}
        d.commit()
    assert not any(r["pending"] for r in reports(env, wid))


def test_forks_and_merges_are_facts_and_never_pending_approvals(env):
    wid, pid = project(env)
    with env[0].state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.stage, p.status = "scoping", "waiting"
        rm.event(d, p, None, "human", "research_forked", {"number": 2})
        rm.event(d, p, None, "human", "results_merged", {"summary": "Merged the baseline"})
        d.commit()
    rows = reports(env, wid)
    assert {r["kind"] for r in rows} == {"fork", "merged"}
    assert all(r["status"] == "historical" and not r["resolved"] for r in rows)
    assert not any(r["pending"] for r in rows)
