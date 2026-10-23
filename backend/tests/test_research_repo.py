"""A project's files as a git repository, each research a worktree of it."""

import pytest
from sqlalchemy import select

from backend import research_map as rm
from backend import research_repo as rr
from backend import research_sandbox as rs
from backend import research_workspaces as rw
from backend.config import Settings, database
from backend.models import Base, ResearchSprint, User

pytestmark = pytest.mark.skipif(not rr.available(), reason="no git")


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
        d.flush()
        w = rw.create(d, user.id, "MNIST", "手写数字")
        w.instructions = "只用公开数据"
        p = rm.create_project(d, user.id, "小 CNN 能到 99% 吗", "", "m")
        p.workspace_id = w.id
        d.commit()
        ids = (w.id, p.id)
    yield settings, maker, ids
    engine.dispose()


def _old(settings, pid):
    old = rs._root(settings, pid) / "work"
    old.mkdir(parents=True)
    return old


def test_a_research_moves_into_its_worktree_and_keeps_its_path(world):
    settings, maker, (wid, pid) = world
    old = _old(settings, pid)
    (old / "train.py").write_text("print(1)\n")
    (old / "data").mkdir()
    (old / "data" / "x.csv").write_text("a\n")
    (old / ".gitignore").write_text("outputs/\n")
    (old / "weights.bin").write_bytes(b"0" * (rr.MAX_BYTES + 1))
    rr.settle(settings, maker)

    path = rs.workdir(settings, pid)
    assert path == rr.thread_dir(settings, wid, pid).resolve()
    assert (path / "train.py").read_text() == "print(1)\n"
    assert (path / "data" / "x.csv").exists() and (path / "weights.bin").exists()
    tracked = rr.git(path, "ls-files").stdout.split()
    assert "train.py" in tracked and "AGENTS.md" in tracked
    # Data, and files too large for history, stay out of it.
    assert not any(t.startswith("data/") for t in tracked)
    assert "weights.bin" not in tracked
    assert "outputs/" in (path / ".gitignore").read_text()
    assert "只用公开数据" in (path / "AGENTS.md").read_text()
    assert rr.owner(path) == pid
    assert rr.git(path, "branch", "--show-current").stdout.strip() == rr.branch_of(pid)
    # Once is enough.
    rr.settle(settings, maker)
    assert rr.git(path, "rev-list", "--count", "HEAD").stdout.strip() == "2"


def test_each_round_that_ends_leaves_a_checkpoint(world):
    settings, maker, (wid, pid) = world
    with maker() as d:
        old = ResearchSprint(project_id=pid, number=1, run_id="r0", status="ended")
        d.add(old)
        d.commit()
    rr.settle(settings, maker)
    path = rs.workdir(settings, pid)
    with maker() as d:
        imported = d.scalars(select(ResearchSprint)).one().commit_sha
        assert imported == rr.head(path)
        d.add(
            ResearchSprint(
                project_id=pid,
                number=2,
                run_id="r1",
                status="ended",
                summary="基线 98.9%\n下一步试数据增强",
            )
        )
        d.add(ResearchSprint(project_id=pid, number=3, run_id="r2"))
        d.commit()
    (path / "train.py").write_text("print(2)\n")
    rr.checkpoints(settings, maker)
    with maker() as d:
        rounds = {s.number: s.commit_sha for s in d.scalars(select(ResearchSprint))}
    assert rounds[2] and rounds[2] != imported and rounds[3] == ""
    message = rr.git(path, "log", "-1", "--format=%B").stdout
    assert message.startswith("第 2 轮：基线 98.9%") and "数据增强" in message
    # A round that changed nothing points at the commit it left.
    with maker() as d:
        d.add(ResearchSprint(project_id=pid, number=4, run_id="r3", status="ended"))
        d.commit()
    rr.checkpoints(settings, maker)
    with maker() as d:
        last = d.scalars(select(ResearchSprint).where(ResearchSprint.number == 4)).one()
        assert last.commit_sha == rounds[2]


def test_researches_of_a_project_share_its_repository(world):
    settings, maker, (wid, pid) = world
    with maker() as d:
        user = d.scalars(select(User)).one()
        other = rm.create_project(d, user.id, "BN 稳定吗", "", "m")
        other.workspace_id = wid
        d.commit()
        oid = other.id
    rr.settle(settings, maker)
    a, b = rs.workdir(settings, pid), rs.workdir(settings, oid)
    assert a != b
    branches = rr.git(rr.repo_dir(settings, wid), "branch", "--format=%(refname:short)")
    assert set(branches.stdout.split()) == {"main", rr.branch_of(pid), rr.branch_of(oid)}


def test_without_git_research_keeps_plain_folders(world, monkeypatch):
    settings, maker, (wid, pid) = world
    monkeypatch.setattr(rr, "git_binary", lambda: None)
    rr.settle(settings, maker)
    rr.checkpoints(settings, maker)
    path = rs.workdir(settings, pid)
    assert path == rs._root(settings, pid) / "work" and not path.is_symlink()


def test_a_missing_worktree_falls_back_to_a_plain_folder(world):
    import shutil

    settings, maker, (wid, pid) = world
    rr.settle(settings, maker)
    shutil.rmtree(rr.thread_dir(settings, wid, pid))
    path = rs.workdir(settings, pid)
    assert path.is_dir() and not path.is_symlink()
    # Its branch comes back in a new worktree, with what was committed.
    rr.settle(settings, maker)
    again = rs.workdir(settings, pid)
    assert again.is_symlink() is False and (again / "AGENTS.md").exists()
