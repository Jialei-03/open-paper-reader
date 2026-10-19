import pytest

from backend import research_map as rm
from backend.config import Settings, database
from backend.models import Base, ResearchSprint, User
from backend.research_metrics import metrics


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "metrics.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        project = rm.create_project(d, user.id, "Q?", "", "m")
        d.commit()
        yield d, project
    engine.dispose()


def sprint(d, project, number, role="executor", status="ended"):
    row = ResearchSprint(
        project_id=project.id, number=number, role=role, run_id="r", status=status
    )
    d.add(row)
    d.flush()
    return row


def test_empty_project_gives_zeros(world):
    d, project = world
    m = metrics(d, project)
    assert m["sprints"] == {"executor": 0, "advisor": 0}
    assert m["hard_drift_blocks"] == 0
    assert m["soft_drift_rate"] is None
    assert m["backtrack_latency"] is None
    assert m["abnormal_rate"] is None
    assert m["evidence_count"] == 0
    assert m["tokens_per_supported"] is None


def test_metrics_from_events(world):
    d, project = world
    root = rm.root(d, project)
    s1 = sprint(d, project, 1)
    hyp = rm.add_node(
        d,
        project,
        root.id,
        "hypothesis",
        "H",
        kill_if="k",
        actor="executor",
        sprint_id=s1.id,
    )
    rm.event(
        d,
        project,
        hyp,
        "executor",
        "record_result",
        {"kill_triggered": "unsure"},
        s1.id,
    )
    rm.event(d, project, None, "system", "drift_blocked", {"tool": "bash"}, s1.id)
    s2 = sprint(d, project, 2, status="abnormal")
    s3 = sprint(d, project, 3, role="advisor")
    rm.event(
        d,
        project,
        None,
        "advisor",
        "drift_judged",
        {"sprint_number": 1, "on_track": True},
        s3.id,
    )
    rm.event(
        d,
        project,
        None,
        "advisor",
        "drift_judged",
        {"sprint_number": 2, "on_track": False},
        s3.id,
    )
    rm.update_node(
        d, hyp, status="abandoned", actor="advisor", sprint_id=s3.id, reason="kill"
    )
    supported = rm.add_node(d, project, root.id, "finding", "F", actor="executor")
    supported.status = "supported"
    supported.spent_tokens = 3000
    supported.evidence_for = [{"evidence": [{"kind": "log"}, {"kind": "log"}]}]
    d.flush()
    m = metrics(d, project)
    assert m["sprints"] == {"executor": 2, "advisor": 1}
    assert m["hard_drift_blocks"] == 1
    assert m["soft_drift_rate"] == 0.5
    # Signal in sprint 1, closed in sprint 3: two sprints later.
    assert m["backtrack_latency"] == 2
    assert m["abnormal_rate"] == 0.5
    assert m["evidence_count"] == 2
    assert m["tokens_per_supported"] == 3000
