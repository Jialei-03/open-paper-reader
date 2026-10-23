"""The API publishes an independent branch to a real folder, never its Git."""

import os
import shutil
import stat

import pytest
from sqlalchemy import func, select

from backend import research_locations as locations
from backend import research_map
from backend import research_merge as merge
from backend import research_publish as publish
from backend import research_repo as repo
from backend.models import (
    AgentRun,
    ResearchEvent,
    ResearchMerge,
    ResearchProject,
    ResearchWorkspace,
)
from backend.tests.test_research_merge import apply as apply_preview
from backend.tests.test_research_merge import preview
from backend.tests.test_research_merge import world as managed_world  # noqa: F401

pytestmark = pytest.mark.skipif(not repo.available(), reason="Git required")


@pytest.fixture
def world(managed_world, tmp_path):  # noqa: F811
    w = managed_world
    target = (tmp_path / "real user project").resolve()
    target.mkdir()
    (target / "shared").mkdir()
    (target / "shared/train.py").write_text("a=1\nb=2\nc=3\n")
    repo.git(target, "init", "-q", "-b", "main")
    repo.checkpoint(target, "user's existing repository")
    w.target, w.user_head = target, repo.head(target)
    w.user_index = (target / ".git/index").read_bytes()
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[2])
        workspace.location = {"kind": "local", "path": str(target), "connection_id": ""}
        child = d.get(ResearchProject, w.ids[3])
        parent = research_map.create_project(
            d, child.owner, "original physical research", "", "m"
        )
        parent.workspace_id, parent.status, parent.stage, parent.compute_id = (
            workspace.id,
            "paused",
            "scoping",
            "host",
        )
        child.parent_id, child.compute_id = parent.id, "host"
        d.flush()
        locations.bind(w.settings, workspace, child)
        d.commit()
    return w


def assert_user_git_untouched(w):
    assert repo.head(w.target) == w.user_head
    assert (w.target / ".git/index").read_bytes() == w.user_index


def test_private_fork_preview_and_apply_write_selected_real_file_without_staging_user_git(
    world,
):
    w = world
    source_head = repo.head(w.source)
    row = preview(w, paths=["shared/train.py"])
    assert row["status"] == "preview" and "+a=10" in row["files"][0]["diff"]
    assert (w.target / "shared/train.py").read_text().startswith("a=1\n")
    assert_user_git_untouched(w)
    response = apply_preview(w, row)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "applied"
    assert (w.target / "shared/train.py").read_text() == "a=10\nb=2\nc=3\n"
    assert not (w.target / "shared/new.py").exists()
    assert repo.head(w.source) == source_head
    assert_user_git_untouched(w)
    stamp = (w.target / "shared/train.py").stat().st_mtime_ns
    assert apply_preview(w, row).json()["status"] == "applied"
    assert (w.target / "shared/train.py").stat().st_mtime_ns == stamp


@pytest.mark.parametrize("change", ["contents", "permissions", "root_inode"])
def test_stale_actual_folder_rejects_before_private_main_fast_forward(world, change):
    w = world
    row = preview(w, paths=["shared/train.py"])
    main = repo.head(w.repo)
    if change == "contents":
        (w.target / "shared/train.py").write_text("user edited after preview")
    elif change == "permissions":
        os.chmod(w.target / "shared/train.py", 0o600)
    else:
        moved = w.target.with_name("user renamed old project")
        w.target.rename(moved)
        shutil.copytree(moved, w.target)
    response = apply_preview(w, row)
    assert response.status_code == 409, response.text
    assert repo.head(w.repo) == main
    if change == "contents":
        assert (w.target / "shared/train.py").read_text() == "user edited after preview"
    else:
        assert (w.target / "shared/train.py").read_text().startswith("a=1\n")
    if change == "permissions":
        assert stat.S_IMODE((w.target / "shared/train.py").stat().st_mode) == 0o600
    assert_user_git_untouched(w)


@pytest.mark.parametrize("failure", ["before_write", "lost_ack"])
def test_private_git_receipt_recovers_failed_or_unacknowledged_physical_publish(
    world, monkeypatch, failure
):
    w = world
    row = preview(w, paths=["shared/train.py"])
    before_main = repo.head(w.repo)
    original = publish.publish

    def unavailable(*args, **kwargs):
        if failure == "lost_ack":
            original(*args, **kwargs)
        raise ValueError("publish acknowledgement unavailable")

    monkeypatch.setattr(publish, "publish", unavailable)
    failed = apply_preview(w, row)
    assert failed.status_code == 409, failed.text
    receipt_commit = repo.head(w.repo)
    assert receipt_commit != before_main
    assert merge._committed(w.repo, row["id"]) == receipt_commit
    with w.maker() as d:
        assert d.get(ResearchMerge, row["id"]).status == "preview"
    if failure == "before_write":
        assert (w.target / "shared/train.py").read_text().startswith("a=1\n")
    else:
        assert (w.target / "shared/train.py").read_text().startswith("a=10\n")
        written = (w.target / "shared/train.py").stat().st_mtime_ns
    with w.maker() as d:
        project = d.get(ResearchProject, w.ids[3])
        run = AgentRun(
            owner=project.owner,
            session_id=project.session_id,
            model_config_id="m",
            model="m",
            prompt="research resumed before publish recovery",
            status="running",
        )
        d.add(run)
        d.commit()
        run_id = run.id

    def must_not_publish(*args, **kwargs):
        pytest.fail("recovery must not publish while this research is running")

    monkeypatch.setattr(publish, "publish", must_not_publish)
    pending = (w.target / "shared/train.py").read_bytes()
    rejected = apply_preview(w, row)
    assert rejected.status_code == 409, rejected.text
    assert "当前轮次和实验结束" in rejected.json()["detail"]
    assert (w.target / "shared/train.py").read_bytes() == pending
    assert repo.head(w.repo) == receipt_commit
    with w.maker() as d:
        assert d.get(ResearchMerge, row["id"]).status == "preview"
        d.get(AgentRun, run_id).status = "completed"
        d.commit()
    monkeypatch.setattr(publish, "publish", original)
    recovered = apply_preview(w, row)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["commit_sha"] == receipt_commit
    assert repo.head(w.repo) == receipt_commit
    assert (w.target / "shared/train.py").read_text().startswith("a=10\n")
    if failure == "lost_ack":
        assert (w.target / "shared/train.py").stat().st_mtime_ns == written
    assert_user_git_untouched(w)
    with w.maker() as d:
        assert (
            d.scalar(
                select(func.count(ResearchEvent.id)).where(
                    ResearchEvent.action == "results_merged"
                )
            )
            == 1
        )


def test_published_receipt_can_recover_only_database_while_research_is_running(
    world, monkeypatch
):
    w = world
    row = preview(w, paths=["shared/train.py"])
    mark_applied = merge._mark_applied

    def database_unavailable(*args, **kwargs):
        raise ValueError("database acknowledgement unavailable")

    monkeypatch.setattr(merge, "_mark_applied", database_unavailable)
    failed = apply_preview(w, row)
    assert failed.status_code == 409, failed.text
    commit = repo.head(w.repo)
    written = (w.target / "shared/train.py").stat().st_mtime_ns
    with w.maker() as d:
        project = d.get(ResearchProject, w.ids[3])
        record = d.get(ResearchMerge, row["id"])
        assert record.status == "preview"
        assert merge._published(
            w.settings, d.get(ResearchWorkspace, w.ids[2]), record, commit
        )
        d.add(
            AgentRun(
                owner=project.owner,
                session_id=project.session_id,
                model_config_id="m",
                model="m",
                prompt="research resumed after physical publish",
                status="running",
            )
        )
        d.commit()

    def must_not_publish(*args, **kwargs):
        pytest.fail("a published receipt needs only database recovery")

    monkeypatch.setattr(merge, "_mark_applied", mark_applied)
    monkeypatch.setattr(publish, "publish", must_not_publish)
    recovered = apply_preview(w, row)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["status"] == "applied"
    assert recovered.json()["commit_sha"] == commit
    assert repo.head(w.repo) == commit
    assert (w.target / "shared/train.py").stat().st_mtime_ns == written
    assert_user_git_untouched(w)


def test_memory_is_published_to_real_folder_and_existing_0600_stays_private(world):
    w = world
    name = f"memory/{w.ids[3]}.md"
    (w.target / "memory").mkdir()
    (w.target / name).write_text("previous private notes")
    os.chmod(w.target / name, 0o600)
    row = preview(w, "memory")
    assert (w.target / name).read_text() == "previous private notes"
    response = apply_preview(w, row)
    assert response.status_code == 200, response.text
    assert (w.target / name).read_text() == row["memory_text"]
    assert stat.S_IMODE((w.target / name).stat().st_mode) == 0o600
    assert_user_git_untouched(w)
    [note] = w.client.get(f"{merge.BASE}/workspaces/{w.ids[2]}/memory").json()
    assert note["text"] == row["memory_text"] and note["research_id"] == w.ids[3]


def test_code_publish_preserves_existing_private_permissions(world):
    w = world
    os.chmod(w.target / "shared/train.py", 0o600)
    row = preview(w, paths=["shared/train.py"])
    assert apply_preview(w, row).status_code == 200
    assert stat.S_IMODE((w.target / "shared/train.py").stat().st_mode) == 0o600
    assert_user_git_untouched(w)
