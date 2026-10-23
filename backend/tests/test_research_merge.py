"""Real local Git, isolated SQLite, and no model or network calls."""

from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from backend import research_map as rm
from backend import research_merge as merge
from backend import research_repo as rr
from backend import research_workspaces as rw
from backend.config import Settings, database
from backend.models import (
    AgentRun,
    Base,
    ResearchEvent,
    ResearchJob,
    ResearchMerge,
    ResearchProject,
    ResearchWorkspace,
    User,
)

pytestmark = pytest.mark.skipif(not rr.available(), reason="no Git")


@pytest.fixture
def world(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "db.sqlite"),
        storage=str(tmp_path / "files"),
        testing=True,
        mode="local",
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="alice", password="unused")
        other = User(username="bob", password="unused")
        d.add_all([user, other])
        d.flush()
        workspace = rw.create(d, user.id, "合并试验")
        project = rm.create_project(d, user.id, "准确率能提升吗", "", "m")
        project.workspace_id, project.status, project.stage = (
            workspace.id,
            "finished",
            "done",
        )
        project.end_reason = "concluded"
        project.conclusion = {"summary": "基线从 98% 提升到 99%", "accepted": True}
        root = rm.root(d, project)
        job = ResearchJob(
            project_id=project.id,
            node_id=root.id,
            sprint_id="old",
            command="python train.py",
            status="succeeded",
        )
        d.add(job)
        d.flush()
        root.evidence_for = [
            {
                "summary": "重复验证",
                "evidence": [
                    {
                        "kind": "log",
                        "job_id": job.id,
                        "from_line": 1,
                        "to_line": 2,
                        "lines": ["accuracy=0.99"],
                    }
                ],
            }
        ]
        d.commit()
        repo = rr.ensure_repo(settings, workspace)
        (repo / "shared" / "train.py").write_text("a=1\nb=2\nc=3\n")
        rr.checkpoint(repo, "baseline")
        source = rr.adopt(settings, workspace, project)
        (source / "shared" / "train.py").write_text("a=10\nb=2\nc=3\n")
        (source / "shared" / "new.py").write_text("print('new')\n")
        rr.checkpoint(source, "research result")
        ids = (user.id, other.id, workspace.id, project.id, job.id)
    app = FastAPI()

    def db():
        with maker() as d:
            yield d

    def auth(request: Request):
        return {"id": request.headers.get("X-Owner", ids[0])}

    def owned(d, model, id, a):
        item = d.get(model, id)
        if item is None or item.owner != a["id"]:
            raise HTTPException(404, "Not found")
        return item

    merge.install_merge_routes(app, settings, db, auth, lambda a: None, owned)
    with TestClient(app) as client:
        yield SimpleNamespace(
            settings=settings,
            maker=maker,
            ids=ids,
            repo=repo,
            source=source,
            client=client,
        )
    engine.dispose()


def preview(w, kind="code", **body):
    response = w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merge-preview", json={"kind": kind, **body}
    )
    assert response.status_code == 200, response.text
    return response.json()


def apply(w, row):
    return w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merges/{row['id']}/apply",
        json={
            key: row[key] for key in ("expected_main_commit", "expected_source_commit")
        },
    )


def test_fork_uses_exact_checkpoint_not_latest_source_or_main(world):
    w = world
    selected = rr.head(w.source)
    (w.source / "shared" / "train.py").write_text("newer research\n")
    rr.checkpoint(w.source, "later")
    (w.repo / "shared" / "main.txt").write_text("later main\n")
    rr.checkpoint(w.repo, "later main")
    child = SimpleNamespace(id=str(uuid4()))
    with w.maker() as d:
        p, workspace = d.get(ResearchProject, w.ids[3]), d.get(
            ResearchWorkspace, w.ids[2]
        )
        fork = rr.fork_thread(w.settings, workspace, p, child, selected)
        assert rr.head(fork) == selected
        assert (fork / "shared" / "train.py").read_text().startswith("a=10")
        assert not (fork / "shared" / "main.txt").exists()
        assert rr.legacy_dir(w.settings, child.id).resolve() == fork.resolve()
        assert rr.fork_thread(w.settings, workspace, p, child, selected) == fork
        before = rr.head(w.source)
        rr.remove_thread(w.settings, workspace, child)
        assert (
            not fork.exists() and not rr.legacy_dir(w.settings, child.id).is_symlink()
        )
        assert rr.head(w.source) == before


def test_fork_rejects_commit_outside_source_and_never_reuses_child_branch(world):
    w = world
    (w.repo / "main-only.txt").write_text("main only")
    rr.checkpoint(w.repo, "main-only")
    child = SimpleNamespace(id=str(uuid4()))
    with w.maker() as d:
        p, workspace = d.get(ResearchProject, w.ids[3]), d.get(
            ResearchWorkspace, w.ids[2]
        )
        with pytest.raises(rr.GitError, match="不属于"):
            rr.fork_thread(w.settings, workspace, p, child, rr.head(w.repo))
        rr.git(w.repo, "branch", rr.branch_of(child.id), "main")
        with pytest.raises(rr.GitError, match="分支已经存在"):
            rr.fork_thread(w.settings, workspace, p, child, rr.head(w.source))
        assert not rr.thread_dir(w.settings, workspace.id, child.id).exists()


def test_code_preview_isolated_and_apply_only_selected_paths_idempotently(world):
    w = world
    before = rr.head(w.repo)
    row = preview(w, paths=["shared/train.py"])
    assert row["status"] == "preview" and row["conflicts"] == []
    assert [f["path"] for f in row["files"]] == ["shared/train.py"]
    assert "+a=10" in row["files"][0]["diff"]
    assert (
        rr.head(w.repo) == before
        and "a=1\n" in (w.repo / "shared/train.py").read_text()
    )
    done = apply(w, row)
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "applied"
    assert (w.repo / "shared/train.py").read_text().startswith("a=10")
    assert not (w.repo / "shared/new.py").exists()
    commit = rr.head(w.repo)
    assert apply(w, row).json()["commit_sha"] == commit
    assert rr.head(w.repo) == commit
    with w.maker() as d:
        assert (
            d.scalar(
                select(func.count(ResearchEvent.id)).where(
                    ResearchEvent.action == "results_merged"
                )
            )
            == 1
        )
        assert d.get(ResearchProject, w.ids[3]).merged["code"]["merge_id"] == row["id"]
    assert not [
        p
        for p in rr.home(w.settings, w.ids[2]).iterdir()
        if p.name.startswith("merge-")
    ]


def test_three_way_merge_preserves_independent_main_change(world):
    w = world
    (w.repo / "shared/train.py").write_text("a=1\nb=2\nc=30\n")
    rr.checkpoint(w.repo, "main improvement")
    row = preview(w, paths=["shared/train.py"])
    response = apply(w, row)
    assert response.status_code == 200, response.text
    assert (w.repo / "shared/train.py").read_text() == "a=10\nb=2\nc=30\n"


def test_code_merge_preserves_deletion_and_non_utf8_file_bytes(world):
    w = world
    (w.source / "shared/train.py").unlink()
    content = b"caf\xe9\n"
    (w.source / "shared/latin.txt").write_bytes(content)
    rr.checkpoint(w.source, "delete and latin content")
    row = preview(w, paths=["shared/train.py", "shared/latin.txt"])
    assert apply(w, row).json()["status"] == "applied"
    assert not (w.repo / "shared/train.py").exists()
    assert (w.repo / "shared/latin.txt").read_bytes() == content


def test_overlarge_selection_is_rejected_before_creating_temp_worktree(
    world, monkeypatch
):
    w = world
    before = rr.head(w.repo)
    monkeypatch.setattr(merge, "SELECTION_BYTES", 4)
    result = w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merge-preview", json={"kind": "code"}
    )
    assert result.status_code == 409 and "40 MB" in result.text
    assert rr.head(w.repo) == before
    assert not [
        p
        for p in rr.home(w.settings, w.ids[2]).iterdir()
        if p.name.startswith("merge-")
    ]


def test_conflict_has_details_leaves_main_source_intact_and_can_cancel(world):
    w = world
    (w.repo / "shared/train.py").write_text("a=100\nb=2\nc=3\n")
    rr.checkpoint(w.repo, "incompatible main")
    before = (
        rr.head(w.repo),
        rr.head(w.source),
        (w.repo / "shared/train.py").read_text(),
    )
    row = preview(w, paths=["shared/train.py"])
    assert row["status"] == "conflict"
    assert row["conflicts"][0]["path"] == "shared/train.py"
    assert "<<<<<<<" in row["conflicts"][0]["diff"]
    assert apply(w, row).status_code == 409
    assert (
        rr.head(w.repo),
        rr.head(w.source),
        (w.repo / "shared/train.py").read_text(),
    ) == before
    cancelled = w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merges/{row['id']}/cancel"
    )
    assert cancelled.json()["status"] == "cancelled"
    # A fresh selection can merge the independent result despite the other conflict.
    safe = preview(w, paths=["shared/new.py"])
    assert apply(w, safe).json()["status"] == "applied"


def test_conflicted_full_preview_still_lists_files_for_user_selection(world):
    w = world
    (w.repo / "shared/train.py").write_text("a=100\nb=2\nc=3\n")
    rr.checkpoint(w.repo, "conflicting main")
    row = preview(w)
    assert row["status"] == "conflict"
    assert set(file["path"] for file in row["files"]) == {
        "shared/train.py",
        "shared/new.py",
    }


@pytest.mark.parametrize("changed", ["main", "source", "dirty", "ignored"])
def test_apply_rejects_stale_or_dirty_main_without_losing_files(world, changed):
    w = world
    row = preview(w)
    if changed == "main":
        (w.repo / "fresh.txt").write_text("keep main")
        rr.checkpoint(w.repo, "new main")
    elif changed == "source":
        (w.source / "fresh.txt").write_text("keep source")
        rr.checkpoint(w.source, "new source")
    elif changed == "dirty":
        (w.repo / "shared/train.py").write_text("unsaved main")
    else:
        (w.repo / "data").mkdir()
        (w.repo / "data/local.csv").write_text("private ignored file")
    main, source = rr.head(w.repo), rr.head(w.source)
    assert apply(w, row).status_code == 409
    assert (rr.head(w.repo), rr.head(w.source)) == (main, source)
    if changed == "dirty":
        assert (w.repo / "shared/train.py").read_text() == "unsaved main"
    if changed == "ignored":
        assert (w.repo / "data/local.csv").read_text() == "private ignored file"


def test_memory_preview_requires_confirmation_and_sources_and_is_committed_only_on_apply(
    world,
):
    w = world
    row = preview(w, "memory")
    assert w.ids[3] in row["memory_text"] and w.ids[4] in row["memory_text"]
    assert "accuracy=0.99" in row["memory_text"]
    memory_url = f"{merge.BASE}/workspaces/{w.ids[2]}/memory"
    assert w.client.get(memory_url).json() == []
    assert apply(w, row).json()["status"] == "applied"
    [note] = w.client.get(memory_url).json()
    assert note["research_id"] == w.ids[3] and note["text"] == row["memory_text"]
    # Uncommitted filesystem edits never enter lead/research context.
    (w.repo / row["paths"][0]).write_text("unreviewed content")
    assert rr.committed_memory(w.settings, w.ids[2])[0]["text"] == row["memory_text"]
    records = w.client.get(f"{merge.BASE}/workspaces/{w.ids[2]}/merges").json()
    assert (
        records[0]["question"] == "准确率能提升吗" and records[0]["status"] == "applied"
    )


def test_memory_apply_rejects_changed_evidence_even_with_same_git_heads(world):
    w = world
    row = preview(w, "memory")
    with w.maker() as d:
        p = d.get(ResearchProject, w.ids[3])
        p.conclusion = {**p.conclusion, "summary": "revised after preview"}
        d.commit()
    assert apply(w, row).status_code == 409
    assert rr.committed_memory(w.settings, w.ids[2]) == []


def test_ui_lists_all_35_memories_in_full_and_can_page_without_model_context_budget(
    world, monkeypatch
):
    w = world
    bodies = {
        f"memory/{index:02}成果.md": f"# 已确认成果 {index}\n" + "证据充分。" * 700
        for index in range(35)
    }
    for path, body in bodies.items():
        (w.repo / path).write_text(body)
    rr.checkpoint(w.repo, "35 confirmed memories")
    commit = rr.head(w.repo)
    with w.maker() as d:
        d.add_all(
            [
                ResearchMerge(
                    owner=w.ids[0],
                    workspace_id=w.ids[2],
                    project_id=w.ids[3],
                    kind="memory",
                    status="applied",
                    expected_main_commit=commit,
                    expected_source_commit=rr.head(w.source),
                    paths=[path],
                    preview={},
                    commit_sha=commit,
                )
                for path in bodies
            ]
        )
        d.commit()
    context = rr.committed_memory(w.settings, w.ids[2])
    assert (
        len(context) <= 20 and sum(len(r["text"].encode()) for r in context) <= 80_000
    )
    calls = []
    original = rr.git

    def counted(cwd, *args, **kwargs):
        calls.append(args[0])
        return original(cwd, *args, **kwargs)

    monkeypatch.setattr(rr, "git", counted)
    url = f"{merge.BASE}/workspaces/{w.ids[2]}/memory"
    response = w.client.get(url)
    assert response.status_code == 200, response.text
    notes = response.json()
    assert len(notes) == 35 and {note["path"]: note["text"] for note in notes} == bodies
    assert all(
        note["commit_sha"] == note["merge_commit_sha"] == commit for note in notes
    )
    assert calls == ["rev-parse", "ls-tree", "cat-file"]
    all_notes, cursor = [], ""
    while True:
        page = w.client.get(url, params={"limit": 7, "after": cursor})
        assert page.status_code == 200 and len(page.json()) <= 7
        all_notes.extend(page.json())
        cursor = page.headers.get("X-Next-Cursor", "")
        if not cursor:
            break
    assert len(all_notes) == 35 and {n["path"]: n["text"] for n in all_notes} == bodies


def test_ui_body_commit_keeps_manual_revision_separate_from_original_merge(world):
    w = world
    row = preview(w, "memory")
    done = apply(w, row).json()
    merge_commit = done["commit_sha"]
    path = row["paths"][0]
    updated = (
        row["memory_text"]
        + "\n补充的实验条件：仅限固定数据划分。\n"
        + "补充证据" * 9_000
    )
    (w.repo / path).write_text(updated)
    rr.checkpoint(w.repo, "manual memory revision")
    actual_commit = rr.head(w.repo)
    assert actual_commit != merge_commit
    # The UI still shows the full confirmed file even when it exceeds context size.
    assert len(updated.encode()) > 40_000
    assert rr.committed_memory(w.settings, w.ids[2]) == []
    (w.repo / path).write_text("uncommitted draft must not enter UI")
    [note] = w.client.get(f"{merge.BASE}/workspaces/{w.ids[2]}/memory").json()
    assert note["text"] == updated
    assert (
        note["commit_sha"] == actual_commit and note["merge_commit_sha"] == merge_commit
    )
    with w.maker() as d:
        assert d.get(ResearchMerge, row["id"]).commit_sha == merge_commit


def test_memory_keeps_original_fork_evidence_and_applicability(world):
    w = world
    parent, original = str(uuid4()), str(uuid4())
    with w.maker() as d:
        p = d.get(ResearchProject, w.ids[3])
        p.parent_id, p.forked_from = parent, {"number": 2, "commit": "a" * 40}
        p.background = "仅在固定数据划分下验证"
        p.conclusion = {**p.conclusion, "answer": "yes", "note": "尚未验证外部分布"}
        root = rm.root(d, p)
        root.evidence_for = [{**root.evidence_for[0], "source_research_id": original}]
        d.commit()
    row = preview(w, "memory")
    text = row["memory_text"]
    for value in (
        parent,
        original,
        "a" * 40,
        rr.head(w.source),
        "仅在固定数据划分下验证",
        "尚未验证外部分布",
        "yes",
    ):
        assert value in text


@pytest.mark.parametrize("scenario", ["count", "bytes", "types"])
def test_committed_memory_is_bounded_and_reads_regular_utf8_blobs_only(
    world, monkeypatch, scenario
):
    w = world
    folder = w.repo / "memory"
    if scenario == "count":
        for index in range(25):
            (folder / f"{index:02}.md").write_text("finding\n")
    elif scenario == "bytes":
        for index in range(4):
            (folder / f"{index:02}.md").write_text("x" * 39_900)
    else:
        outside = w.repo.parent / "outside.txt"
        outside.write_text("external content must never enter memory")
        (folder / "link.md").symlink_to(outside)
        (folder / "invalid.md").write_bytes(b"\xff")
        (folder / "binary.md").write_bytes(b"a\0b")
        (folder / "large.md").write_text("x" * 40_001)
        (folder / "regular.md").write_text("reviewed finding")
    rr.checkpoint(w.repo, "memory fixture")
    rows = rr.committed_memory(w.settings, w.ids[2])
    assert len(rows) <= 20 and sum(len(r["text"].encode()) for r in rows) <= 80_000
    if scenario == "count":
        assert len(rows) == 20
    elif scenario == "bytes":
        assert len(rows) == 2
    else:
        assert [r["path"] for r in rows] == ["memory/regular.md"]
    monkeypatch.setattr(rr, "git_binary", lambda: None)
    assert rr.committed_memory(w.settings, w.ids[2]) == []


@pytest.mark.parametrize(
    "state", ["active", "job", "run", "unaccepted", "no_evidence", "archived"]
)
def test_merge_capabilities_enforce_real_research_state(world, state):
    w = world
    with w.maker() as d:
        p = d.get(ResearchProject, w.ids[3])
        if state == "active":
            p.status = "active"
        elif state == "job":
            d.get(ResearchJob, w.ids[4]).status = "running"
        elif state == "run":
            d.add(
                AgentRun(
                    owner=p.owner,
                    session_id=p.session_id,
                    model_config_id="m",
                    model="m",
                    prompt="busy",
                    status="running",
                )
            )
        elif state == "unaccepted":
            p.conclusion = {**p.conclusion, "accepted": False}
        elif state == "no_evidence":
            rm.root(d, p).evidence_for = []
        else:
            d.get(ResearchWorkspace, w.ids[2]).archived = True
        d.commit()
    response = w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merge-preview", json={"kind": "memory"}
    )
    assert response.status_code == 409, response.text
    assert rr.committed_memory(w.settings, w.ids[2]) == []


def test_owner_cross_research_and_invalid_path_checks(world):
    w = world
    row = preview(w)
    route = f"{merge.BASE}/projects/{w.ids[3]}"
    for path in (
        route + "/merges",
        route + "/merge-options",
        f"{merge.BASE}/workspaces/{w.ids[2]}/memory",
        f"{merge.BASE}/workspaces/{w.ids[2]}/merges",
    ):
        assert w.client.get(path, headers={"X-Owner": w.ids[1]}).status_code == 404
    assert (
        w.client.post(
            route + "/merge-preview",
            json={"kind": "code"},
            headers={"X-Owner": w.ids[1]},
        ).status_code
        == 404
    )
    for path in (
        "../outside",
        ".",
        ".git/config",
        "memory/note.md",
        "PROJECT.md",
        "AGENTS.md",
        ":(glob)**",
        "shared/unknown.py",
    ):
        result = w.client.post(
            route + "/merge-preview", json={"kind": "code", "paths": [path]}
        )
        assert result.status_code == 409, (path, result.text)
    with w.maker() as d:
        p = d.get(ResearchProject, w.ids[3])
        other = rm.create_project(d, p.owner, "other", "", "m")
        other.workspace_id = p.workspace_id
        d.commit()
        otherid = other.id
    assert (
        w.client.post(
            f"{merge.BASE}/projects/{otherid}/merges/{row['id']}/cancel"
        ).status_code
        == 404
    )


def test_git_commit_db_gap_is_recovered_from_main_trailer(world, monkeypatch):
    w = world
    row = preview(w)
    original = merge._mark_applied

    def fail_after_git(*args):
        raise RuntimeError("database commit unavailable")

    monkeypatch.setattr(merge, "_mark_applied", fail_after_git)
    with pytest.raises(RuntimeError, match="database commit"):
        apply(w, row)
    commit = rr.head(w.repo)
    with w.maker() as d:
        assert d.get(ResearchMerge, row["id"]).status == "preview"
    monkeypatch.setattr(merge, "_mark_applied", original)
    result = apply(w, row)
    assert result.status_code == 200 and result.json()["commit_sha"] == commit
    assert rr.head(w.repo) == commit


def test_cancel_recovers_already_committed_merge_instead_of_hiding_it(
    world, monkeypatch
):
    w = world
    row = preview(w)
    original = merge._mark_applied
    monkeypatch.setattr(
        merge,
        "_mark_applied",
        lambda *args: (_ for _ in ()).throw(RuntimeError("db unavailable")),
    )
    with pytest.raises(RuntimeError):
        apply(w, row)
    commit = rr.head(w.repo)
    monkeypatch.setattr(merge, "_mark_applied", original)
    cancelled = w.client.post(
        f"{merge.BASE}/projects/{w.ids[3]}/merges/{row['id']}/cancel"
    )
    assert (
        cancelled.json()["status"] == "applied"
        and cancelled.json()["commit_sha"] == commit
    )


def test_failed_fast_forward_keeps_main_and_preview_retryable(world, monkeypatch):
    w = world
    row = preview(w)
    before = rr.head(w.repo)
    original = rr.git

    def fail_ff(cwd, *args, **kwargs):
        if args[0] == "merge":
            raise rr.GitError("simulated Git failure")
        return original(cwd, *args, **kwargs)

    monkeypatch.setattr(rr, "git", fail_ff)
    assert apply(w, row).status_code == 409
    assert rr.head(w.repo) == before and not (w.repo / "shared/new.py").exists()
    with w.maker() as d:
        assert d.get(ResearchMerge, row["id"]).status == "preview"
    assert not [
        p
        for p in rr.home(w.settings, w.ids[2]).iterdir()
        if p.name.startswith("merge-")
    ]
    monkeypatch.setattr(rr, "git", original)
    assert apply(w, row).json()["status"] == "applied"


def test_ignored_file_created_during_apply_is_never_overwritten(world, monkeypatch):
    w = world
    row = preview(w, paths=["shared/new.py"])
    exclude = rr._git_path(w.repo, "info/exclude")
    with exclude.open("a") as handle:
        handle.write("\n/shared/new.py\n")
    original = rr.git
    before = rr.head(w.repo)

    def create_file_before_ff(cwd, *args, **kwargs):
        if args[0] == "merge":
            (w.repo / "shared/new.py").write_text("local ignored file")
        return original(cwd, *args, **kwargs)

    monkeypatch.setattr(rr, "git", create_file_before_ff)
    assert apply(w, row).status_code == 409
    assert rr.head(w.repo) == before
    assert (w.repo / "shared/new.py").read_text() == "local ignored file"


def test_two_previews_cannot_both_apply_after_main_changes(world):
    w = world
    a = preview(w, paths=["shared/train.py"])
    b = preview(w, paths=["shared/new.py"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda row: apply(w, row), [a, b]))
    assert sorted(r.status_code for r in results) == [200, 409]
    with w.maker() as d:
        assert (
            d.scalar(
                select(func.count(ResearchMerge.id)).where(
                    ResearchMerge.status == "applied"
                )
            )
            == 1
        )


def test_merge_schema_upgrade_and_downgrade_at_real_previous_revision(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect

    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "upgrade.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    monkeypatch.setattr(Settings, "env", classmethod(lambda cls: settings))
    cfg = Config(toml_file="pyproject.toml")
    command.upgrade(cfg, "0037")
    engine = create_engine(settings.database_url)
    assert "research_merges" not in inspect(engine).get_table_names()
    command.upgrade(cfg, "0038")
    assert "research_merges" in inspect(engine).get_table_names()
    command.downgrade(cfg, "0037")
    assert "research_merges" not in inspect(engine).get_table_names()
    engine.dispose()
