"""Experiments run straight on this machine, with no container."""

import time

import pytest

from backend import research_host as rh
from backend import research_map as rm
from backend import research_sandbox as rs
from backend import research_settings as rset
from backend.config import Settings, database
from backend.models import Base, ResearchProject, ResearchSprint, User


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "h.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        p = rm.create_project(d, user.id, "Q", "", "m")
        p.stage, p.compute_id = "experiments", "host"
        d.commit()
        pid = p.id
    yield settings, maker, pid
    engine.dispose()


def _wait_done(settings, d, job, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        rs._sweep_one(settings, d, job)
        if job.status != "running":
            return
        time.sleep(0.2)


def test_this_machine_is_an_environment_by_default(world):
    settings, _, _ = world
    data = rset.load(settings)
    assert [c["id"] for c in data["computes"]][:2] == ["host", "local"]
    assert data["default_compute"] == "host"
    assert rset.compute(settings, "host")["kind"] == "host"


def test_a_job_runs_in_the_workspace_and_reports_through_ora(world):
    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        (rs.workdir(settings, p.id) / "t.py").write_text(
            "import ora\nora.config({'tag': 'x'})\nora.summary({'acc': 0.9})\nprint('hi')\n"
        )
        job = rs.start_job(settings, d, p, node, sprint, "python3 t.py | tail -5", 60)
        assert job.remote["kind"] == "host"
        _wait_done(settings, d, job)
        assert job.status == "succeeded" and job.metrics == {"acc": 0.9}
        assert rs.read_log(settings, job, 0, 50)["lines"][-1]["text"] == "hi"
        assert p.environment["host"]["python"]


def test_a_failure_in_a_pipe_fails_the_job_and_a_kill_stops_it(world):
    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        failing = rs.start_job(settings, d, p, node, sprint, "false | tail -1", 60)
        _wait_done(settings, d, failing)
        assert failing.status == "failed"
        long = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        rs.stop_jobs(settings, d, p.id)
        assert long.status == "failed"
        time.sleep(0.5)
        assert rh.state(long) is rs.GONE


def test_file_tools_work_in_the_workspace(world):
    settings, maker, pid = world
    with maker() as d:
        out = rs.pi_call(settings, pid, "write", {"path": "a.txt", "content": "x"}, d)
        assert "Successfully" in out["content"][0]["text"]
        assert (rs.workdir(settings, pid) / "a.txt").read_text() == "x"


def test_this_machine_is_prepared_by_an_agent_in_its_own_folder(world, monkeypatch):
    from backend import research_environment as re_

    settings, maker, _ = world
    monkeypatch.setattr(re_, "read_config", lambda *a: {"model": "m"})
    with maker() as d:
        user = d.scalars(__import__("sqlalchemy").select(User)).first()
        run = re_.start(settings, d, user.id, "host", "m")
        d.commit()
        assert "虚拟环境" in run.prompt and str(rh.setup_dir(settings)) in run.prompt
        assert "不要" in run.prompt and "系统" in run.prompt
    out = rh.setup_call(
        settings, rset.compute(settings, "host"), "bash", {"command": "pwd"}
    )
    assert out["content"][0]["text"].strip() == str(rh.setup_dir(settings).resolve())
    probes = iter(
        [{"packages": {"numpy": "2"}}, {"packages": {"torch": "2.11"}, "mps": True}]
    )
    monkeypatch.setattr(rh, "probe", lambda s, item: next(probes))
    args = {"python": str(rh.setup_dir(settings) / "venv/bin/python"), "recipe": "r"}
    with pytest.raises(ValueError, match="PyTorch"):
        re_.finish(settings, "host", args)
    assert re_.finish(settings, "host", args)["version"] == 1
    assert rset.compute(settings, "host")["python"] == args["python"]


def test_the_executor_is_told_this_machine_has_an_apple_gpu(world):
    from backend.research_brief import _setting_out

    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        p.environment = {
            "host": {"python": "3.12", "packages": {"torch": "2.11"}, "mps": True}
        }
        assert "mps" in _setting_out(settings, p)


def test_before_its_first_job_the_brief_uses_what_preparing_found(world):
    from backend import research_environment as re_
    from backend.research_brief import _setting_out

    settings, maker, pid = world
    re_.set_state(
        settings,
        "host",
        status="ready",
        python="/x/bin/python",
        probe={
            "python": "3.12",
            "packages": {"torch": "2.14"},
            "mps": True,
            "platform": "macOS-15.5-arm64",
            "cpus": 8,
            "memory_gb": 16.0,
        },
    )
    with maker() as d:
        p = d.get(ResearchProject, pid)
        assert not p.environment
        text = _setting_out(settings, p)
        assert "mps" in text and "torch 2.14" in text
        assert "macOS-15.5-arm64" in text and "8 核" in text and "16 GB" in text


def test_an_agent_stops_its_own_job_and_cannot_kill_by_name(world):
    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        job = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        rs.stop_job(settings, d, job)
        assert job.status == "cancelled"
        assert (
            rs.read_log(settings, job, 0, 50)["lines"][-1]["text"] == rs.CANCELLED_NOTE
        )
        for command in ("pkill -f train.py", "killall python", "kill -9 $(pgrep -f x)"):
            with pytest.raises(ValueError, match="stop_job"):
                rs.pi_call(settings, pid, "bash", {"command": command}, d)
