# ruff: noqa: B008
"""A research's workspace as files: list a folder, read or download a file, upload.

Every path is relative to the workspace (research_sandbox.workdir); one that
resolves outside it, through `..`, an absolute path or a link, is refused.
On an SSH compute this is the copy synced back to this machine."""

import mimetypes
import os
import stat
from datetime import datetime
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select

from . import research_datasets, research_map, research_sandbox, research_settings
from .models import AgentRun, ResearchJob, ResearchSprint

TEXT_BYTES = 512 * 1024
UPLOAD_BYTES = 200 * 1024 * 1024
LIST_ENTRIES = 2000
WRITE_TOOLS = {"write", "edit"}
IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"}
CSV = {".csv", ".tsv"}
# Text the browser may show as-is; anything else that decodes as UTF-8 is text too.
BINARY = {
    ".pt", ".pth", ".bin", ".npy", ".npz", ".pkl", ".pickle", ".h5", ".hdf5",
    ".ckpt", ".safetensors", ".zip", ".gz", ".tar", ".tgz", ".bz2", ".xz",
    ".parquet", ".feather", ".arrow", ".so", ".dylib", ".pyc", ".onnx",
}  # fmt: skip


def resolve(root, rel, must_exist=True):
    """The workspace path `rel` names, or 400/404. `root` is the workspace."""
    rel = (rel or "").strip()
    if "\x00" in rel or "\\" in rel:
        raise HTTPException(400, "路径不合法")
    parts = PurePosixPath(rel).parts if rel else ()
    if rel.startswith("/") or any(p == ".." for p in parts):
        raise HTTPException(400, "路径必须在研究工作区内")
    base = root.resolve()
    path = base.joinpath(*[p for p in parts if p != "."])
    # Each existing step is checked: a link inside the workspace may point
    # anywhere, so it must resolve back into the workspace too.
    try:
        real = path.resolve(strict=must_exist)
    except (FileNotFoundError, NotADirectoryError):
        raise HTTPException(404, "文件不存在") from None
    except (OSError, RuntimeError):
        raise HTTPException(400, "路径不合法") from None
    if real != base and base not in real.parents:
        raise HTTPException(403, "路径指向研究工作区以外")
    return real


def relative(root, path):
    return path.relative_to(root.resolve()).as_posix()


def kind_of(path, head=b""):
    ext = path.suffix.lower()
    if ext in IMAGE:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext in BINARY or b"\x00" in head:
        return "binary"
    if ext in CSV:
        return "csv"
    if ext in {".md", ".markdown"}:
        return "markdown"
    return "text"


def _tool_path(value, root):
    """A write/edit path as the agent gave it, relative to the workspace, or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    posix = value.replace("\\", "/")
    if posix.startswith("/"):
        here = root.resolve().as_posix() + "/"
        if posix.startswith(here):
            posix = posix[len(here) :]
        elif "/work/" in posix + "/":
            posix = (posix + "/").split("/work/", 1)[1]
        else:
            return None
    parts = [p for p in PurePosixPath(posix).parts if p not in ("", ".")]
    if not parts or ".." in parts:
        return None
    return "/".join(parts)


def _stamp(value):
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError):
        return None


def latest_changes(d, project, root):
    """What the latest executor round touched: the paths its write and edit
    steps named, and the time windows its jobs ran in (what they produced)."""
    sprint = d.scalars(
        select(ResearchSprint)
        .where(
            ResearchSprint.project_id == project.id,
            ResearchSprint.role == "executor",
        )
        .order_by(ResearchSprint.number.desc())
        .limit(1)
    ).first()
    if sprint is None:
        return None, set(), []
    paths = set()
    run = d.get(AgentRun, sprint.run_id) if sprint.run_id else None
    for step in (run.steps if run else None) or []:
        if not isinstance(step, dict) or step.get("name") not in WRITE_TOOLS:
            continue
        if step.get("status") == "failed":
            continue
        path = _tool_path((step.get("arguments") or {}).get("path"), root)
        if path:
            paths.add(path)
    windows = []
    for job in d.scalars(select(ResearchJob).where(ResearchJob.sprint_id == sprint.id)):
        start = _stamp(job.started_at)
        if start is None:
            continue
        end = _stamp(job.finished_at) if job.finished_at else None
        windows.append((start, end))
    return sprint, paths, windows


def _changed(rel, info, is_dir, paths, windows):
    if rel in paths or (is_dir and any(p.startswith(rel + "/") for p in paths)):
        return True
    # A folder's time moves when a job adds or removes something in it.
    # Allow a second either side: file systems keep coarse times.
    return any(
        start - 1 <= info.st_mtime and (end is None or info.st_mtime <= end + 1)
        for start, end in windows
    )


def _entry(root, child, paths, windows):
    try:
        info = child.lstat()
    except OSError:
        return None
    rel = relative(root, child)
    link = stat.S_ISLNK(info.st_mode)
    if link:
        # A link is shown, but only followed when it stays in the workspace.
        try:
            target = child.resolve(strict=True)
        except (OSError, RuntimeError):
            return {"name": child.name, "path": rel, "type": "link", "size": 0,
                    "modified": info.st_mtime, "changed": False, "outside": True}  # fmt: skip
        base = root.resolve()
        if target != base and base not in target.parents:
            return {"name": child.name, "path": rel, "type": "link", "size": 0,
                    "modified": info.st_mtime, "changed": False, "outside": True}  # fmt: skip
        info = target.stat()
    is_dir = stat.S_ISDIR(info.st_mode)
    return {
        "name": child.name,
        "path": rel,
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else info.st_size,
        "modified": info.st_mtime,
        "changed": _changed(rel, info, is_dir, paths, windows),
        **({"link": True} if link else {}),
    }


def _unique(folder, name):
    stem, ext = os.path.splitext(name)
    n = 1
    while (folder / name).exists() or (folder / name).is_symlink():
        name = f"{stem} ({n}){ext}"
        n += 1
    return name


def install_research_files(app, settings, db, auth, project_of):
    base = "/api/v1/research/projects/{id}/workspace"

    def kind_of_compute(p):
        try:
            return research_settings.compute(settings, p.compute_id).get("kind", "")
        except ValueError:
            return ""

    @app.get(base + "/list")
    def list_folder(id: str, path: str = "", a=Depends(auth), d=Depends(db)):
        """A folder of the workspace: its entries, folders first, with what
        the latest round changed marked."""
        p = project_of(d, id, a)
        root = research_sandbox.workdir(settings, p.id)
        folder = resolve(root, path)
        if not folder.is_dir():
            raise HTTPException(400, "不是文件夹")
        sprint, paths, windows = latest_changes(d, p, root)
        entries = []
        with os.scandir(folder) as found:
            for item in found:
                if item.name == ".git":
                    # The worktree's link to the project's repository (research_repo).
                    continue
                row = _entry(root, folder / item.name, paths, windows)
                if row:
                    entries.append(row)
                if len(entries) >= LIST_ENTRIES:
                    break
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
        return {
            "path": "" if folder == root.resolve() else relative(root, folder),
            "entries": entries,
            "truncated": len(entries) >= LIST_ENTRIES,
            "round": sprint.number if sprint else None,
            "changed": sorted(paths),
            "compute": kind_of_compute(p),
        }

    @app.get(base + "/file")
    def read_file(
        id: str,
        path: str,
        download: bool = False,
        raw: bool = False,
        a=Depends(auth),
        d=Depends(db),
    ):
        """A file: as JSON with its text (up to a limit) and kind, or its bytes
        (`raw` for images and PDFs shown in place, `download` to save it)."""
        p = project_of(d, id, a)
        root = research_sandbox.workdir(settings, p.id)
        target = resolve(root, path)
        if not target.is_file():
            raise HTTPException(400, "不是文件")
        info = target.stat()
        with target.open("rb") as f:
            head = f.read(TEXT_BYTES + 1)
        kind = kind_of(target, head[:8192])
        name = target.name
        if download or raw:
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            inline = raw and not download and kind in {"image", "pdf"}
            headers = {
                "Content-Disposition": (
                    f"{'inline' if inline else 'attachment'}; filename=\"file\"; "
                    f"filename*=UTF-8''{quote(name, safe='')}"
                ),
                "Cache-Control": "private, no-cache",
                "X-Content-Type-Options": "nosniff",
            }
            return FileResponse(
                target,
                media_type=mime if inline else "application/octet-stream",
                headers=headers,
            )
        out = {
            "path": relative(root, target),
            "name": name,
            "size": info.st_size,
            "modified": info.st_mtime,
            "kind": kind,
        }
        if kind in {"text", "csv", "markdown"}:
            out["truncated"] = len(head) > TEXT_BYTES
            out["content"] = head[:TEXT_BYTES].decode("utf-8", errors="replace")
        return out

    @app.post(base + "/upload")
    async def upload(
        id: str,
        file: UploadFile = File(...),
        path: str = Form(""),
        conflict: str = Form("error"),
        a=Depends(auth),
        d=Depends(db),
    ):
        """A file put into a folder of the workspace. A name already there is
        refused (409), renamed (`rename`) or overwritten (`replace`)."""
        if conflict not in {"error", "rename", "replace"}:
            raise HTTPException(422, "冲突处理方式不合法")
        p = project_of(d, id, a, writable=True)
        root = research_sandbox.workdir(settings, p.id)
        folder = resolve(root, path)
        if not folder.is_dir():
            raise HTTPException(400, "不是文件夹")
        name = Path((file.filename or "").replace("\\", "/")).name.strip()
        if not name or name in {".", ".."} or name.startswith(".") or len(name) > 200:
            raise HTTPException(422, "文件名不合法")
        data = await file.read(UPLOAD_BYTES + 1)
        if len(data) > UPLOAD_BYTES:
            raise HTTPException(413, "单个文件最多 200 MB")
        target = folder / name
        existing = target.exists() or target.is_symlink()
        if existing:
            if conflict == "error":
                raise HTTPException(409, "已有同名文件")
            if conflict == "rename":
                name = _unique(folder, name)
                target = folder / name
                existing = False
            elif target.is_symlink() or not target.is_file():
                # Overwriting through a link would write wherever it points.
                raise HTTPException(409, "同名的不是普通文件，不能覆盖")
        freed = target.stat().st_size if existing else 0
        if (
            research_sandbox._size(root) - freed + len(data)
            > research_sandbox.WORKSPACE_BYTES
        ):
            raise HTTPException(413, "工作区空间不够")
        partial = folder / f".{name}.{os.getpid()}.upload"
        partial.write_bytes(data)
        os.replace(partial, target)
        rel = relative(root, target)
        if rel == f"data/{name}":
            # The data folder is where experiments look for what was given them.
            research_datasets.record_upload(d, p, rel, data)
        research_map.event(
            d, p, None, "human", "file_added", {"path": rel, "size": len(data)}
        )
        d.commit()
        return {"path": rel, "name": name, "size": len(data), "replaced": existing}
