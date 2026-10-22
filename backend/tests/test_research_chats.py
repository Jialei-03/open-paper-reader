"""Conversations in a project: asking about the work without touching it."""

import pytest
from sqlalchemy import select

from backend import research_chat as rc
from backend import research_map as rm
from backend import research_workspaces as rw
from backend.models import (
    AgentRun,
    AgentSession,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
)
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure


@pytest.fixture
def env(cloud_env):  # noqa: F811
    """Research is the local edition's: its tests run as that edition."""
    cloud_env[3].mode = "local"
    return cloud_env


WS = "/api/v1/research/workspaces"


def _project_with_a_running_job(app, owner):
    with app.state.maker() as d:
        w = rw.create(d, owner, "CIFAR")
        p = rm.create_project(d, owner, "小 CNN 到 90%", "", "m")
        p.workspace_id, p.stage = w.id, "experiments"
        node = rm.root(d, p)
        sprint = ResearchSprint(
            project_id=p.id, number=3, run_id="r", summary="跑了基线"
        )
        d.add(sprint)
        d.flush()
        d.add(
            ResearchJob(
                project_id=p.id,
                node_id=node.id,
                sprint_id=sprint.id,
                command="python train.py",
                status="succeeded",
                config={"tag": "baseline-s0"},
                metrics={"test_acc": 0.704},
            )
        )
        d.commit()
        return w.id, p.id


def test_a_legacy_conversation_still_reads_without_touching_research(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    retired = a.post(
        f"{WS}/{wid}/chats",
        json={"message": "现在进展怎么样？", "model_config_id": model},
    )
    assert retired.status_code == 410
    with app.state.maker() as d:
        old = rc.start(
            settings,
            d,
            owner,
            d.get(rw.ResearchWorkspace, wid),
            "现在进展怎么样？",
            model,
        )
        d.commit()
        chat = rc.session_out(d, old)
    with app.state.maker() as d:
        assert len(list(d.scalars(select(ResearchProject)))) == 1
        session = d.get(AgentSession, chat["id"])
        assert session.workspace_id == wid
        run = d.scalars(select(AgentRun).where(AgentRun.session_id == chat["id"])).one()
        assert run.runtime["research"] == {"role": "chat", "workspace_id": wid}
        assert run.lane == ""  # never queued behind a research round
        # What the project holds now, so a first answer needs no lookup.
        assert "小 CNN 到 90%" in run.context and "test_acc=0.704" in run.context
        run.status = "completed"
        d.commit()
    more = a.post(
        f"/api/v1/research/chats/{chat['id']}/messages", json={"message": "ResNet 呢？"}
    )
    assert more.status_code == 200, more.text
    listed = a.get(f"{WS}/{wid}/chats").json()
    assert [c["id"] for c in listed] == [chat["id"]]
    # The reader's own conversations stay its own.
    assert chat["id"] not in [s["id"] for s in a.get("/api/v1/agent/sessions").json()]


def test_a_conversation_reads_the_project_and_nothing_else(env):
    app, a, _b, settings = env
    owner, _ = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    other_wid, other_pid = _project_with_a_running_job(app, owner)
    research = {"role": "chat", "workspace_id": wid}
    with app.state.maker() as d:
        overview = rc.overview(d, d.get(rw.ResearchWorkspace, wid))
        assert "baseline-s0" in overview and "跑了基线" in overview
        assert "小 CNN" in rc.read_research(d, research, pid)
        with pytest.raises(ValueError, match="不在这个项目"):
            rc.read_research(d, research, other_pid)


def test_a_conversation_cannot_do_anything_to_the_work(env):
    from backend.research_tools import gate

    app, *_ = env
    research = {"role": "chat", "workspace_id": "w"}
    for name in ("project_overview", "research_read", "job_logs", "search_papers"):
        gate(app, research, name)
    for name in ("run_job", "bash", "add_node", "advise", "stop_job", "write"):
        with pytest.raises(ValueError, match="只读"):
            gate(app, research, name)


def test_a_conversation_remembers_what_was_said_before():
    from backend.agent_worker import research_tools

    names = {t["name"] for t in research_tools("chat")}
    assert {"project_overview", "research_read", "job_logs"} <= names
    assert not names & {"bash", "run_job", "write", "add_node"}


def test_what_a_conversation_uses_only_reads():
    from backend.agent_tools import TOOL_MAP
    from backend.research_tools import CHAT_TOOLS

    # Its runs are not allowed to write, so every tool it has must be a read.
    assert all(not TOOL_MAP[name]["write"] for name in CHAT_TOOLS)


def test_a_new_conversation_reads_the_project_before_it_has_a_plan(env):
    from backend.research_brief import scoping_brief
    from backend.research_tools import _run

    app, a, _b, settings = env
    owner, _ = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    with app.state.maker() as d:
        talk = rm.create_project(d, owner, "ResNet 那轮结果怎样？", "", "m")
        talk.workspace_id = wid
        sprint = ResearchSprint(
            project_id=talk.id, number=1, run_id="r", role="scoping"
        )
        d.add(sprint)
        d.commit()
        brief = scoping_brief(d, talk, 1, settings)
        assert "小 CNN 到 90%" in brief and "直接回答" in brief
        research = {
            "role": "scoping",
            "project_id": talk.id,
            "sprint_id": sprint.id,
            "workspace_id": wid,
        }
    text = _run(app, owner, research, "research_read", {"research_id": pid})["text"]
    assert "baseline-s0" in text
