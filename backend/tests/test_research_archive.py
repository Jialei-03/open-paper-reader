"""Archived legacy workspaces cannot restart research in the background."""

import pytest
from sqlalchemy import func, select

from backend import research_map, research_worker, research_workspaces
from backend.models import AgentRun, ResearchEvent, ResearchProject
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


def test_archived_workspace_blocks_planning_and_retrospective(env, monkeypatch):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = research_workspaces.create(d, owner, "Archived work")
        project = research_map.create_project(d, owner, "An old question", "", model)
        project.workspace_id = workspace.id
        # Simulate a project archived by an earlier version that only hid it.
        workspace.archived = True
        d.commit()
        events = d.scalar(select(func.count(ResearchEvent.id)))
        runs = d.scalar(select(func.count(AgentRun.id)))
        monkeypatch.setattr(research_worker, "read_config", lambda *args: pytest.fail("scheduled an archived project"))
        project.stage, project.status = "experiments", "active"
        research_worker._plan(app, d, project)
        assert project.status == "active"
        project.stage, project.status = "retrospective", "finished"
        research_worker._distill(app, d, project)
        assert project.stage == "retrospective"
        assert d.scalar(select(func.count(ResearchEvent.id))) == events
        assert d.scalar(select(func.count(AgentRun.id))) == runs


@pytest.mark.parametrize("status", ["paused", "finished"])
def test_scheduler_discards_a_project_snapshot_after_it_has_been_stopped(env, monkeypatch, status):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = research_workspaces.create(d, owner, "Scheduling race")
        project = research_map.create_project(d, owner, "An old question", "", model)
        project.workspace_id, project.stage = workspace.id, "experiments"
        d.commit()
        pid = project.id
    with app.state.maker() as stale:
        project = stale.get(ResearchProject, pid)
        assert project.status == "active"
        with app.state.maker() as other:
            other.get(ResearchProject, pid).status = status
            other.commit()
        monkeypatch.setattr(research_worker, "read_config", lambda *args: pytest.fail("used stale active status"))
        research_worker._plan(app, stale, project)
        assert project.status == status
        assert stale.scalar(select(func.count(AgentRun.id))) == 0
