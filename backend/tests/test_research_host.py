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
    # This machine only: Docker is not offered.
    assert [c["id"] for c in data["computes"]] == ["host"]
    assert data["default_compute"] == "host"
    assert rset.compute(settings, "host")["kind"] == "host"


def test_the_docker_entry_of_earlier_versions_is_no_longer_listed(world):
    settings, _, _ = world
    rset.save(
        settings,
        {
            "computes": [{"id": "host", "name": "本机", "kind": "host"}, dict(rset.LOCAL)],
            "default_compute": "local",
            "tracker": {"kind": "none", "project": "p"},
        },
    )
    data = rset.load(settings)
    assert [c["id"] for c in data["computes"]] == ["host"]
    assert data["default_compute"] == "host"
    # A project that ran in it still finds it.
    assert rset.compute(settings, "local")["kind"] == "docker"


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


def test_an_environment_is_checked_not_prepared(world, monkeypatch):
    from backend import research_environment as re_

    settings, _, _ = world
    monkeypatch.setattr(rh, "probe", lambda s, item: {"packages": {"numpy": "2"}})
    st = re_.check(settings, "host")
    assert st["status"] == "connected" and st["probe"]["packages"] == {"numpy": "2"}

    def down(s, item):
        raise ValueError("no route")

    monkeypatch.setattr(rh, "probe", down)
    st = re_.check(settings, "host")
    assert st["status"] == "disconnected" and "no route" in st["error"]
    # What the last good check found is kept.
    assert st["probe"]["packages"] == {"numpy": "2"}


def test_the_ssh_connections_come_from_the_ssh_config(tmp_path):
    from backend import research_environment as re_

    (tmp_path / "more").write_text("Host lab2\n  HostName 10.0.0.2\n")
    config = tmp_path / "config"
    config.write_text(
        "Host *\n  ServerAliveInterval 30\n"
        "Host han5 han5-alias\n  HostName han5.example.edu\n  User leslie\n"
        "Include more\n"
        "Host gpu-?\n  User x\n"
    )
    hosts = re_.ssh_hosts(config)
    assert [h["name"] for h in hosts] == ["han5", "han5-alias", "lab2"]
    assert hosts[0] == {
        "name": "han5",
        "hostname": "han5.example.edu",
        "user": "leslie",
    }
    assert re_.ssh_hosts(tmp_path / "missing") == []


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
            "chip": "Apple M5 Pro",
        },
    )
    with maker() as d:
        p = d.get(ResearchProject, pid)
        assert not p.environment
        text = _setting_out(settings, p)
        assert "mps" in text and "torch 2.14" in text
        assert "macOS-15.5-arm64" in text and "8 核" in text and "16 GB" in text
        assert "芯片：Apple M5 Pro" in text


def test_a_chip_the_probe_could_not_name_is_unknown(world):
    from backend.research_brief import _setting_out

    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        p.environment = {"host": {"python": "3.12", "cpus": 4}}
        assert "芯片：未知" in _setting_out(settings, p)


def test_the_probe_names_this_machines_chip():
    import json
    import subprocess
    import sys

    out = subprocess.run(
        [sys.executable, str(rh.ORA_DIR / "probe.py")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    info = json.loads(out.stdout.strip().splitlines()[-1])
    assert "chip" in info
    if sys.platform == "darwin":
        assert info["chip"]


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


def test_a_running_job_shows_its_numbers_before_it_ends(world):
    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        (rs.workdir(settings, p.id) / "t.py").write_text(
            "import os, time, ora\n"
            "for step in range(2):\n"
            "    ora.log({'loss': 1.0 / (step + 1)}, step=step)\n"
            "while not os.path.exists('go'):\n"
            "    time.sleep(0.05)\n"
            "ora.summary({'loss': 0.25})\n"
        )
        job = rs.start_job(settings, d, p, node, sprint, "python3 t.py | tail -1", 60)
        end = time.time() + 10
        while job.points < 2 and time.time() < end:
            rs._sweep_one(settings, d, job)
            time.sleep(0.1)
        assert job.status == "running"
        assert job.points == 2 and job.metrics["loss"] == 0.5
        status = rs.job_status(job)
        assert status["points"] == 2 and status["metrics"]["loss"] == 0.5
        (rs.workdir(settings, p.id) / "go").write_text("")
        _wait_done(settings, d, job)
        assert job.status == "succeeded" and job.metrics["loss"] == 0.25


def _sprint(d, p):
    sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
    d.add(sprint)
    d.flush()
    return rm.root(d, p), sprint


def _until(maker, settings, job_id, status, seconds=10):
    """Sweeps as the scheduler does until the job reaches `status`."""
    from backend.models import ResearchJob

    end = time.time() + seconds
    while time.time() < end:
        rs.sweep(settings, maker)
        with maker() as d:
            if d.get(ResearchJob, job_id).status == status:
                return
        time.sleep(0.1)
    raise AssertionError(f"{job_id} never became {status}")


def test_jobs_on_this_machine_run_one_at_a_time(world):
    from backend.models import ResearchJob

    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node, sprint = _sprint(d, p)
        work = rs.workdir(settings, p.id)
        hold = "while [ ! -e go ]; do sleep 0.05; done"
        first = rs.start_job(settings, d, p, node, sprint, hold, 60)
        second = rs.start_job(settings, d, p, node, sprint, "echo second", 60)
        third = rs.start_job(settings, d, p, node, sprint, "echo third", 60)
        assert first.status == "running"
        assert second.status == "queued" and not second.remote
        assert third.status == "queued"
        status = rs.job_status(third, d)
        assert status["queue_position"] == 2 and "依次运行" in status["hint"]
        assert rs.read_log(settings, second, 0, 10) == {"lines": [], "total": 0}
        d.commit()
        ids = first.id, second.id, third.id
    # Still waiting: the first holds the machine.
    rs.sweep(settings, maker)
    with maker() as d:
        assert d.get(ResearchJob, ids[1]).status == "queued"
    (work / "go").write_text("")
    _until(maker, settings, ids[1], "succeeded")
    _until(maker, settings, ids[2], "succeeded")
    with maker() as d:
        jobs = [d.get(ResearchJob, i) for i in ids]
        assert jobs[0].status == "succeeded"
        # Each started after the one before it ended, and its time counts from then.
        assert jobs[1].started_at >= jobs[0].finished_at
        assert jobs[2].started_at >= jobs[1].finished_at
        assert rs.read_log(settings, jobs[2], 0, 10)["lines"][-1]["text"] == "third"


def test_stopping_the_research_cancels_its_queued_jobs(world):
    settings, maker, pid = world
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node, sprint = _sprint(d, p)
        running = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        queued = rs.start_job(settings, d, p, node, sprint, "echo never", 60)
        dropped = rs.start_job(settings, d, p, node, sprint, "echo never", 60)
        # stop_job takes one out of the queue.
        rs.stop_job(settings, d, dropped)
        assert dropped.status == "cancelled"
        assert rs.job_status(queued, d)["queue_position"] == 1
        rs.stop_jobs(settings, d, p.id, rs.PAUSED_NOTE)
        assert running.status == "failed"
        assert queued.status == "cancelled" and not queued.remote
        assert rs.read_log(settings, queued, 0, 10)["lines"][-1]["text"] == rs.QUEUED_NOTE
        d.commit()
    # Nothing is left to start.
    rs.sweep(settings, maker)
    with maker() as d:
        from backend.models import ResearchJob

        assert d.get(ResearchJob, queued.id).status == "cancelled"


def test_this_machine_may_be_set_to_run_two_at_once(world):
    settings, maker, pid = world
    data = rset.load(settings)
    data["computes"][0]["concurrency"] = 2
    rset.update(settings, {"computes": data["computes"]})
    assert rset.compute(settings, "host")["concurrency"] == 2
    with pytest.raises(ValueError, match="同时运行"):
        rset.update(settings, {"computes": [{**data["computes"][0], "concurrency": 99}]})
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node, sprint = _sprint(d, p)
        a = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        b = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        c = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        assert [j.status for j in (a, b, c)] == ["running", "running", "queued"]
        rs.stop_jobs(settings, d, p.id)


def test_run_job_waits_from_when_a_queued_job_starts(world, monkeypatch):
    from backend import research_tools as rt
    from backend.models import ResearchJob

    settings, maker, pid = world
    monkeypatch.setattr(rt, "WAIT_POLL", 0.05)
    with maker() as d:
        p = d.get(ResearchProject, pid)
        node, sprint = _sprint(d, p)
        busy = rs.start_job(settings, d, p, node, sprint, "sleep 30", 60)
        job = rs.start_job(settings, d, p, node, sprint, "echo done", 60)
        d.commit()
        # Nothing starts it: it is still queued when the wait ends, and says so.
        monkeypatch.setattr(rt, "WAIT_MAX", 0.3)
        out = rt._wait(settings, d, job, 5)
        assert out["status"] == "queued" and out["queue_position"] == 1
        assert "排队" in out["hint"]
        with maker() as other:
            rs.stop_job(settings, other, other.get(ResearchJob, busy.id))
            other.commit()
        rs.sweep(settings, maker)
        monkeypatch.setattr(rt, "WAIT_MAX", 10)
        # The sweeper picks it up; the wait then covers its own running time.
        import threading

        def sweeping():
            for _ in range(40):
                rs.sweep(settings, maker)
                time.sleep(0.05)

        t = threading.Thread(target=sweeping)
        t.start()
        out = rt._wait(settings, d, job, 5)
        t.join()
        assert out["status"] == "succeeded" and out["lines"][-1]["text"] == "done"


def test_the_executor_is_told_experiments_here_run_in_turn(world):
    from backend.research_brief import _setting_out

    settings, maker, pid = world
    with maker() as d:
        assert "依次运行" in _setting_out(settings, d.get(ResearchProject, pid))
