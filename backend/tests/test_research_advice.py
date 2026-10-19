import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend import research_map as rm
from backend.agent_tools import execute
from backend.config import Settings, database
from backend.models import (
    Base,
    ResearchEvent,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    User,
)


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "advice.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker))
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        project = rm.create_project(d, user.id, "Does L2 help?", "", "m")
        root = rm.root(d, project)
        hyp = rm.add_node(
            d,
            project,
            root.id,
            "hypothesis",
            "Moderate L2 helps",
            kill_if="no gain on 3 seeds",
            actor="executor",
        )
        executor = ResearchSprint(project_id=project.id, number=1, run_id="r1")
        advisor = ResearchSprint(
            project_id=project.id, number=2, run_id="r2", role="advisor"
        )
        d.add_all([executor, advisor])
        d.commit()
        ids = SimpleNamespace(
            owner=user.id,
            project=project.id,
            root=root.id,
            hyp=hyp.id,
            executor=executor.id,
            advisor=advisor.id,
        )
    yield app, maker, ids
    engine.dispose()


def advise(app, ids, args, role="advisor", sprint=None):
    research = {
        "project_id": ids.project,
        "sprint_id": sprint or (ids.advisor if role == "advisor" else ids.executor),
        "role": role,
    }
    return asyncio.run(
        execute(app, ids.owner, "s", "advise", args, "k", True, research=research)
    )


def verdict(node, kind, **extra):
    return {"node_id": node, "verdict": kind, "reason": "because", **extra}


def actions(maker, action):
    with maker() as d:
        return list(
            d.scalars(select(ResearchEvent).where(ResearchEvent.action == action))
        )


def test_kill_closes_node_and_blocks_executor_focus(world):
    app, maker, ids = world
    with maker() as d:
        d.get(ResearchSprint, ids.executor).focus_node_id = ids.hyp
        d.commit()
    out = advise(
        app, ids, {"verdicts": [verdict(ids.hyp, "kill")], "assessment": "dead end"}
    )
    assert out["applied"] == 1
    with maker() as d:
        node = d.get(ResearchNode, ids.hyp)
        assert node.status == "abandoned"
    research = {
        "project_id": ids.project,
        "sprint_id": ids.executor,
        "role": "executor",
    }
    with pytest.raises(ValueError):
        asyncio.run(
            execute(
                app,
                ids.owner,
                "s",
                "bash",
                {"command": "ls"},
                "k",
                True,
                research=research,
            )
        )
    assert actions(maker, "drift_blocked")[-1].detail["reason"] == "closed_focus"
    assert actions(maker, "advice")[0].detail["verdict"] == "kill"


def test_pivot_creates_hypothesis_under_parent(world):
    app, maker, ids = world
    advise(
        app,
        ids,
        {
            "verdicts": [
                verdict(
                    ids.hyp,
                    "pivot",
                    new_hypothesis={
                        "title": "Feature scaling matters more",
                        "kill_if": "no change after scaling",
                    },
                )
            ]
        },
    )
    with maker() as d:
        assert d.get(ResearchNode, ids.hyp).status == "parked"
        new = d.scalars(
            select(ResearchNode).where(
                ResearchNode.title == "Feature scaling matters more"
            )
        ).one()
        assert new.parent_id == ids.root and new.kill_if == "no change after scaling"


def test_pivot_without_kill_if_skipped(world):
    app, maker, ids = world
    out = advise(
        app,
        ids,
        {"verdicts": [verdict(ids.hyp, "pivot", new_hypothesis={"title": "X"})]},
    )
    assert out["applied"] == 0 and out["skipped"] == 1
    assert actions(maker, "advice_skipped")


def test_ask_human_sets_waiting(world):
    app, maker, ids = world
    advise(app, ids, {"verdicts": [verdict(ids.hyp, "ask_human")]})
    with maker() as d:
        assert d.get(ResearchProject, ids.project).status == "waiting"
        assert d.get(ResearchNode, ids.hyp).status == "open"
    [request] = actions(maker, "decision_requested")
    assert request.detail["node_id"] == ids.hyp


def test_auto_decide_applies_ask_human(world):
    app, maker, ids = world
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        p.budget = {**p.budget, "auto_decide": True}
        d.commit()
    advise(
        app,
        ids,
        {"verdicts": [verdict(ids.hyp, "ask_human", proposal="kill")]},
    )
    with maker() as d:
        assert d.get(ResearchProject, ids.project).status == "active"
        assert d.get(ResearchNode, ids.hyp).status == "abandoned"
    assert actions(maker, "auto_decided")


def test_auto_decide_asked_twice_about_a_node_waits_like_a_person_would(world):
    """With nobody to answer, asking again about the same node means it is waiting for a
    person: the run ends blocked instead of continuing on its own until the budget runs out."""
    app, maker, ids = world
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        p.budget = {**p.budget, "auto_decide": True}
        d.commit()
    ask = {"verdicts": [verdict(ids.hyp, "ask_human", reason="need followup.csv")]}
    advise(app, ids, ask)
    with maker() as d:
        assert d.get(ResearchProject, ids.project).status == "active"
        later = ResearchSprint(
            project_id=ids.project, number=4, run_id="r4", role="advisor"
        )
        d.add(later)
        d.commit()
        later_id = later.id
    advise(app, ids, ask, sprint=later_id)
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        assert (p.status, p.end_reason) == ("finished", "blocked")
    [waiting] = actions(maker, "input_needed")
    assert "need followup.csv" in waiting.detail["summary"]


def test_unknown_node_skipped_others_applied(world):
    app, maker, ids = world
    out = advise(
        app,
        ids,
        {"verdicts": [verdict("deadbeef-0000", "kill"), verdict(ids.hyp, "invest")]},
    )
    assert {k: out[k] for k in ("applied", "skipped", "concluded")} == {
        "applied": 1,
        "skipped": 1,
        "concluded": False,
    }
    assert "deadbeef" in out["notes"][0]
    with maker() as d:
        assert any("加注" in doubt for doubt in d.get(ResearchNode, ids.hyp).doubts)


def test_drift_judgments_recorded(world):
    app, maker, ids = world
    advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "drift": [{"sprint_number": 1, "on_track": False, "note": "tried GBDT"}],
        },
    )
    [judged] = actions(maker, "drift_judged")
    assert judged.detail == {
        "sprint_number": 1,
        "on_track": False,
        "note": "tried GBDT",
    }


def test_advisor_cannot_run_bash(world):
    app, maker, ids = world
    research = {"project_id": ids.project, "sprint_id": ids.advisor, "role": "advisor"}
    with pytest.raises(ValueError, match="导师"):
        asyncio.run(
            execute(
                app,
                ids.owner,
                "s",
                "bash",
                {"command": "ls"},
                "k",
                True,
                research=research,
            )
        )
    with pytest.raises(ValueError, match="导师"):
        asyncio.run(
            execute(
                app,
                ids.owner,
                "s",
                "add_node",
                {
                    "parent_id": ids.root,
                    "kind": "question",
                    "title": "x",
                    "reason": "y",
                },
                "k",
                True,
                research=research,
            )
        )


def test_executor_cannot_advise(world):
    app, maker, ids = world
    with pytest.raises(ValueError, match="导师"):
        advise(app, ids, {"verdicts": [verdict(ids.hyp, "kill")]}, role="executor")


def test_conclude_finishes_project(world):
    app, maker, ids = world
    with maker() as d:
        node = d.get(ResearchNode, ids.hyp)
        node.evidence_for = [{"summary": "acc=0.9", "evidence": [{"kind": "log"}]}]
        d.commit()
    out = advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "conclude": {"status": "concluded", "summary": "moderate L2 is best"},
        },
    )
    assert out["concluded"] is True
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        assert p.status == "finished" and p.end_reason == "concluded"
        assert d.get(ResearchNode, ids.root).status == "supported"
        assert d.get(ResearchSprint, ids.advisor).status == "ended"


def test_a_no_answer_ends_refuted_whatever_the_status_says(world):
    """A yes/no question answered no is refuted: the answer, not the label, decides."""
    app, maker, ids = world
    with maker() as d:
        node = d.get(ResearchNode, ids.hyp)
        node.evidence_for = [{"summary": "acc=0.688", "evidence": [{"kind": "log"}]}]
        d.commit()
    advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "conclude": {
                "status": "concluded",
                "answer_to_question": "no",
                "summary": "No: leakage",
            },
        },
    )
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        assert p.end_reason == "refuted"
        assert d.get(ResearchNode, ids.root).status == "refuted"


def test_killing_the_question_itself_says_to_conclude_instead(world):
    """A skipped verdict tells the advisor why, so it does not repeat it until the budget ends."""
    app, _maker, ids = world
    out = advise(app, ids, {"verdicts": [verdict(ids.root, "kill")]})
    assert out["skipped"] == 1
    assert "conclude" in out["notes"][0] and "answer_to_question" in out["notes"][0]


def test_failing_verdict_skipped_rest_applied(world):
    """Review #7: a pivot that cannot be made does not lose the other verdicts."""
    app, maker, ids = world
    with maker() as d:
        node = d.get(ResearchNode, ids.root)
        node.status = "supported"  # its children can no longer get siblings
        d.commit()
    out = advise(
        app,
        ids,
        {
            "verdicts": [
                verdict(
                    ids.hyp, "pivot", new_hypothesis={"title": "X", "kill_if": "k"}
                ),
                verdict(ids.hyp, "invest"),
            ]
        },
    )
    assert out["applied"] == 1 and out["skipped"] == 1


def test_root_cannot_be_killed(world):
    """Review #8: closing the root would leave nothing to work on."""
    app, maker, ids = world
    out = advise(app, ids, {"verdicts": [verdict(ids.root, "kill")]})
    assert out["skipped"] == 1
    with maker() as d:
        assert d.get(ResearchNode, ids.root).status == "open"


def test_advise_does_not_revive_a_stopped_project(world):
    """Review #6: a stop wins over an advisor still finishing."""
    app, maker, ids = world
    with maker() as d:
        d.get(ResearchProject, ids.project).status = "finished"
        d.commit()
    advise(app, ids, {"verdicts": [verdict(ids.hyp, "ask_human")]})
    with maker() as d:
        assert d.get(ResearchProject, ids.project).status == "finished"


def test_conclude_needs_recorded_evidence(world):
    """A project ends on results recorded on its map, not on what the advisor read."""
    app, maker, ids = world
    out = advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "conclude": {"status": "concluded", "summary": "looks answered"},
        },
    )
    assert out["concluded"] is False
    with maker() as d:
        assert d.get(ResearchProject, ids.project).status == "active"
        rejected = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "conclude_rejected")
        ).one()
        assert "record_result" in rejected.detail["why"]


def test_advisor_reestimates_value(world):
    app, maker, ids = world
    advise(
        app, ids, {"verdicts": [verdict(ids.hyp, "continue", value="low", cost="high")]}
    )
    with maker() as d:
        node = d.get(ResearchNode, ids.hyp)
        assert node.value == "low" and node.cost == "high"


def test_blocked_waits_for_input(world):
    """Nothing can move until a person provides something: say what, and wait."""
    app, maker, ids = world
    out = advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "conclude": {
                "status": "blocked",
                "summary": "/work/data/second.csv is missing",
            },
        },
    )
    assert out["concluded"] is False
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        assert p.status == "waiting"
        request = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "input_needed")
        ).one()
        assert "second.csv" in request.detail["summary"]


def test_blocked_ends_an_evaluation_run(world):
    app, maker, ids = world
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        p.budget = {**p.budget, "auto_decide": True}
        d.commit()
    advise(
        app,
        ids,
        {
            "verdicts": [verdict(ids.hyp, "continue")],
            "conclude": {"status": "blocked", "summary": "missing"},
        },
    )
    with maker() as d:
        p = d.get(ResearchProject, ids.project)
        assert p.status == "finished" and p.end_reason == "blocked"
