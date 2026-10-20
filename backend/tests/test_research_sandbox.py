import json
import subprocess
from datetime import datetime, timedelta, timezone

import pytest

from backend import research_map as rm
from backend import research_sandbox as rs
from backend.config import Settings, database
from backend.models import Base, ResearchJob, ResearchProject, ResearchSprint, User


class FakeDocker:
    """Records docker commands; answers like the real CLI for the ones used."""

    def __init__(self):
        self.calls = []
        self.containers = {}  # name -> {"running": bool, "exit": int, "logs": str}
        self.up = True
        self.image = True
        # Whether Docker sees the host's workspace (colima shares only $HOME by default).
        self.shared = True

    def __call__(
        self, args, input=None, capture_output=True, text=True, timeout=None, **kw
    ):
        self.calls.append(args)
        out, code = "", 0
        verb = args[1]
        if not self.up:
            return subprocess.CompletedProcess(args, 1, "", "Cannot connect")
        if verb == "info":
            out = "27.0"
        elif verb == "image":
            code = 0 if self.image else 1
        elif verb == "run" and "-d" in args:
            name = args[args.index("--name") + 1]
            self.containers[name] = {"running": True, "exit": 0, "logs": ""}
            out = "cid\n"
        elif verb == "run" and "/opt/ora/probe.py" in args:
            out = json.dumps({"python": "3.11.9", "cpus": 2, "gpus": []}) + "\n"
        elif verb == "run" and "cat" in args:
            spec = args[args.index("--mount") + 1]
            mount = spec.split("source=")[1].split(",target=")[0]
            marker = __import__("pathlib").Path(mount) / ".ora-visible"
            out = marker.read_text() if self.shared and marker.exists() else ""
            code = 0 if out else 1
        elif verb == "run":
            request = json.loads(input)
            out = json.dumps({"result": {"echo": request}}) + "\n"
        elif verb == "inspect":
            name = args[-1]
            if name not in self.containers:
                return subprocess.CompletedProcess(args, 1, "", "No such object")
            c = self.containers[name]
            out = json.dumps({"Running": c["running"], "ExitCode": c["exit"]})
        elif verb == "logs":
            out = self.containers[args[-1]]["logs"]
        elif verb in {"kill", "rm"}:
            if verb == "kill":
                self.containers[args[-1]]["running"] = False
                self.containers[args[-1]]["exit"] = 137
            else:
                self.containers.pop(args[-1], None)
        return subprocess.CompletedProcess(args, code, out, "")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "sandbox.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    docker = FakeDocker()
    monkeypatch.setattr(rs, "run", docker)
    monkeypatch.setattr(rs, "_status_cache", {})
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        project = rm.create_project(d, user.id, "Q?", "", "m")
        root = rm.root(d, project)
        sprint = ResearchSprint(project_id=project.id, number=1, run_id="r")
        d.add(sprint)
        d.commit()
        ids = project.id, root.id, sprint.id
    yield settings, maker, docker, ids
    engine.dispose()


def objects(d, ids):
    project_id, node_id, sprint_id = ids
    return (
        d.get(ResearchProject, project_id),
        d.get(rm.ResearchNode, node_id),
        d.get(ResearchSprint, sprint_id),
    )


def test_pi_call_mounts_project_workdir_without_network(setup):
    settings, _maker, docker, ids = setup
    result = rs.pi_call(settings, ids[0], "bash", {"command": "ls"})
    assert result == {"echo": {"name": "bash", "args": {"command": "ls"}}}
    args = docker.calls[-1]
    assert args[:2] == ["docker", "run"] and "--rm" in args and "-i" in args
    assert args[args.index("--network") + 1] == "none"
    assert "--read-only" in args
    mount = args[args.index("--mount") + 1]
    assert mount == f"type=bind,source={rs.workdir(settings, ids[0])},target=/work"
    assert rs.IMAGE in args


def test_start_job_refuses_over_quota(setup, monkeypatch):
    settings, maker, _docker, ids = setup
    monkeypatch.setattr(rs, "WORKSPACE_BYTES", 10)
    (rs.workdir(settings, ids[0]) / "big.bin").write_bytes(b"x" * 100)
    with maker() as d:
        project, node, sprint = objects(d, ids)
        with pytest.raises(ValueError, match="工作区"):
            rs.start_job(settings, d, project, node, sprint, "python3 train.py", 60)


def test_start_job_runs_detached_with_labels(setup):
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "echo hi", 60)
        d.commit()
        args = docker.calls[-1]
        assert "-d" in args and f"ora.job={job.id}" in args
        assert args[args.index("--network") + 1] == "none"
        assert args[-3:] == ["bash", "-lc", "set -o pipefail; echo hi"]
        assert job.status == "running" and job.container.startswith("ora-job-")


def test_sweep_collects_logs_outside_workdir(setup):
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "echo acc=0.91", 60)
        d.commit()
        job_id, container = job.id, job.container
    docker.containers[container].update(running=False, exit=0, logs="start\nacc=0.91\n")
    rs.sweep(settings, maker)
    with maker() as d:
        job = d.get(ResearchJob, job_id)
        assert job.status == "succeeded" and job.exit_code == 0 and job.log_lines == 2
        assert job.finished_at
        log = rs.logdir(settings, ids[0]) / f"{job_id}.log"
        assert log.read_text() == "start\nacc=0.91\n"
        assert rs.workdir(settings, ids[0]) not in log.parents
        lines = rs.read_log(settings, job, 1, 10)
        assert lines == {"lines": [{"n": 2, "text": "acc=0.91"}], "total": 2}
    assert container not in docker.containers


def test_sweep_times_out_and_kills(setup):
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "sleep 100", 60)
        job.started_at = (
            datetime.now(timezone.utc) - timedelta(seconds=120)
        ).isoformat()
        d.commit()
        job_id, container = job.id, job.container
    rs.sweep(settings, maker)
    with maker() as d:
        job = d.get(ResearchJob, job_id)
        assert job.status == "timeout"
        assert d.get(rm.ResearchNode, ids[1]).spent_job_seconds >= 60
        assert d.get(ResearchProject, ids[0]).spent["job_seconds"] >= 60
    assert ["docker", "kill", container] in docker.calls


def test_sweep_marks_missing_container_lost(setup):
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "echo", 60)
        d.commit()
        job_id = job.id
    docker.containers.clear()
    rs.sweep(settings, maker)
    with maker() as d:
        assert d.get(ResearchJob, job_id).status == "lost"


def test_docker_unavailable_gives_reason(setup):
    settings, _maker, docker, ids = setup
    docker.up = False
    status = rs.docker_status()
    assert status["available"] is False and "Docker" in status["reason"]
    with pytest.raises(ValueError, match="Docker"):
        rs.pi_call(settings, ids[0], "bash", {"command": "ls"})
    rs._status_cache.clear()
    docker.up, docker.image = True, False
    assert "make research-image" in rs.docker_status()["reason"]


def test_workspace_not_shared_is_explained(setup):
    settings, maker, docker, ids = setup
    rs._visible.clear()
    docker.shared = False
    with pytest.raises(ValueError, match="看不到项目工作区"):
        rs.pi_call(settings, ids[0], "bash", {"command": "ls"})
    rs._visible.clear()
    docker.shared = True
    assert rs.pi_call(settings, ids[0], "bash", {"command": "ls"})


def test_sweep_keeps_jobs_when_docker_is_briefly_down(setup):
    """Review #2: a daemon hiccup is not a lost job."""
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "sleep 5", 60)
        d.commit()
        job_id = job.id
    docker.up = False
    rs.sweep(settings, maker)
    with maker() as d:
        assert d.get(ResearchJob, job_id).status == "running"


def test_sweep_kills_job_over_quota(setup, monkeypatch):
    """Review #9: a job that fills the workspace is stopped."""
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "dd", 60)
        d.commit()
        job_id, container = job.id, job.container
    monkeypatch.setattr(rs, "WORKSPACE_BYTES", 10)
    (rs.workdir(settings, ids[0]) / "big.bin").write_bytes(b"x" * 100)
    rs.sweep(settings, maker)
    with maker() as d:
        job = d.get(ResearchJob, job_id)
        assert job.status == "failed"
        assert "配额" in rs.read_log(settings, job, 0, 50)["lines"][-1]["text"]
    assert ["docker", "kill", container] in docker.calls


def test_pi_call_containers_are_named_and_removed_on_timeout(setup, monkeypatch):
    """Review #11: a call that times out does not leave its container running."""
    settings, maker, docker, ids = setup
    original = docker.__call__

    def slow(args, **kw):
        if args[:2] == ["docker", "run"] and "-i" in args:
            raise subprocess.TimeoutExpired(args, 75)
        return original(args, **kw)

    monkeypatch.setattr(rs, "run", slow)
    with pytest.raises(ValueError, match="超时"):
        rs.pi_call(settings, ids[0], "bash", {"command": "sleep 100"})
    removed = [c for c in docker.calls if c[:3] == ["docker", "rm", "-f"]]
    assert removed and removed[-1][-1].startswith("ora-pi-")


def test_stop_project_kills_its_jobs(setup):
    """Review #11: stopping a project stops its experiments."""
    settings, maker, docker, ids = setup
    with maker() as d:
        project, node, sprint = objects(d, ids)
        job = rs.start_job(settings, d, project, node, sprint, "sleep 100", 600)
        d.commit()
        container = job.container
    with maker() as d:
        rs.stop_jobs(settings, d, ids[0])
        d.commit()
    assert ["docker", "kill", container] in docker.calls


def test_a_job_on_another_machine_brings_its_numbers_back_now_and_then(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from backend import research_remote

    settings = Settings(storage=str(tmp_path / "files"), testing=True)
    job = SimpleNamespace(
        id="j1",
        project_id="p1",
        remote={"kind": "ssh", "host": "gpu", "base": "/x"},
        metrics={},
        points=0,
    )
    pulls = []

    def fetch(settings, job, timeout=600):
        pulls.append(timeout)
        with open(rs.rundir(settings, job.project_id, job.id) / "metrics.jsonl", "a") as f:
            f.write(json.dumps({"step": len(pulls), "acc": 0.1 * len(pulls)}) + "\n")

    clock = [1000.0]
    monkeypatch.setattr(research_remote, "fetch_reports", fetch)
    monkeypatch.setattr(rs, "_clock", lambda: clock[0])
    rs._progress(settings, job)
    assert job.points == 1 and job.metrics["acc"] == 0.1
    clock[0] += rs.PULL_EVERY - 1
    rs._progress(settings, job)
    assert len(pulls) == 1
    clock[0] += 1
    rs._progress(settings, job)
    assert len(pulls) == 2 and job.points == 2 and pulls[-1] == 60

    def broken(settings, job, timeout=600):
        raise ValueError("同步文件失败")

    monkeypatch.setattr(research_remote, "fetch_reports", broken)
    clock[0] += rs.PULL_EVERY
    rs._progress(settings, job)
    assert job.points == 2
