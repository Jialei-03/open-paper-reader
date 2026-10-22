"""Publish preflight, exact permissions, rollback, and ambiguous SSH retry."""

import json
import os
import shlex
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest

from backend import research_publish as publish
from backend import research_sandbox, research_settings
from backend.config import Settings


@pytest.fixture
def world(tmp_path):
    root, work = tmp_path / "real folder", tmp_path / "private worktree"
    root.mkdir()
    work.mkdir()
    settings = Settings(storage=str(tmp_path / "app/files"), testing=True)
    workspace = SimpleNamespace(
        id="w", location={"kind": "local", "path": str(root), "connection_id": ""}
    )
    for name in ("a.py", "b.py"):
        (root / name).write_text("old " + name)
        (work / name).write_text("new " + name)
    return SimpleNamespace(root=root, work=work, settings=settings, workspace=workspace)


def packet(w, paths=("a.py", "b.py")):
    before = publish.manifest(w.settings, w.workspace, list(paths))
    return {
        "root": str(w.root),
        "action": "apply",
        "paths": list(paths),
        "before": before,
        "changes": publish.changes(w.work, list(paths), before),
    }


@pytest.mark.parametrize(
    "original,desired,expected",
    [
        (0o600, 0o644, 0o600),
        (0o640, 0o755, 0o750),
        (0o750, 0o644, 0o640),
        (0o700, 0o755, 0o700),
    ],
)
def test_existing_permissions_are_preserved_except_explicit_git_execution_change(
    world, original, desired, expected
):
    w = world
    os.chmod(w.root / "a.py", original)
    os.chmod(w.work / "a.py", desired)
    request = packet(w, ["a.py"])
    assert request["before"]["a.py"]["mode"] == original
    assert request["changes"]["a.py"]["mode"] == expected
    publish.transaction(request)
    assert stat.S_IMODE((w.root / "a.py").stat().st_mode) == expected


def test_new_file_modes_are_normalized_and_deletions_are_supported(world):
    w = world
    (w.work / "new.sh").write_text("#!/bin/sh\necho hi")
    os.chmod(w.work / "new.sh", 0o700)
    (w.work / "new.txt").write_text("new text")
    os.chmod(w.work / "new.txt", 0o600)
    (w.work / "b.py").unlink()
    request = packet(w, ["new.sh", "new.txt", "b.py"])
    publish.transaction(request)
    assert stat.S_IMODE((w.root / "new.sh").stat().st_mode) == 0o755
    assert stat.S_IMODE((w.root / "new.txt").stat().st_mode) == 0o644
    assert not (w.root / "b.py").exists()


def test_every_target_is_preflighted_before_first_write_including_mode(world):
    w = world
    os.chmod(w.root / "b.py", 0o600)
    request = packet(w)
    os.chmod(w.root / "b.py", 0o640)
    with pytest.raises(ValueError, match="已变化"):
        publish.transaction(request)
    assert (w.root / "a.py").read_text() == "old a.py"
    assert stat.S_IMODE((w.root / "b.py").stat().st_mode) == 0o640


def test_failure_rolls_back_previous_writes_and_exact_mode(world, monkeypatch):
    w = world
    os.chmod(w.root / "a.py", 0o600)
    request = packet(w)
    original = publish._replace

    def failing(path, *args, **kwargs):
        if path.name == "b.py":
            raise OSError("disk failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(publish, "_replace", failing)
    with pytest.raises(OSError, match="disk failure"):
        publish.transaction(request)
    assert (w.root / "a.py").read_text() == "old a.py"
    assert stat.S_IMODE((w.root / "a.py").stat().st_mode) == 0o600
    assert (w.root / "b.py").read_text() == "old b.py"
    assert not list(w.root.glob(".ora-merge-*"))


def test_rollback_preserves_user_edit_after_an_earlier_file_was_published(
    world, monkeypatch
):
    w = world
    request = packet(w)
    original = publish._replace

    def failing(path, *args, **kwargs):
        if path.name == "b.py":
            (w.root / "a.py").write_text("later user edit")
            raise OSError("disk failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(publish, "_replace", failing)
    with pytest.raises(OSError):
        publish.transaction(request)
    assert (w.root / "a.py").read_text() == "later user edit"
    assert (w.root / "b.py").read_text() == "old b.py"


def test_final_check_catches_edits_made_during_tempfile_preparation(world, monkeypatch):
    w = world
    request = packet(w, ["a.py"])
    original = os.chmod

    def changed(path, mode, **kwargs):
        if str(path).split("/")[-1].startswith(".ora-merge-"):
            (w.root / "a.py").write_text("edited during prepare")
        return original(path, mode, **kwargs)

    monkeypatch.setattr(os, "chmod", changed)
    with pytest.raises(ValueError, match="已变化"):
        publish.transaction(request)
    assert (w.root / "a.py").read_text() == "edited during prepare"
    assert not list(w.root.glob(".ora-merge-*"))


def test_new_file_that_appears_at_atomic_publish_is_never_overwritten(
    world, monkeypatch
):
    w = world
    (w.work / "new.py").write_text("reviewed new file")
    request = packet(w, ["new.py"])
    original = os.link

    def appeared(source, target, **kwargs):
        target.write_text("new user file")
        return original(source, target, **kwargs)

    monkeypatch.setattr(os, "link", appeared)
    with pytest.raises(ValueError, match="已变化"):
        publish.transaction(request)
    assert (w.root / "new.py").read_text() == "new user file"


@pytest.mark.parametrize("change", ["symlink", "new_directory"])
def test_changed_root_identity_is_rejected_even_with_identical_file_content(
    world, change
):
    w = world
    request = packet(w)
    moved = w.root.with_name("original root")
    w.root.rename(moved)
    if change == "symlink":
        w.root.symlink_to(moved, target_is_directory=True)
    else:
        w.root.mkdir()
        for name in ("a.py", "b.py"):
            (w.root / name).write_bytes((moved / name).read_bytes())
    with pytest.raises(ValueError, match="目录已变化"):
        publish.transaction(request)
    assert (moved / "a.py").read_text() == "old a.py"
    assert (w.root / "a.py").read_text() == "old a.py"


def test_root_is_rechecked_for_each_file_and_retry_can_complete_partial_postimage(
    world, monkeypatch
):
    w = world
    request = packet(w)
    moved = w.root.with_name("renamed root")
    elsewhere = w.root.with_name("elsewhere")
    elsewhere.mkdir()
    (elsewhere / "b.py").write_text("unrelated user's file")
    original = publish._replace

    def swap_root(path, *args, **kwargs):
        if path.name == "b.py":
            w.root.rename(moved)
            w.root.symlink_to(elsewhere, target_is_directory=True)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(publish, "_replace", swap_root)
    with pytest.raises(ValueError, match="目录已变化"):
        publish.transaction(request)
    assert (elsewhere / "b.py").read_text() == "unrelated user's file"
    assert (moved / "a.py").read_text() == "new a.py"
    w.root.unlink()
    moved.rename(w.root)
    monkeypatch.setattr(publish, "_replace", original)
    publish.transaction({**request, "recover": True})
    assert (w.root / "b.py").read_text() == "new b.py"


def test_receipt_retry_accepts_only_preimages_or_exact_postimages(world):
    w = world
    request = packet(w)
    publish.transaction(request)
    with pytest.raises(ValueError, match="已变化"):
        publish.transaction(request)
    publish.transaction({**request, "recover": True})
    (w.root / "b.py").write_text("third user version")
    with pytest.raises(ValueError, match="已变化"):
        publish.transaction({**request, "recover": True})
    assert (w.root / "b.py").read_text() == "third user version"


def test_postimage_validation_rejects_symlinks_before_any_target_write(world):
    w = world
    before = publish.manifest(w.settings, w.workspace, ["a.py"])
    (w.work / "a.py").unlink()
    (w.work / "a.py").symlink_to(w.root / "b.py")
    with pytest.raises(ValueError, match="符号链接"):
        publish.changes(w.work, ["a.py"], before)
    assert (w.root / "a.py").read_text() == "old a.py"


def _ssh(w):
    key = w.work.parent / "fake key.pem"
    key.write_text("not a credential; never read by the test transport")
    item = research_settings.check_compute(
        {
            "id": "lab",
            "kind": "ssh",
            "host": "user@lab",
            "port": 2203,
            "identity_file": str(key),
        }
    )
    data = research_settings.load(w.settings)
    data["computes"].append(item)
    research_settings.save(w.settings, data)
    w.workspace.location = {"kind": "ssh", "path": str(w.root), "connection_id": "lab"}
    return key


def test_ssh_source_roundtrip_uses_safe_argv_and_json_and_preserves_permissions(
    world, monkeypatch
):
    w = world
    key = _ssh(w)
    os.chmod(w.root / "a.py", 0o600)
    calls = []

    def execute_source(args, **kwargs):
        calls.append((args, kwargs))
        words = shlex.split(args[-1])
        assert words[:2] == ["python3", "-c"] and len(words) == 3
        assert str(w.root) not in args[-1]
        return subprocess.run([sys.executable, "-c", words[2]], **kwargs)

    monkeypatch.setattr(research_sandbox, "run", execute_source)
    before = publish.manifest(w.settings, w.workspace, ["a.py"])
    publish.publish(w.settings, w.workspace, ["a.py"], before, w.work)
    assert (w.root / "a.py").read_text() == "new a.py"
    assert stat.S_IMODE((w.root / "a.py").stat().st_mode) == 0o600
    args, kwargs = calls[-1]
    assert "BatchMode=yes" in args
    assert args[args.index("-p") + 1] == "2203"
    assert args[args.index("-i") + 1] == str(key)
    assert json.loads(kwargs["input"])["root"] == str(w.root)


def test_ssh_disconnect_after_remote_commit_can_retry_without_rewriting_files(
    world, monkeypatch
):
    w = world
    _ssh(w)
    fail_once = True

    def execute_source(args, **kwargs):
        nonlocal fail_once
        words = shlex.split(args[-1])
        result = subprocess.run([sys.executable, "-c", words[2]], **kwargs)
        if json.loads(kwargs["input"])["action"] == "apply" and fail_once:
            fail_once = False
            raise subprocess.TimeoutExpired(args, 60)
        return result

    monkeypatch.setattr(research_sandbox, "run", execute_source)
    before = publish.manifest(w.settings, w.workspace, ["a.py"])
    with pytest.raises(ValueError, match="重试同一份预览"):
        publish.publish(w.settings, w.workspace, ["a.py"], before, w.work)
    written = (w.root / "a.py").stat().st_mtime_ns
    publish.publish(w.settings, w.workspace, ["a.py"], before, w.work, recover=True)
    assert (w.root / "a.py").stat().st_mtime_ns == written
