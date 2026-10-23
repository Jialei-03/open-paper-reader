"""Round boundaries are sealed before any later round can change the research."""

from types import SimpleNamespace

from sqlalchemy import select

from backend import research_repo as rr, research_worker as worker
from backend.models import AgentRun, ResearchEvent, ResearchProject, ResearchSprint
from backend.research_tools import _run
from backend.tests.test_research_repo import world  # noqa: F401


def running_round(world, role="executor"):
    settings, maker, (_wid, pid) = world
    with maker() as d:
        project = d.get(ResearchProject, pid)
        run = AgentRun(
            owner=project.owner, session_id=project.session_id, status="running",
            model_config_id="m", model="test-model", prompt="Test boundary",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(project_id=pid, number=1, role=role, run_id=run.id)
        d.add(sprint)
        d.commit()
        return SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker)), {
            "project_id": pid, "sprint_id": sprint.id, "role": role,
        }, project.owner


def test_tool_handoff_captures_map_and_code_in_the_same_boundary(world):
    app, research, owner = running_round(world)
    _run(app, owner, research, "end_sprint", {"summary": "The first boundary"})
    settings, maker, (wid, _pid) = world
    with maker() as d:
        sprint = d.get(ResearchSprint, research["sprint_id"])
        assert sprint.snapshot["commit"] == sprint.commit_sha
        assert sprint.snapshot["sprints"][-1]["summary"] == "The first boundary"
        assert sprint.snapshot["events"][-1]["action"] == "end_sprint"
        assert sprint.snapshot["nodes"]
        assert rr.head(rr.thread_dir(settings, wid, research["project_id"])) == sprint.commit_sha


def test_git_failure_does_not_lose_a_successful_handoff(world, monkeypatch):
    app, research, owner = running_round(world)
    monkeypatch.setattr(rr, "adopt", lambda *args: (_ for _ in ()).throw(rr.GitError("disk full")))
    _run(app, owner, research, "end_sprint", {"summary": "Durable even without Git"})
    with app.state.maker() as d:
        sprint = d.get(ResearchSprint, research["sprint_id"])
        assert sprint.status == "ended" and sprint.summary == "Durable even without Git"
        assert not sprint.snapshot
        event = d.scalar(select(ResearchEvent).where(ResearchEvent.action == "checkpoint_unavailable"))
        assert event.detail["reason"] == "disk full"


def test_fallback_reply_is_captured_before_the_scheduler_continues(world):
    app, research, _owner = running_round(world, "scoping")
    with app.state.maker() as d:
        project = d.get(ResearchProject, research["project_id"])
        project.stage = "scoping"
        sprint = d.get(ResearchSprint, research["sprint_id"])
        run = d.get(AgentRun, sprint.run_id)
        run.status, run.response = "completed", "The settled scoping answer"
        d.commit()
        worker._plan(app, d, project)
        assert sprint.snapshot["commit"] == sprint.commit_sha
        assert sprint.snapshot["sprints"][-1]["summary"] == run.response
        assert any(e["detail"].get("text") == run.response for e in sprint.snapshot["events"])
