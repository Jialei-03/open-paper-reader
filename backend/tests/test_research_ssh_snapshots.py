"""SSH transfer is isolated; Git history and merge publishing use real files."""

import shutil
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from backend import research_branches as branches
from backend import research_locations as locations
from backend import research_merge as merge
from backend import research_publish as publish
from backend import research_remote as remote
from backend import research_repo as repo
from backend.models import AgentRun, ResearchProject, ResearchSprint, ResearchWorkspace
from backend.tests.test_research_locations import _ssh, world  # noqa: F401

pytestmark = pytest.mark.skipif(not repo.available(), reason="Git required")


@pytest.mark.parametrize("transfer", ["pull", "job_fetch"])
def test_ssh_fork_deletions_survive_transfer_sealed_history_and_selected_merge(
    world, monkeypatch, tmp_path, transfer  # noqa: F811
):
    w = world
    item = _ssh(w)
    (w.folder / "remove.py").write_text("old file\n")
    (w.folder / "change.py").write_text("before\n")
    repo.checkpoint(w.folder, "user baseline")
    user_head = repo.head(w.folder)
    user_index = (w.folder / ".git/index").read_bytes()
    remote_fork = tmp_path / "simulated remote fork"
    snapshots = []

    def snapshot(_settings, _item, path, dest, timeout=60):
        source = w.folder if path == "/srv/user project" else remote_fork
        assert Path(dest).resolve() != w.folder.resolve()
        snapshots.append((path, Path(dest), timeout))
        # Deliberately copy dependencies too: the shared bounded importer must
        # still enforce exclusions independently of the SSH rsync filters.
        shutil.copytree(
            source, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git")
        )

    monkeypatch.setattr(remote, "snapshot_pull", snapshot)
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        workspace.location = {
            "kind": "ssh",
            "path": "/srv/user project",
            "connection_id": item["id"],
        }
        parent = d.get(ResearchProject, w.ids[2])
        parent.compute_id, parent.status = item["id"], "paused"
        repo.adopt(w.settings, workspace, parent)
        run = AgentRun(
            owner=parent.owner,
            session_id=parent.session_id,
            model_config_id="m",
            model="test",
            prompt="read source",
            status="completed",
        )
        d.add(run)
        d.flush()
        first = ResearchSprint(
            project_id=parent.id,
            number=1,
            role="scoping",
            run_id=run.id,
            status="ended",
        )
        d.add(first)
        d.flush()
        assert branches.capture_round(w.settings, d, parent, first)
        d.commit()
        child = branches.fork(
            w.settings,
            d,
            parent,
            branches.ForkInput(
                sprint_id=first.id,
                expected_commit=first.commit_sha,
                change="Remove obsolete code and revise the implementation",
                client_id=uuid4(),
            ),
        )
        work = repo.thread_dir(w.settings, workspace.id, child.id)
        locations.bind(w.settings, workspace, child)
        git_link = (work / ".git").read_bytes()
        shutil.copytree(work, remote_fork, ignore=shutil.ignore_patterns(".git"))
        (remote_fork / "remove.py").unlink()
        (remote_fork / "new.py").write_text("new file\n")
        (remote_fork / "change.py").write_text("after\n")
        for name in ("data/cache.csv", ".venv/dependency.py", "weights.pt"):
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("retain local cache\n")
            other = remote_fork / name
            other.parent.mkdir(parents=True, exist_ok=True)
            other.write_text("do not import remote dependency\n")
        large = remote_fork / "large.bin"
        with large.open("wb") as handle:
            handle.truncate(repo.MAX_BYTES + 1)

        compute = locations.execution_compute(w.settings, d, child)
        assert compute["kind"] == "ssh" and not compute.get("workspace_path")
        remote_cwd = remote._work(compute, child.id)
        if transfer == "pull":
            remote.pull(w.settings, compute, child.id, small=True)
        else:
            fetched = []
            monkeypatch.setattr(
                remote, "fetch_reports", lambda *args: fetched.append(True)
            )
            remote.fetch_back(
                w.settings,
                SimpleNamespace(
                    id="job",
                    project_id=child.id,
                    remote={"host": item["host"], "base": remote._base(item, child.id)},
                ),
            )
            assert fetched == [True]
        assert snapshots[-1][0] == remote_cwd
        assert not (work / "remove.py").exists()
        assert (work / "new.py").read_text() == "new file\n"
        assert (work / "change.py").read_text() == "after\n"
        assert (work / ".git").read_bytes() == git_link
        for name in ("data/cache.csv", ".venv/dependency.py", "weights.pt"):
            assert (work / name).read_text() == "retain local cache\n"
        assert not (work / "large.bin").exists()

        run = AgentRun(
            owner=child.owner,
            session_id=child.session_id,
            model_config_id="m",
            model="test",
            prompt="execute fork",
            status="completed",
        )
        d.add(run)
        d.flush()
        ended = ResearchSprint(
            project_id=child.id,
            number=1,
            role="executor",
            run_id=run.id,
            status="ended",
        )
        d.add(ended)
        d.flush()
        assert branches.capture_round(w.settings, d, child, ended)
        assert repo.git(
            work, "cat-file", "-e", f"{ended.commit_sha}:remove.py", check=False
        ).returncode
        assert (
            repo.git(work, "show", f"{ended.commit_sha}:new.py").stdout == "new file\n"
        )
        assert (
            repo.git(work, "show", f"{ended.commit_sha}:change.py").stdout == "after\n"
        )
        assert child.compute_id == item["id"]
        assert (w.folder / "remove.py").read_text() == "old file\n"
        assert (w.folder / "change.py").read_text() == "before\n"

        # Exercise actual preview/three-way merge/publish. Only the transport is
        # replaced; the target manifest and atomic file transaction are real.
        monkeypatch.setattr(
            publish,
            "_call",
            lambda _s, _w, packet: publish.transaction({**packet, "root": str(w.folder)}),
        )
        row = merge.preview(d, w.settings, workspace, child, "code")
        assert set(row.paths) == {"remove.py", "new.py", "change.py"}
        assert row.preview["target_location"]["path"] == "/srv/user project"
        removal = next(f for f in row.preview["files"] if f["path"] == "remove.py")
        assert "-old file" in removal["diff"]
        merge.apply(
            d, w.settings, workspace, child, row,
            row.expected_main_commit, row.expected_source_commit,
        )
        assert not (w.folder / "remove.py").exists()
        assert (w.folder / "new.py").read_text() == "new file\n"
        assert (w.folder / "change.py").read_text() == "after\n"
        assert repo.head(w.folder) == user_head
        assert (w.folder / ".git/index").read_bytes() == user_index


def test_remote_snapshot_refuses_a_bound_local_user_directory(world, monkeypatch):  # noqa: F811
    w = world
    monkeypatch.setattr(
        remote, "snapshot_pull", lambda *args, **kw: pytest.fail("must not transfer")
    )
    with pytest.raises(repo.GitError, match="用户目录"):
        repo.snapshot_remote_worktree(w.settings, {}, w.ids[2], "/remote")
    assert (w.folder / "train.py").read_text() == "print('initial')\n"
