"""Review and publish files to a physical workspace, locally or over SSH.

A private Git receipt allows retries after a process or connection failure:
each target must still be its reviewed preimage or that receipt's postimage.
Existing files use a final optimistic check and atomic replacement. This is
not a filesystem compare-and-swap against an uncooperative external writer.
"""

import base64
import hashlib
import json
import os
import shlex
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

LIMIT = 40 * 1024 * 1024


def _root(root, expected=None):
    if not root.is_dir() or root.is_symlink() or root.resolve() != root:
        raise ValueError("工作区目录已变化，请重新选择")
    info = root.stat()
    identity = {"device": info.st_dev, "inode": info.st_ino}
    if expected is not None and identity != expected:
        raise ValueError("工作区目录已变化，请重新预览")
    return identity


def _file(root, name):
    parts = PurePosixPath(name).parts
    if (
        not name
        or not parts
        or name.startswith("/")
        or "\\" in name
        or "\0" in name
        or str(PurePosixPath(name)) != name
        or any(p in {".", ".."} or p.lower() == ".git" for p in parts)
    ):
        raise ValueError("成果文件路径不合法")
    target = root.joinpath(*parts)
    for parent in [target, *target.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError("成果目标不能经过符号链接")
        if parent != target and parent.exists() and not parent.is_dir():
            raise ValueError("成果目标的父路径不是目录")
    return target


def _read(path):
    handle = os.open(
        path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    with os.fdopen(handle, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("成果目标必须是普通文件")
        if before.st_size > LIMIT:
            raise ValueError("成果目标文件超过 40 MB")
        data = stream.read(LIMIT + 1)
        after = os.fstat(stream.fileno())
    if len(data) > LIMIT or (before.st_size, before.st_mtime_ns, before.st_mode) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_mode,
    ):
        raise ValueError("成果目标在读取时变化，请重新预览")
    return data, stat.S_IMODE(after.st_mode)


def _state(path):
    if path.is_symlink():
        raise ValueError("成果目标必须是普通文件")
    if not path.exists():
        return {"exists": False}
    data, mode = _read(path)
    return {"exists": True, "sha256": hashlib.sha256(data).hexdigest(), "mode": mode}


def _content(item):
    return (
        {"exists": True, "sha256": item["sha256"], "mode": item["mode"]}
        if item.get("exists")
        else {"exists": False}
    )


def _replace(path, data, mode, expected, *, root):
    """Recheck immediately before an atomic file operation; no new-file clobber."""
    name = str(path.relative_to(root))

    def check():
        _root(root, expected.get("root"))
        _file(root, name)
        if _state(path) != _content(expected):
            raise ValueError(f"工作区文件已变化：{name}，请重新预览")

    check()
    if data is None:
        check()
        if expected.get("exists"):
            path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    check()
    handle, temporary = tempfile.mkstemp(prefix=".ora-merge-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temporary, mode)
        check()
        if expected.get("exists"):
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                raise ValueError(f"工作区文件已变化：{name}，请重新预览") from None
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        except OSError:
            pass  # Cleanup must not hide a successful write from rollback.


def transaction(packet):
    root = Path(packet["root"])
    identity = _root(root)
    paths = {name: _file(root, name) for name in packet["paths"]}
    current = {name: _state(path) for name, path in paths.items()}
    _root(root, identity)
    if packet["action"] == "inspect":
        return {name: {**item, "root": identity} for name, item in current.items()}
    expected, payload = packet["before"], packet["changes"]
    if set(expected) != set(paths) or set(payload) != set(paths):
        raise ValueError("成果文件与预览选择不一致")
    decoded, after = {}, {}
    for name, item in payload.items():
        _root(root, expected[name].get("root"))
        data = base64.b64decode(item["data"], validate=True) if item else None
        if item and (
            not isinstance(item["mode"], int) or not 0 <= item["mode"] <= 0o7777
        ):
            raise ValueError("成果文件权限不合法")
        decoded[name] = data
        after[name] = (
            {
                "exists": True,
                "sha256": hashlib.sha256(data).hexdigest(),
                "mode": item["mode"],
            }
            if item
            else {"exists": False}
        )
        if current[name] != _content(expected[name]) and not (
            packet.get("recover") and current[name] == after[name]
        ):
            raise ValueError(f"工作区文件已变化：{name}，请重新预览")
    if (
        sum(len(data) for data in decoded.values() if data is not None) > LIMIT
        or sum(path.stat().st_size for path in paths.values() if path.exists()) > LIMIT
    ):
        raise ValueError("成果文件超过 40 MB，请分批合并")
    written, backups = [], {}
    try:
        for name, path in paths.items():
            _root(root, expected[name].get("root"))
            _file(root, name)
            state = _state(path)
            if packet.get("recover") and state == after[name]:
                continue
            if state != _content(expected[name]):
                raise ValueError(f"工作区文件已变化：{name}，请重新预览")
            backups[name] = _read(path) if state["exists"] else (None, 0o644)
            item = payload[name]
            _replace(
                path,
                decoded[name],
                item["mode"] if item else 0o644,
                expected[name],
                root=root,
            )
            written.append(name)
    except BaseException:
        for name in reversed(written):
            try:
                _root(root, expected[name].get("root"))
                _file(root, name)
                if _state(paths[name]) == after[name]:
                    _replace(
                        paths[name],
                        *backups[name],
                        {**after[name], "root": expected[name].get("root")},
                        root=root,
                    )
            except (ValueError, OSError):
                continue
        raise
    return {"published": list(paths)}


def _call(settings, workspace, packet):
    from .research_locations import connection, location_for, ssh_args
    from . import research_sandbox

    location = location_for(settings, workspace)
    packet = {**packet, "root": location["path"]}
    if location["kind"] != "ssh":
        try:
            return transaction(packet)
        except OSError as exc:
            raise ValueError("成果写回失败：" + str(exc)[:300]) from None
    item = connection(settings, location["connection_id"])
    source = (
        Path(__file__).read_text()
        + "\ntry:\n print(json.dumps({'result':transaction(json.load(__import__('sys').stdin))}))\nexcept Exception as e:\n print(json.dumps({'error':str(e)}))\n"
    )
    try:
        result = research_sandbox.run(
            [*ssh_args(item), item["host"], "python3 -c " + shlex.quote(source)],
            input=json.dumps(packet),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError("SSH 成果写回未确认，请重试同一份预览") from None
    if result.returncode:
        raise ValueError("SSH 成果写回未确认，请重试同一份预览")
    try:
        answer = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise ValueError("SSH 成果写回未确认，请重试同一份预览") from None
    if answer.get("error"):
        raise ValueError(answer["error"])
    return answer["result"]


def manifest(settings, workspace, paths):
    return _call(settings, workspace, {"action": "inspect", "paths": paths})


def changes(worktree, paths, before):
    """Validate postimages and preserve existing non-executable permissions."""
    worktree = Path(worktree).resolve()
    result, total = {}, 0
    for name in paths:
        path = _file(worktree, name)
        state = _state(path)
        if not state["exists"]:
            result[name] = None
            continue
        data, desired_mode = _read(path)
        total += len(data)
        executable = bool(desired_mode & 0o111)
        previous = before[name]
        if previous.get("exists"):
            mode = previous["mode"]
            if executable != bool(mode & 0o111):
                mode = (mode & ~0o111) | ((mode & 0o444) >> 2 if executable else 0)
        else:
            mode = 0o755 if executable else 0o644
        result[name] = {"data": base64.b64encode(data).decode("ascii"), "mode": mode}
    if total > LIMIT:
        raise ValueError("成果文件超过 40 MB，请分批合并")
    return result


def publish(settings, workspace, paths, before, worktree, *, recover=False):
    return _call(
        settings,
        workspace,
        {
            "action": "apply",
            "paths": paths,
            "before": before,
            "changes": changes(worktree, paths, before),
            "recover": recover,
        },
    )
