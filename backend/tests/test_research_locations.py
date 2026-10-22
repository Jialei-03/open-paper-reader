"""Physical cwd and private snapshots; real local tools, simulated SSH argv."""

import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from backend import research_locations as loc
from backend import research_map as rm
from backend import research_remote as remote
from backend import research_repo as repo
from backend import research_sandbox as sandbox
from backend import research_settings
from backend import research_workspaces as rw
from backend.config import Settings, database
from backend.models import (
    AgentRun,
    Base,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
    User,
)


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "app/db.sqlite"),
        storage=str(tmp_path / "app/files"),
        testing=True,
        mode="local",
    )
    (tmp_path / "app").mkdir()
    folder = tmp_path / "real project 测试"
    folder.mkdir()
    (folder / "train.py").write_text("print('initial')\n")
    if repo.available():
        repo.git(folder, "init", "-q", "-b", "main")
        repo.checkpoint(folder, "user history")
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="user", password="unused")
        d.add(user)
        d.flush()
        workspace = rw.create(
            d,
            user.id,
            "Physical",
            location={"kind": "local", "path": str(folder), "connection_id": ""},
        )
        project = rm.create_project(d, user.id, "Try it", "", "m")
        project.workspace_id, project.compute_id = workspace.id, "local"
        d.flush()
        loc.bind(settings, workspace, project)
        d.commit()
        ids = user.id, workspace.id, project.id
    app = FastAPI()

    def auth(request: Request):
        return {"id": ids[0]}

    loc.install_location_routes(app, settings, lambda: None, auth, lambda a: None, None)
    with TestClient(app) as client:
        yield SimpleNamespace(
            settings=settings, maker=maker, folder=folder, ids=ids, client=client
        )
    engine.dispose()


def test_local_binding_validates_existing_folder_without_creating_missing_path(world):
    w = world
    canonical = loc.validate_location(
        w.settings, {"kind": "local", "path": str(w.folder / ".." / w.folder.name)}
    )
    assert canonical == {
        "kind": "local",
        "path": str(w.folder.resolve()),
        "connection_id": "",
    }
    missing = w.folder / "not-created"
    with pytest.raises(ValueError, match="不存在"):
        loc.validate_location(w.settings, {"kind": "local", "path": str(missing)})
    assert not missing.exists()
    if (w.folder / ".git").exists():
        with pytest.raises(ValueError, match="Git"):
            loc.validate_location(
                w.settings, {"kind": "local", "path": str(w.folder / ".git")}
            )
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        assert loc.compute_for(w.settings, workspace) == "host"
        assert (
            loc.execution_compute(w.settings, d, d.get(ResearchProject, w.ids[2]))[
                "kind"
            ]
            == "host"
        )


def test_folder_browser_is_read_only_and_returns_only_directories(world):
    w = world
    (w.folder / "nested").mkdir()
    result = w.client.get(
        "/api/v1/research/folders", params={"kind": "local", "path": str(w.folder)}
    )
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["path"] == str(w.folder) and data["parent"] == str(w.folder.parent)
    assert "nested" in {entry["name"] for entry in data["entries"]}
    assert "train.py" not in {entry["name"] for entry in data["entries"]}
    assert not (w.folder / "location.json").exists()


def test_pi_file_and_shell_tools_use_real_local_folder(world):
    w = world
    with w.maker() as d:
        response = sandbox.pi_call(
            w.settings,
            w.ids[2],
            "write",
            {"path": "created.py", "content": "print('real cwd')\n"},
            d,
        )
        assert not response.get("isError")
        result = sandbox.pi_call(w.settings, w.ids[2], "bash", {"command": "pwd"}, d)
    assert str(w.folder) in result["content"][0]["text"]
    assert (w.folder / "created.py").read_text() == "print('real cwd')\n"
    assert sandbox.workdir(w.settings, w.ids[2]) == w.folder


@pytest.mark.skipif(not repo.available(), reason="Git required")
def test_checkpoint_uses_private_mirror_without_touching_user_git(world):
    w = world
    user_head = repo.head(w.folder)
    before_index = (w.folder / ".git/index").read_bytes()
    (w.folder / "data").mkdir()
    (w.folder / "data/private.csv").write_text("large data remains outside Git")
    with w.maker() as d:
        p, workspace = d.get(ResearchProject, w.ids[2]), d.get(
            ResearchWorkspace, w.ids[1]
        )
        private = repo.thread_dir(w.settings, workspace.id, p.id)
        assert repo.adopt(w.settings, workspace, p) == private
        baseline = repo.head(private)
        assert repo.git(private, "show", "HEAD:train.py").stdout == "print('initial')\n"
        (w.folder / "train.py").write_text("print('second')\n")
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", status="ended")
        assert repo.commit_round(w.settings, p, sprint) != baseline
        assert repo.git(private, "show", "HEAD:train.py").stdout == "print('second')\n"
        assert not (private / "data/private.csv").exists()
        # Deleted source files disappear from subsequent private snapshots.
        (w.folder / "train.py").unlink()
        assert repo.commit_round(w.settings, p, sprint)
        assert "train.py" not in repo.git(private, "ls-files").stdout.splitlines()
    assert (
        repo.head(w.folder) == user_head
        and (w.folder / ".git/index").read_bytes() == before_index
    )
    assert (w.folder / "data/private.csv").exists()


def test_host_job_runs_in_real_directory_with_reports_kept_private(world, monkeypatch):
    w = world
    with w.maker() as d:
        p = d.get(ResearchProject, w.ids[2])
        p.environment = {"host": {"probed": True}}
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        job = sandbox.start_job(
            w.settings, d, p, rm.root(d, p), sprint, "pwd > actual-cwd.txt", 10
        )
        d.commit()
        for _ in range(50):
            state = sandbox._away(job).state(job)
            if state is not sandbox.GONE and not state.get("Running"):
                break
            time.sleep(0.02)
        assert (w.folder / "actual-cwd.txt").read_text().strip() == str(w.folder)
        assert job.compute_id == "host" and job.remote["kind"] == "host"
        assert not (w.folder / "runs").exists()


def _ssh(w):
    key = w.folder.parent / "test key.pem"
    key.write_text("not a real key; argv tests only")
    item = research_settings.check_compute(
        {
            "id": "lab",
            "kind": "ssh",
            "name": "Lab",
            "host": "user@gpu",
            "port": 2202,
            "identity_file": str(key),
            "remote_dir": "~/ora",
        }
    )
    data = research_settings.load(w.settings)
    data["computes"].append(item)
    research_settings.save(w.settings, data)
    return item


def test_ssh_validation_browsing_and_connections_use_safe_batch_argv(
    world, monkeypatch
):
    w = world
    item = _ssh(w)
    calls = []

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        request = json.loads(kwargs["input"])
        return subprocess.CompletedProcess(
            args,
            0,
            json.dumps(
                {"path": "/srv/project with spaces", "parent": "/srv", "entries": []}
            )
            + "\n",
            "",
        )

    monkeypatch.setattr(sandbox, "run", fake)
    location = loc.validate_location(
        w.settings,
        {"kind": "ssh", "path": "/srv/project with spaces", "connection_id": "lab"},
    )
    assert location == {
        "kind": "ssh",
        "path": "/srv/project with spaces",
        "connection_id": "lab",
    }
    args, kwargs = calls[-1]
    assert "BatchMode=yes" in args and args[args.index("-p") + 1] == "2202"
    assert args[args.index("-i") + 1] == item["identity_file"]
    assert (
        "/srv/project with spaces" not in args[-1]
    )  # path travels as JSON, never shell text
    result = w.client.post(
        "/api/v1/research/connections",
        json={
            "name": "New",
            "host": "gpu-box",
            "port": 2202,
            "identity_file": item["identity_file"],
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["port"] == 2202
    assert len(w.client.get("/api/v1/research/connections").json()) == 2
    for host in ("-oProxyCommand=bad", "host;touch /tmp/bad", "host\nnext"):
        with pytest.raises(ValueError):
            loc.ssh_args({"host": host})


def test_remote_tools_and_jobs_use_selected_folder_and_keep_control_data_elsewhere(
    world, monkeypatch
):
    w = world
    item = _ssh(w)
    calls = []

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        if args[0] == "rsync":
            return subprocess.CompletedProcess(args, 0, "", "")
        script = args[-1]
        if "echo $!" in script:
            return subprocess.CompletedProcess(args, 0, "12345\n", "")
        if "tools.py" in script:
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps(
                    {"result": {"content": [{"type": "text", "text": "remote cwd"}]}}
                )
                + "\n",
                "",
            )
        return subprocess.CompletedProcess(args, 0, "yes\n", "")

    monkeypatch.setattr(sandbox, "run", fake)
    remote._prepared.clear()
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        workspace.location = {
            "kind": "ssh",
            "path": "/srv/real folder",
            "connection_id": "lab",
        }
        p = d.get(ResearchProject, w.ids[2])
        p.compute_id = (
            "host"  # stale compute cannot turn a remote workspace into a local one
        )
        loc.bind(w.settings, workspace, p)
        sandbox.pi_call(w.settings, p.id, "bash", {"command": "pwd"}, d)
        tool = next(args for args, kw in calls if "tools.py" in args[-1])
        assert "cd '/srv/real folder'" in tool[-1]
        assert "2202" in tool and item["identity_file"] in tool
        compute = loc.execution_compute(w.settings, d, p)
        assert (
            p.compute_id == "lab"
        )  # snapshots and future forks inherit the actual machine
        job = ResearchJob(
            id="test-job", project_id=p.id, node_id="n", sprint_id="s", command="pwd"
        )
        remote.start(w.settings, d, compute, p, job)
        launch = calls[-1][0]
        assert "cd '/srv/real folder'" in launch[-1]
        assert (
            job.remote["workdir"] == "/srv/real folder" and job.remote["port"] == 2202
        )
        assert job.remote["base"] != job.remote["workdir"]
        assert not any(
            args[0] == "rsync" and args[-1].endswith("/real folder/")
            for args, _ in calls
        )


@pytest.mark.skipif(not repo.available(), reason="Git required")
def test_fork_of_external_source_is_independent_and_does_not_rebind_original(world):
    w = world
    with w.maker() as d:
        workspace, parent = d.get(ResearchWorkspace, w.ids[1]), d.get(
            ResearchProject, w.ids[2]
        )
        repo.adopt(w.settings, workspace, parent)
        sha = repo.head(repo.thread_dir(w.settings, workspace.id, parent.id))
        child = rm.create_project(d, parent.owner, "Fork", "", "m")
        child.workspace_id, child.parent_id, child.compute_id = (
            workspace.id,
            parent.id,
            "host",
        )
        d.flush()
        fork = repo.fork_thread(w.settings, workspace, parent, child, sha)
        loc.bind(w.settings, workspace, child)
        sandbox.pi_call(
            w.settings,
            child.id,
            "write",
            {"path": "fork-only.txt", "content": "independent"},
            d,
        )
        assert (fork / "fork-only.txt").read_text() == "independent"
        assert not (w.folder / "fork-only.txt").exists()
        assert sandbox.workdir(w.settings, parent.id) == w.folder


def test_missing_bound_directory_is_not_recreated_and_binding_writes_are_idempotent(
    world,
):
    w = world
    workspace = SimpleNamespace(
        id=w.ids[1],
        location={"kind": "local", "path": str(w.folder), "connection_id": ""},
    )
    project = SimpleNamespace(id=w.ids[2], parent_id=None)
    with ThreadPoolExecutor(max_workers=4) as pool:
        values = list(
            pool.map(lambda _: loc.bind(w.settings, workspace, project), range(12))
        )
    assert all(value["path"] == str(w.folder) for value in values)
    assert not list(loc.binding_path(w.settings, project.id).parent.glob("*.tmp"))
    moved = w.folder.with_name("moved by user")
    w.folder.rename(moved)
    with pytest.raises(ValueError, match="不存在"):
        sandbox.workdir(w.settings, project.id)
    assert not w.folder.exists()


def test_offline_ssh_directory_returns_actionable_error_without_saving_connection(
    world, monkeypatch
):
    w = world
    _ssh(w)

    def timeout(args, **kwargs):
        raise subprocess.TimeoutExpired(args, 25)

    monkeypatch.setattr(sandbox, "run", timeout)
    result = w.client.get(
        "/api/v1/research/folders", params={"kind": "ssh", "connection_id": "lab"}
    )
    assert result.status_code == 409 and "SSH" in result.json()["detail"]
    before = research_settings.load(w.settings)
    result = w.client.post(
        "/api/v1/research/connections", json={"name": "Offline", "host": "offline"}
    )
    assert result.status_code == 409
    assert research_settings.load(w.settings) == before


def test_shared_physical_workspace_admits_one_research_writer_and_ignores_independent_forks(
    world,
):
    w = world
    from backend import research_worker

    with w.maker() as d:
        workspace, first = d.get(ResearchWorkspace, w.ids[1]), d.get(
            ResearchProject, w.ids[2]
        )
        second = rm.create_project(d, first.owner, "second", "", "m")
        second.workspace_id = workspace.id
        third = rm.create_project(d, first.owner, "fork", "", "m")
        third.workspace_id, third.parent_id = workspace.id, first.id
        d.flush()
        run = AgentRun(
            owner=first.owner,
            session_id=first.session_id,
            model_config_id="m",
            model="m",
            prompt="busy",
            status="running",
        )
        d.add(run)
        d.flush()
        assert loc.busy_workspace(d, workspace, exclude_session_id=second.session_id)
        assert not loc.busy_workspace(d, workspace, exclude_session_id=first.session_id)
        assert not research_worker._schedulable(d, second, "active")
        run.status = "completed"
        d.add(
            AgentRun(
                owner=third.owner,
                session_id=third.session_id,
                model_config_id="m",
                model="m",
                prompt="independent",
                status="running",
            )
        )
        d.flush()
        assert not loc.busy_workspace(
            d, workspace, exclude_session_id=second.session_id
        )
        assert research_worker._schedulable(d, second, "active")


@pytest.mark.skipif(not repo.available(), reason="Git required")
def test_plain_user_folder_never_gets_git_metadata_from_checkpoint(world):
    import shutil

    w = world
    shutil.rmtree(w.folder / ".git")
    with w.maker() as d:
        workspace, p = d.get(ResearchWorkspace, w.ids[1]), d.get(
            ResearchProject, w.ids[2]
        )
        repo.adopt(w.settings, workspace, p)
        (w.folder / "train.py").write_text("new user file content")
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", status="ended")
        assert repo.commit_round(w.settings, p, sprint)
    assert not (w.folder / ".git").exists()
    assert sorted(path.name for path in w.folder.iterdir()) == ["train.py"]


def test_external_ssh_job_fetches_reports_and_bounded_code_without_copying_datasets(
    world, monkeypatch
):
    w = world
    item = _ssh(w)
    calls = []

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(sandbox, "run", fake)
    job = SimpleNamespace(
        id="job",
        project_id=w.ids[2],
        remote={
            "host": item["host"],
            "port": item["port"],
            "identity_file": item["identity_file"],
            "base": "~/ora/job-data",
            "workdir": "/srv/real folder",
        },
    )
    remote.fetch_back(w.settings, job)
    assert len(calls) == 2
    reports, snapshot = (entry[0] for entry in calls)
    assert reports[-2].endswith("/runs/job/")
    assert snapshot[-2] == "user@gpu:'/srv/real folder/'"
    assert "--max-size=20971520" in snapshot
    assert "--exclude=data/" in snapshot and "--exclude=*.pt" in snapshot
    assert "2202" in snapshot[snapshot.index("-e") + 1]
    assert all("--delete" not in args for args, _ in calls)


def test_research_header_reports_fork_actual_cwd_without_changing_workspace_origin(
    world,
):
    w = world
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        parent = d.get(ResearchProject, w.ids[2])
        assert loc.research_location(w.settings, workspace, parent)["path"] == str(
            w.folder
        )
        child = SimpleNamespace(id=str(uuid4()), parent_id=parent.id, compute_id="host")
        expected = str(repo.thread_dir(w.settings, workspace.id, child.id))
        assert loc.research_location(w.settings, workspace, child) == {
            "kind": "local",
            "path": expected,
            "connection_id": "",
        }
        item = _ssh(w)
        workspace.location = {
            "kind": "ssh",
            "path": "/srv/source",
            "connection_id": item["id"],
        }
        child.compute_id = item["id"]
        actual = loc.research_location(w.settings, workspace, child)
        assert actual == {
            "kind": "ssh",
            "path": item["remote_dir"] + "/" + child.id + "/work",
            "connection_id": item["id"],
        }
        assert loc.location_for(w.settings, workspace)["path"] == "/srv/source"
