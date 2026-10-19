from types import SimpleNamespace

import pytest

from backend import research_evidence as ev
from backend import research_map as rm
from backend import research_sandbox as rs
from backend.config import Settings, database
from backend.models import Base, ResearchJob, User


@pytest.fixture
def world(tmp_path, monkeypatch):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "ev.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker))
    monkeypatch.setattr(
        ev,
        "pages_of",
        lambda app, owner, file_id: {
            1: "Intro text.",
            3: "We find that dropout of 0.3 works best on this task.",
        },
    )
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        project = rm.create_project(d, user.id, "Q?", "", "m")
        root = rm.root(d, project)

        def job(status="succeeded", text="seed=1\nacc=0.8731\nloss=0.42\n"):
            row = ResearchJob(
                project_id=project.id,
                node_id=root.id,
                sprint_id="s",
                command="python3 train.py",
                status=status,
                log_lines=len(text.splitlines()),
            )
            d.add(row)
            d.flush()
            (rs.logdir(settings, project.id) / f"{row.id}.log").write_text(text)
            return row

        yield app, d, user.id, project, job
    engine.dispose()


def log(job, a, b):
    return {"kind": "log", "job_id": job.id, "from_line": a, "to_line": b}


def test_number_must_appear_in_cited_lines(world):
    app, d, owner, project, job = world
    j = job()
    with pytest.raises(ValueError, match="0.873"):
        ev.check(app, d, owner, project, "准确率 0.873", [log(j, 1, 3)])
    out = ev.check(app, d, owner, project, "准确率 0.8731，loss 0.42", [log(j, 2, 3)])
    assert out[0]["lines"] == ["acc=0.8731", "loss=0.42"]
    assert out[0]["job_id"] == j.id


def test_running_job_rejected(world):
    app, d, owner, project, job = world
    j = job(status="running")
    with pytest.raises(ValueError, match="还没有结束"):
        ev.check(app, d, owner, project, "done", [log(j, 1, 1)])


def test_line_range_out_of_bounds(world):
    app, d, owner, project, job = world
    j = job()
    with pytest.raises(ValueError, match="行号"):
        ev.check(app, d, owner, project, "x", [log(j, 2, 9)])
    with pytest.raises(ValueError, match="行号"):
        ev.check(app, d, owner, project, "x", [log(j, 3, 1)])


def test_job_of_another_project_rejected(world):
    app, d, owner, _project, job = world
    other = rm.create_project(d, owner, "Other?", "", "m")
    j = job()
    with pytest.raises(ValueError, match="作业"):
        ev.check(app, d, owner, other, "x", [log(j, 1, 1)])


def test_cite_quote_must_be_on_page(world):
    app, d, owner, project, _job = world
    file_id = "11111111-1111-1111-1111-111111111111"
    good = {
        "kind": "cite",
        "file_id": file_id,
        "page": 3,
        "quote": "dropout of 0.3 works best",
    }
    out = ev.check(app, d, owner, project, "Prior work: dropout 0.3 is best.", [good])
    assert out[0]["page"] == 3 and "dropout of 0.3 works best" in out[0]["quote"]
    bad = {**good, "quote": "dropout of 0.5 works best"}
    with pytest.raises(ValueError, match="原文"):
        ev.check(app, d, owner, project, "x", [bad])


def test_small_integers_ignored(world):
    app, d, owner, project, job = world
    j = job()
    assert ev.check(app, d, owner, project, "在 3 个种子上 acc=0.8731", [log(j, 2, 2)])


def test_evidence_required(world):
    app, d, owner, project, _job = world
    with pytest.raises(ValueError):
        ev.check(app, d, owner, project, "x", [])


def test_equal_values_match(world):
    app, d, owner, project, job = world
    j = job(text="acc=0.6740\n")
    assert ev.check(app, d, owner, project, "峰值 0.674", [log(j, 1, 1)])
    with pytest.raises(ValueError):
        ev.check(app, d, owner, project, "峰值 0.67", [log(j, 1, 1)])


def test_stated_numbers_need_no_evidence(world):
    app, d, owner, project, job = world
    j = job(text="acc=0.91\n")
    stated = "keep 25% as the test split; kill if the gain is under 0.01"
    assert ev.check(
        app,
        d,
        owner,
        project,
        "25% test split, threshold 0.01, acc=0.91",
        [log(j, 1, 1)],
        stated,
    )


def test_job_id_prefix_accepted(world):
    app, d, owner, project, job = world
    j = job(text="acc=0.91\n")
    invented = j.id[:8] + "-0000-0000-0000-000000000000"
    out = ev.check(
        app,
        d,
        owner,
        project,
        "acc=0.91",
        [{"kind": "log", "job_id": invented, "from_line": 1, "to_line": 1}],
    )
    assert out[0]["job_id"] == j.id
