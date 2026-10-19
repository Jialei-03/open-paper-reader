import pytest
from sqlalchemy import select

from backend import research_map as rm
from backend.config import Settings, database
from backend.models import AgentSession, Base, ResearchEvent, User


@pytest.fixture
def db(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "map.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.commit()
        yield d, user.id
    engine.dispose()


def project_with_root(d, owner):
    project = rm.create_project(d, owner, "Does L2 help?", "", "model-1")
    root = rm.root(d, project)
    return project, root


def test_create_project_makes_root_and_session(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    assert root.kind == "question" and root.title == "Does L2 help?"
    assert root.parent_id is None
    session = d.get(AgentSession, project.session_id)
    assert session.owner == owner and session.title.startswith("研究：")


def test_hypothesis_requires_kill_if(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    with pytest.raises(ValueError, match="kill_if"):
        rm.add_node(d, project, root.id, "hypothesis", "L2 helps", actor="executor")
    node = rm.add_node(
        d,
        project,
        root.id,
        "hypothesis",
        "L2 helps",
        kill_if="gain < 0.5%",
        budget_tokens=1000,
        actor="executor",
    )
    assert node.kill_if == "gain < 0.5%" and node.budget_tokens == 1000


def test_closed_parent_rejected(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    hyp = rm.add_node(
        d, project, root.id, "hypothesis", "H", kill_if="k", actor="executor"
    )
    rm.update_node(d, hyp, status="refuted", actor="executor", reason="failed")
    with pytest.raises(ValueError):
        rm.add_node(d, project, hyp.id, "experiment", "E", actor="executor")
    with pytest.raises(ValueError):
        rm.add_node(d, project, root.id, "theory", "X", actor="executor")


def test_parent_from_another_project_rejected(db):
    d, owner = db
    project, _ = project_with_root(d, owner)
    _, other_root = project_with_root(d, owner)
    with pytest.raises(ValueError):
        rm.add_node(d, project, other_root.id, "question", "Q", actor="executor")


def test_update_writes_event_with_reason(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    hyp = rm.add_node(
        d, project, root.id, "hypothesis", "H", kill_if="k", actor="executor"
    )
    with pytest.raises(ValueError):
        rm.update_node(d, hyp, confidence=0.9, actor="executor", reason="")
    rm.update_node(
        d,
        hyp,
        confidence=0.9,
        doubts=["only one seed"],
        actor="executor",
        sprint_id="s1",
        reason="first run",
    )
    event = d.scalars(
        select(ResearchEvent).where(
            ResearchEvent.node_id == hyp.id, ResearchEvent.action == "update_node"
        )
    ).one()
    assert event.sprint_id == "s1" and event.actor == "executor"
    assert event.detail["reason"] == "first run"
    assert event.detail["before"]["confidence"] == 0.5
    assert event.detail["after"]["confidence"] == 0.9
    assert hyp.doubts == ["only one seed"]


def test_is_live_follows_refuted_ancestor(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    hyp = rm.add_node(
        d, project, root.id, "hypothesis", "H", kill_if="k", actor="executor"
    )
    exp = rm.add_node(d, project, hyp.id, "experiment", "E", actor="executor")
    assert rm.is_live(d, exp)
    rm.update_node(d, hyp, status="refuted", actor="advisor", reason="kill")
    assert not rm.is_live(d, exp)
    assert not rm.is_live(d, hyp)
    assert rm.is_live(d, root)


def test_snapshot_marks_kill_if_and_truncates(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    live = rm.add_node(
        d,
        project,
        root.id,
        "hypothesis",
        "Live hypothesis",
        kill_if="no gain on 3 seeds",
        actor="executor",
    )
    rm.update_node(d, live, doubts=["data is small"], actor="executor", reason="note")
    for n in range(300):
        dead = rm.add_node(
            d,
            project,
            root.id,
            "hypothesis",
            f"Dead end number {n} " + "x" * 60,
            kill_if="k",
            actor="executor",
        )
        rm.update_node(d, dead, status="abandoned", actor="executor", reason="dead")
    text = rm.snapshot(d, project)
    assert len(text) <= 12000
    assert "Live hypothesis" in text
    assert "kill_if: no gain on 3 seeds" in text
    assert "data is small" in text
    assert live.id[:8] in text
    assert "omitted" in text


def test_node_by_prefix_ambiguous(db):
    d, owner = db
    project, root = project_with_root(d, owner)
    assert rm.node_by_prefix(d, project, root.id[:8]).id == root.id
    assert rm.node_by_prefix(d, project, root.id).id == root.id
    with pytest.raises(ValueError):
        rm.node_by_prefix(d, project, "zzzzzzzz")
    with pytest.raises(ValueError):
        rm.node_by_prefix(d, project, root.id[:4])


def test_node_by_prefix_tolerates_invented_suffix(db):
    """The map shows 8 characters; a model may make up the rest of the id."""
    d, owner = db
    project, root = project_with_root(d, owner)
    invented = root.id[:8] + "-0000-0000-0000-000000000000"
    assert rm.node_by_prefix(d, project, invented).id == root.id
