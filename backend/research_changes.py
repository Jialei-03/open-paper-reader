"""Read checkpoint diffs; undo the latest sealed round without resetting history."""

import base64
import hashlib
from types import SimpleNamespace

from fastapi import Depends, HTTPException
from pydantic import Field
from sqlalchemy import select

from . import research_locations, research_map, research_publish, research_repo as rr
from .models import ResearchEvent, ResearchSprint, ResearchWorkspace
from .research_merge import _active
from .schemas import Strict

BASE = "/api/v1/research/projects"


class UndoInput(Strict):
    expected_commit: str = Field(pattern=r"^[0-9a-f]{40,64}$")


def diff(repo, base, commit):
    files = []
    names = rr.git(
        repo, "diff", "--no-renames", "--name-only", "-z", base, commit, "--"
    ).stdout.split("\0")
    if len(names) > 201:
        raise ValueError("变更超过 200 个文件")
    for name in filter(None, names):
        stats = rr.git(
            repo,
            "--literal-pathspecs",
            "diff",
            "--numstat",
            "--no-renames",
            base,
            commit,
            "--",
            name,
        ).stdout.split("\t", 2)
        added, removed = (int(x) if x.isdigit() else 0 for x in stats[:2])
        patch = rr.git(
            repo,
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            base,
            commit,
            "--",
            name,
            errors="replace",
        ).stdout
        files.append(
            {
                "path": name,
                "added": added,
                "removed": removed,
                "diff": patch[:80000],
                "truncated": len(patch) > 80000,
                "binary": stats[0] == "-",
            }
        )
    return {
        "base_commit": base,
        "commit_sha": commit,
        "files": files,
        "added": sum(f["added"] for f in files),
        "removed": sum(f["removed"] for f in files),
    }


def round_diff(settings, d, project, workspace, sprint):
    if (
        sprint.project_id != project.id
        or sprint.status == "running"
        or not sprint.commit_sha
        or not sprint.snapshot
        or sprint.snapshot.get("version") != 1
        or sprint.snapshot.get("commit") != sprint.commit_sha
    ):
        raise ValueError("本轮没有可用检查点")
    commit = rr.validate_checkpoint(settings, workspace, project, sprint.commit_sha)
    repo = rr.repo_dir(settings, workspace.id)
    previous = d.scalar(
        select(ResearchSprint)
        .where(
            ResearchSprint.project_id == project.id,
            ResearchSprint.number < sprint.number,
            ResearchSprint.commit_sha != "",
        )
        .order_by(ResearchSprint.number.desc())
        .limit(1)
    )
    base = (
        previous.commit_sha
        if previous
        else rr.git(repo, "rev-parse", commit + "^").stdout.strip()
    )
    result = diff(repo, base, commit)
    latest = d.scalar(
        select(ResearchSprint.id)
        .where(
            ResearchSprint.project_id == project.id,
        )
        .order_by(ResearchSprint.number.desc())
        .limit(1)
    )
    undone = d.scalar(
        select(ResearchEvent.id)
        .where(
            ResearchEvent.project_id == project.id,
            ResearchEvent.action == "checkpoint_reverted",
            ResearchEvent.sprint_id == sprint.id,
        )
        .limit(1)
    )
    result["can_undo"] = bool(
        result["files"]
        and latest == sprint.id
        and not undone
        and project.status in {"paused", "finished"}
        and not _active(d, project)
    )
    return result


def undo(settings, d, project, workspace, sprint, expected):
    with rr._locked(rr.home(settings, workspace.id)):
        result = round_diff(settings, d, project, workspace, sprint)
        path = rr.thread_dir(settings, workspace.id, project.id)
        if (
            not result["can_undo"]
            or expected != result["commit_sha"]
            or rr.head(path) != expected
        ):
            raise ValueError("只能撤销最新且已暂停的轮次，请刷新")
        if research_locations.busy_workspace(
            d, workspace, exclude_session_id=project.session_id
        ):
            raise ValueError("项目里另一段对话仍在运行")
        if rr.git(path, "status", "--porcelain").stdout.strip():
            raise ValueError("检查点之后还有修改，请先保存")
        location = research_locations.research_location(settings, workspace, project)
        target = SimpleNamespace(id=workspace.id, location=location)
        names = [f["path"] for f in result["files"]]
        before = research_publish.manifest(settings, target, names)
        payload = {}
        for name in names:
            state = before[name]
            current = rr.git(path, "ls-tree", expected, "--", name).stdout
            if current:
                blob = rr.git(path, "show", f"{expected}:{name}", text=False).stdout
                if (
                    not state.get("exists")
                    or state["sha256"] != hashlib.sha256(blob).hexdigest()
                    or bool(state["mode"] & 0o111) != (current.split()[0] == "100755")
                ):
                    raise ValueError("检查点之后文件已变化，请先保存")
            elif state.get("exists"):
                raise ValueError("检查点之后文件已变化，请先保存")
            previous = rr.git(path, "ls-tree", result["base_commit"], "--", name).stdout
            if previous:
                if previous.split()[0] not in {"100644", "100755"}:
                    raise ValueError("只能撤销普通文件")
                blob = rr.git(
                    path, "show", f"{result['base_commit']}:{name}", text=False
                ).stdout
                payload[name] = {
                    "data": base64.b64encode(blob).decode("ascii"),
                    "mode": (state.get("mode", 0o644) & ~0o111)
                    | (0o111 if previous.split()[0] == "100755" else 0),
                }
            else:
                payload[name] = None
        research_publish._call(
            settings,
            target,
            {"action": "apply", "paths": names, "before": before, "changes": payload},
        )
        rr.git(
            path,
            "--literal-pathspecs",
            "restore",
            "--source=" + result["base_commit"],
            "--worktree",
            "--",
            *names,
        )
        commit = rr.checkpoint(path, f"Revert research round {sprint.number}")
        research_map.event(
            d,
            project,
            None,
            "human",
            "checkpoint_reverted",
            {"commit": commit, "reverted_commit": expected},
            sprint.id,
        )
        return {"commit_sha": commit}


def install_change_routes(app, settings, db, auth, project_of):
    def context(d, id, a, writable=False):
        project = project_of(d, id, a, writable=writable)
        workspace = d.get(ResearchWorkspace, project.workspace_id)
        if workspace is None or workspace.owner != a["id"]:
            raise HTTPException(404, "Not found")
        return project, workspace

    @app.get(BASE + "/{id}/changes")
    def changes(id: str, a=Depends(auth), d=Depends(db)):
        project, workspace = context(d, id, a)
        path = rr.thread_dir(settings, workspace.id, project.id)
        if not (path / ".git").exists():
            return {"files": [], "added": 0, "removed": 0}
        try:
            source = rr.head(path)
            base = rr.git(path, "merge-base", "main", source).stdout.strip()
            return diff(path, base, source)
        except (ValueError, rr.GitError) as exc:
            raise HTTPException(409, str(exc)) from None

    @app.get(BASE + "/{id}/rounds/{sprint_id}/changes")
    def round_changes(id: str, sprint_id: str, a=Depends(auth), d=Depends(db)):
        project, workspace = context(d, id, a)
        sprint = d.get(ResearchSprint, sprint_id)
        if sprint is None or sprint.project_id != project.id:
            raise HTTPException(404, "Not found")
        try:
            return round_diff(settings, d, project, workspace, sprint)
        except (ValueError, rr.GitError) as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post(BASE + "/{id}/rounds/{sprint_id}/undo")
    def undo_round(
        id: str, sprint_id: str, body: UndoInput, a=Depends(auth), d=Depends(db)
    ):
        project, workspace = context(d, id, a, True)
        sprint = d.get(ResearchSprint, sprint_id)
        if sprint is None or sprint.project_id != project.id:
            raise HTTPException(404, "Not found")
        try:
            result = undo(settings, d, project, workspace, sprint, body.expected_commit)
            d.commit()
            return result
        except (ValueError, OSError, rr.GitError) as exc:
            raise HTTPException(409, str(exc)) from None
