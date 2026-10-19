import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend import research_map as rm
from backend import research_sandbox as rs
from backend import research_tools as rt
from backend.agent_tools import TOOLS, execute
from backend.config import Settings, database
from backend.models import (
    Base,
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchSprint,
    User,
)


@pytest.fixture
def world(tmp_path, monkeypatch):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "tools.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker))
    calls = []
    monkeypatch.setattr(
        rs,
        "pi_call",
        lambda settings, project_id, name, args: (
            calls.append((project_id, name, args))
            or {"content": [{"type": "text", "text": "ok"}]}
        ),
    )
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        project = rm.create_project(d, user.id, "Does L2 help?", "", "m")
        root = rm.root(d, project)
        sprint = ResearchSprint(project_id=project.id, number=1, run_id="run-1")
        d.add(sprint)
        d.commit()
        research = {
            "project_id": project.id,
            "sprint_id": sprint.id,
            "role": "executor",
        }
        ids = SimpleNamespace(
            owner=user.id, project=project.id, root=root.id, sprint=sprint.id
        )
    yield app, maker, research, ids, calls
    engine.dispose()


def call(app, ids, research, name, args):
    return asyncio.run(
        execute(app, ids.owner, "session", name, args, "key", True, research=research)
    )


def events(maker, action):
    with maker() as d:
        return list(
            d.scalars(select(ResearchEvent).where(ResearchEvent.action == action))
        )


def add_hypothesis(app, ids, research):
    call(
        app,
        ids,
        research,
        "focus",
        {"node_id": ids.root, "intent": "split the question"},
    )
    return call(
        app,
        ids,
        research,
        "add_node",
        {
            "parent_id": ids.root[:8],
            "kind": "hypothesis",
            "title": "Moderate L2 helps",
            "kill_if": "gain < 0.5% on 3 seeds",
            "reason": "first guess",
        },
    )["node"]["id"]


def test_bash_without_focus_is_blocked_and_logged(world):
    app, maker, research, ids, calls = world
    with pytest.raises(ValueError, match="focus"):
        call(app, ids, research, "bash", {"command": "ls"})
    assert calls == []
    blocked = events(maker, "drift_blocked")
    assert blocked[0].detail == {"tool": "bash", "reason": "no_focus"}


def test_focus_free_tools_work_without_focus(world):
    app, _maker, research, ids, _calls = world
    out = call(app, ids, research, "research_map_read", {})
    assert "Does L2 help?" in out["map"] and out["focus"] is None


def test_focus_on_refuted_branch_blocked(world):
    app, maker, research, ids, _calls = world
    hyp = add_hypothesis(app, ids, research)
    with maker() as d:
        rm.update_node(
            d, d.get(ResearchNode, hyp), status="refuted", actor="advisor", reason="x"
        )
        d.commit()
    with pytest.raises(ValueError):
        call(app, ids, research, "focus", {"node_id": hyp, "intent": "retry"})
    assert events(maker, "drift_blocked")[-1].detail["reason"] == "closed_node"
    with pytest.raises(ValueError):
        call(app, ids, research, "focus", {"node_id": "deadbeef", "intent": "x"})
    assert events(maker, "drift_blocked")[-1].detail["reason"] == "unknown_node"


def test_focus_lost_when_node_closes(world):
    app, maker, research, ids, _calls = world
    hyp = add_hypothesis(app, ids, research)
    call(app, ids, research, "focus", {"node_id": hyp, "intent": "test it"})
    with maker() as d:
        rm.update_node(
            d, d.get(ResearchNode, hyp), status="abandoned", actor="advisor", reason="x"
        )
        d.commit()
    with pytest.raises(ValueError):
        call(app, ids, research, "bash", {"command": "ls"})
    assert events(maker, "drift_blocked")[-1].detail["reason"] == "closed_focus"


def test_focus_then_bash_goes_to_research_sandbox(world):
    app, maker, research, ids, calls = world
    hyp = add_hypothesis(app, ids, research)
    call(app, ids, research, "focus", {"node_id": hyp, "intent": "run a baseline"})
    with maker() as d:
        assert d.get(ResearchSprint, ids.sprint).focus_node_id == hyp
        assert d.get(ResearchNode, hyp).status == "active"
    out = call(app, ids, research, "bash", {"command": "ls"})
    assert calls == [(ids.project, "bash", {"command": "ls"})]
    assert out["content"][0]["text"] == "ok"
    assert events(maker, "focus")[-1].detail["intent"] == "run a baseline"


def test_record_result_kill_triggered_refutes_hypothesis(world, monkeypatch):
    app, maker, research, ids, _calls = world
    hyp = add_hypothesis(app, ids, research)
    call(app, ids, research, "focus", {"node_id": hyp, "intent": "measure"})
    checked = [
        {
            "kind": "log",
            "job_id": "j",
            "from_line": 1,
            "to_line": 1,
            "lines": ["acc=0.5"],
        }
    ]
    monkeypatch.setattr(rt.research_evidence, "check", lambda *a: checked)
    call(
        app,
        ids,
        research,
        "record_result",
        {
            "node_id": hyp,
            "summary": "no gain: acc=0.5 for every strength",
            "evidence": [{"kind": "log", "job_id": "j", "from_line": 1, "to_line": 1}],
            "kill_triggered": "yes",
            "confidence": 0.1,
        },
    )
    with maker() as d:
        node = d.get(ResearchNode, hyp)
        assert node.status == "refuted" and node.confidence == 0.1
        assert node.evidence_against[0]["evidence"] == checked
        assert node.evidence_for == []
    assert events(maker, "record_result")


def test_record_result_rejects_bad_evidence_without_changes(world, monkeypatch):
    app, maker, research, ids, _calls = world
    hyp = add_hypothesis(app, ids, research)
    call(app, ids, research, "focus", {"node_id": hyp, "intent": "measure"})

    def bad(*a):
        raise ValueError("结果中的数字在所引证据里找不到：0.99")

    monkeypatch.setattr(rt.research_evidence, "check", bad)
    with pytest.raises(ValueError, match="0.99"):
        call(
            app,
            ids,
            research,
            "record_result",
            {
                "node_id": hyp,
                "summary": "acc=0.99",
                "evidence": [
                    {"kind": "log", "job_id": "j", "from_line": 1, "to_line": 1}
                ],
                "kill_triggered": "no",
                "confidence": 0.9,
            },
        )
    with maker() as d:
        node = d.get(ResearchNode, hyp)
        assert (
            node.status == "active"
            and node.confidence == 0.5
            and node.evidence_for == []
        )


def test_run_job_binds_focus(world, monkeypatch):
    app, _maker, research, ids, _calls = world
    hyp = add_hypothesis(app, ids, research)
    call(app, ids, research, "focus", {"node_id": hyp, "intent": "train"})
    started = []

    def fake_start(settings, d, project, node, sprint, command, timeout):
        started.append((node.id, command, timeout))
        job = ResearchJob(
            project_id=project.id, node_id=node.id, sprint_id=sprint.id, command=command
        )
        d.add(job)
        d.flush()
        return job

    monkeypatch.setattr(rs, "start_job", fake_start)
    out = call(app, ids, research, "run_job", {"command": "python3 train.py"})
    assert started == [(hyp, "python3 train.py", rs.JOB_MAX_SECONDS)]
    assert out["status"] == "running" and out["job_id"]


def test_research_tools_absent_from_normal_runs(world):
    app, _maker, _research, ids, _calls = world
    names = {t["name"] for t in TOOLS if t.get("research")}
    assert {"focus", "record_result", "end_sprint", "run_job"} <= names
    with pytest.raises(ValueError, match="研究"):
        asyncio.run(
            execute(
                app, ids.owner, "s", "focus", {"node_id": ids.root, "intent": "x"}, "k"
            )
        )


def test_tools_after_end_sprint_rejected(world):
    app, maker, research, ids, _calls = world
    call(
        app,
        ids,
        research,
        "end_sprint",
        {"summary": "split the question", "next_focus": "H1"},
    )
    with maker() as d:
        sprint = d.get(ResearchSprint, ids.sprint)
        assert sprint.status == "ended" and sprint.summary == "split the question"
    with pytest.raises(ValueError, match="本轮已结束"):
        call(app, ids, research, "research_map_read", {})
