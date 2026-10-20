"""Projects that hold researches, and the board drawn from their work."""

import pytest
from sqlalchemy import select

from backend import research_map as rm
from backend import research_stages as st
from backend import research_workspaces as rw
from backend.config import Settings, database
from backend.models import (
    Base,
    ResearchJob,
    ResearchSprint,
    ResearchWorkspace,
    User,
)


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "w.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.commit()
        uid = user.id
    yield maker, uid
    engine.dispose()


def test_researches_from_before_projects_find_a_home(world):
    maker, uid = world
    with maker() as d:
        mine = rm.create_project(d, uid, "Q mine", "", "m")
        evaluation = rm.create_project(d, uid, "Q eval", "", "m", {"auto_decide": True})
        rw.ensure(d, uid)
        homes = {w.kind: w for w in d.scalars(select(ResearchWorkspace))}
        assert mine.workspace_id == homes["research"].id
        assert evaluation.workspace_id == homes["eval"].id
        assert homes["eval"].name == rw.EVAL_NAME
        rw.ensure(d, uid)
        assert len(list(d.scalars(select(ResearchWorkspace)))) == 2


def test_the_overview_counts_what_needs_the_person(world):
    maker, uid = world
    with maker() as d:
        w = rw.create(d, uid, "MNIST", "手写数字")
        talking = rm.create_project(d, uid, "Q1", "", "m")
        talking.workspace_id, talking.stage = w.id, "scoping"
        st.say(d, talking, "human", "想提高准确率")
        st.say(d, talking, "advisor", "基线多少？")
        running = rm.create_project(d, uid, "Q2", "", "m")
        running.workspace_id = w.id
        rw.add_card(d, w, "试试 EMA")
        d.flush()
        row = next(x for x in rw.overview(d, uid) if x["id"] == w.id)
        assert (row["researches"], row["waiting"], row["running"], row["ideas"]) == (
            2,
            1,
            1,
            1,
        )


def test_the_board_shows_researches_their_nodes_and_ideas(world):
    maker, uid = world
    with maker() as d:
        w = rw.create(d, uid, "MNIST")
        p = rm.create_project(d, uid, "Q", "", "m")
        p.workspace_id, p.stage = w.id, "experiments"
        root = rm.root(d, p)
        h1 = rm.add_node(
            d, p, root.id, "hypothesis", "H1", kill_if="k", actor="human", reason="r"
        )
        h2 = rm.add_node(
            d, p, root.id, "hypothesis", "H2", kill_if="k", actor="human", reason="r"
        )
        rm.update_node(d, h2, status="refuted", actor="advisor", reason="no")
        sprint = ResearchSprint(
            project_id=p.id, number=1, run_id="r", role="executor", focus_node_id=h1.id
        )
        d.add(sprint)
        rm.event(d, p, h1, "advisor", "decision_requested", {"proposal": "kill"})
        rw.add_card(d, w, "idea")
        d.add(
            ResearchJob(
                project_id=p.id,
                node_id=h1.id,
                sprint_id="s",
                command="x",
                status="succeeded",
                metrics={"val_acc": 0.98, "final_test_acc": 0.991},
            )
        )
        d.flush()
        cards = {c["title"]: c for c in rw.board(d, w)["cards"]}
        assert cards["Q"]["kind"] == "research" and cards["Q"]["best"] == {
            "name": "final_test_acc",
            "value": 0.991,
        }
        assert cards["H1"]["column"] == "review"  # a decision is asked about it
        assert cards["H2"]["column"] == "dropped"
        assert cards["idea"]["column"] == "triage" and cards["idea"]["movable"]


def test_only_ideas_move_by_hand_and_only_among_their_columns(world):
    maker, uid = world
    with maker() as d:
        w = rw.create(d, uid, "MNIST")
        card = rw.add_card(d, w, "idea")
        rw.move_card(d, card, "todo")
        assert card.status == "todo"
        with pytest.raises(ValueError, match="开始研究"):
            rw.move_card(d, card, "running")
        card.project_id = "p"
        with pytest.raises(ValueError, match="研究本身"):
            rw.move_card(d, card, "dropped")


def test_a_project_needs_a_name(world):
    maker, uid = world
    with maker() as d:
        with pytest.raises(ValueError, match="名称"):
            rw.create(d, uid, "  ")
        w = rw.create(d, uid, "x")
        rw.update(d, w, {"instructions": "只用公开数据", "archived": True})
        assert w.instructions == "只用公开数据" and w.archived


def test_every_agent_reads_the_project_instructions(world, tmp_path):
    from backend.research_brief import executor_brief, scoping_brief

    maker, uid = world
    with maker() as d:
        w = rw.create(d, uid, "MNIST")
        w.instructions = "只用公开数据，不要用预训练模型"
        p = rm.create_project(d, uid, "Q", "", "m")
        p.workspace_id = w.id
        st.say(d, p, "human", "hi")
        assert "只用公开数据" in executor_brief(d, p, 1)
        assert "只用公开数据" in scoping_brief(d, p, 1)
