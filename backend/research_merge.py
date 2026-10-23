"""Preview and explicitly apply research results to a project's main branch.

Every check runs in a disposable worktree. Main only receives a fast-forward
after both heads and the clean working tree have been checked again. A commit
trailer lets a retry recover the database record after a Git/DB commit gap.
"""

import hashlib
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote, unquote

from fastapi import Depends, HTTPException, Query, Response
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import load_only

from . import research_repo as rr
from . import research_locations
from .models import (
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchJob,
    ResearchMerge,
    ResearchNode,
    ResearchProject,
    ResearchWorkspace,
    now,
)
from .schemas import Strict

BASE = "/api/v1/research"
DIFF_BYTES = 80_000
SELECTION_BYTES = 40 * 1024 * 1024


class PreviewInput(Strict):
    kind: Literal["memory", "code"]
    paths: list[str] | None = Field(default=None, max_length=200)


class ApplyInput(Strict):
    expected_main_commit: str = Field(pattern=r"^[0-9a-f]{40,64}$")
    expected_source_commit: str = Field(pattern=r"^[0-9a-f]{40,64}$")


def output(row, project=None):
    return {
        **{
            key: getattr(row, key)
            for key in (
                "id",
                "kind",
                "status",
                "expected_main_commit",
                "expected_source_commit",
                "paths",
                "commit_sha",
                "error",
                "created_at",
                "updated_at",
            )
        },
        "research_id": row.project_id,
        "question": project.question if project else "",
        "files": (row.preview or {}).get("files", []),
        "conflicts": (row.preview or {}).get("conflicts", []),
        "memory_text": (row.preview or {}).get("memory_text", ""),
        "target_location": (row.preview or {}).get("target_location"),
    }


def _active(d, project):
    return bool(
        d.scalar(
            select(AgentRun.id)
            .where(
                AgentRun.session_id == project.session_id,
                AgentRun.status.in_(("queued", "running")),
            )
            .limit(1)
        )
        or d.scalar(
            select(ResearchJob.id)
            .where(
                ResearchJob.project_id == project.id,
                ResearchJob.status.in_(("queued", "running")),
            )
            .limit(1)
        )
    )


def _memory(d, project, source_commit=""):
    """A deterministic, source-addressed note; no model call or hidden approval."""
    conclusion = project.conclusion or {}
    answer = conclusion.get("summary") or conclusion.get("answer") or ""
    if not answer and (project.budget or {}).get("auto_decide"):
        latest = d.scalar(
            select(ResearchEvent)
            .where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "concluded",
            )
            .order_by(ResearchEvent.created_at.desc(), ResearchEvent.id.desc())
            .limit(1)
        )
        answer = (latest.detail or {}).get("summary", "") if latest else ""
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("研究还没有可合并的结论")
    parts = [
        f"# {project.question}",
        f"研究：{project.id}",
        f"研究文件检查点：{source_commit}" if source_commit else "",
        "## 结论\n\n" + answer.strip(),
    ]
    if conclusion.get("answer") and conclusion["answer"] != answer:
        parts.append("对研究问题的回答：" + str(conclusion["answer"]))
    if project.parent_id:
        origin = project.forked_from or {}
        parts.append(
            f"分叉来源：研究 {project.parent_id}，第 {origin.get('number', '?')} 轮，检查点 {origin.get('commit', '')}"
        )
    conditions = []
    for key in ("note", "conditions", "limitations", "caveats"):
        if conclusion.get(key):
            conditions.append(f"{key}: {conclusion[key]}")
    if project.background:
        conditions.append("研究背景与适用范围：" + project.background)
    parts.append(
        "## 条件与局限\n\n"
        + (
            "\n\n".join(conditions)
            or "研究记录未单列条件或局限；此结论仅由以下证据支持。"
        )
    )
    parts.append("## 证据")
    count = 0
    for node in d.scalars(
        select(ResearchNode)
        .where(ResearchNode.project_id == project.id)
        .order_by(ResearchNode.created_at, ResearchNode.id)
    ):
        for side, entries in (
            ("支持", node.evidence_for),
            ("反对", node.evidence_against),
        ):
            for entry in entries or []:
                refs = []
                for evidence in entry.get("evidence", []):
                    origin = (
                        evidence.get("source_research_id")
                        or entry.get("source_research_id")
                        or project.id
                    )
                    if evidence.get("kind") == "log" and evidence.get("job_id"):
                        refs.append(
                            f"来源研究 {origin}，作业 {evidence['job_id']}，第 {evidence.get('from_line')}–{evidence.get('to_line')} 行\n"
                            + "\n".join(str(x) for x in evidence.get("lines", []))
                        )
                    elif evidence.get("kind") == "cite" and evidence.get("file_id"):
                        refs.append(
                            f"来源研究 {origin}，文件 {evidence['file_id']}，第 {evidence.get('page')} 页\n{evidence.get('quote', '')}"
                        )
                if refs:
                    count += len(refs)
                    parts.append(
                        f"### {node.title}（{side}）\n\n{entry.get('summary', '')}\n\n"
                        + "\n\n".join(refs)
                    )
    if not count:
        raise ValueError("研究结论还没有带来源的证据")
    text = "\n\n".join(part for part in parts if part) + "\n"
    if len(text.encode("utf-8")) > 40_000:
        raise ValueError("结论与证据超过项目记忆 40 KB 限额，请先精简记录")
    return text


def options(d, project, workspace):
    reason = ""
    if workspace.archived:
        reason = "请先恢复项目"
    elif _external(workspace) and research_locations.busy_workspace(
        d, workspace, exclude_session_id=project.session_id
    ):
        reason = "工作区里另一项研究仍在运行，请等待其结束或暂停"
    elif (
        session := d.get(AgentSession, project.session_id)
    ) is None or session.archived_at:
        reason = "请先恢复研究会话"
    elif _active(d, project):
        reason = "请等待当前轮次和实验结束"
    elif project.status not in ("paused", "finished"):
        reason = "请先暂停或完成研究"
    elif not rr.available():
        reason = "找不到 Git"
    code = not reason
    memory_reason = reason
    if not memory_reason:
        if project.status != "finished" or project.end_reason not in (
            "concluded",
            "refuted",
        ):
            memory_reason = "请先完成并确认研究结论"
        elif not (project.conclusion or {}).get("accepted") and not (
            project.budget or {}
        ).get("auto_decide"):
            memory_reason = "请先确认研究结论"
        else:
            try:
                _memory(d, project)
            except ValueError as exc:
                memory_reason = str(exc)
    return {
        "memory": not memory_reason,
        "code": code,
        "reason": memory_reason or reason,
        "memory_reason": memory_reason,
        "code_reason": reason,
    }


def _safe_path(path):
    parts = PurePosixPath(path).parts
    if (
        not path
        or path.startswith(("/", ":"))
        or "\\" in path
        or "\0" in path
        or not parts
        or any(x == ".." or x.lower() == ".git" for x in parts)
    ):
        raise ValueError("合并文件路径不合法")
    if str(PurePosixPath(path)) != path:
        raise ValueError("合并文件路径不合法")
    if parts[0] == "memory" or path in {"PROJECT.md", "AGENTS.md"}:
        raise ValueError("项目记忆和项目说明不能通过代码合并覆盖")
    return path


def _external(workspace):
    return (workspace.location or {}).get("kind") in {"local", "ssh"}


def _target(settings, workspace):
    from .research_locations import connection, location_for

    result = location_for(settings, workspace)
    if result["kind"] == "ssh":
        item = connection(settings, result["connection_id"])
        result = {**result, **{key: item.get(key, "") for key in ("host", "port", "identity_file")}}
    return result


def _published(settings, workspace, row, commit):
    import json

    receipt = rr.home(settings, workspace.id) / "published" / (row.id + ".json")
    try:
        return json.loads(receipt.read_text()).get("commit") == commit
    except (OSError, ValueError):
        return False


def _publish(settings, workspace, row, commit, *, recover=False):
    """A private Git receipt precedes physical publishing, so retries can finish it."""
    if not (row.preview or {}).get("target_manifest"):
        return
    from . import research_publish
    import json

    if _target(settings, workspace) != row.preview["target_location"]:
        raise ValueError("目标工作区或 SSH 连接已变化，请重新预览")
    if _published(settings, workspace, row, commit):
        return
    with rr.temporary_worktree(settings, workspace.id, commit) as worktree:
        research_publish.publish(settings, workspace, row.paths,
            row.preview["target_manifest"], worktree, recover=recover)
    receipt = rr.home(settings, workspace.id) / "published" / (row.id + ".json")
    receipt.parent.mkdir(exist_ok=True)
    temporary = receipt.with_suffix(".tmp")
    temporary.write_text(json.dumps({"commit": commit}))
    temporary.replace(receipt)


def _heads(settings, workspace, project):
    repo = rr.repo_dir(settings, workspace.id)
    source = rr.thread_dir(settings, workspace.id, project.id)
    if not (source / ".git").exists() or rr.owner(source) != project.id:
        raise ValueError("研究尚未建立自己的文件检查点")
    branch = rr.git(source, "symbolic-ref", "--short", "HEAD").stdout.strip()
    if branch != rr.branch_of(project.id):
        raise ValueError("研究目录和分支不一致")
    if rr.git(repo, "symbolic-ref", "--short", "HEAD").stdout.strip() != "main":
        raise ValueError("项目仓库当前没有检出 main")
    if rr.git(
        repo, "status", "--porcelain", "--untracked-files=all", "--ignored=matching"
    ).stdout:
        raise ValueError("项目主目录有未提交文件，请先保存后再合并")
    if rr.git(source, "status", "--porcelain", "--untracked-files=all").stdout:
        raise ValueError("研究目录有未提交文件，请等待检查点保存后再合并")
    return repo, source, rr.head(repo), rr.head(source)


def _clipped(text):
    raw = text.encode("utf-8")
    return raw[:DIFF_BYTES].decode("utf-8", errors="ignore"), len(raw) > DIFF_BYTES


def _file_diff(worktree, path, conflict=False):
    args = ["--literal-pathspecs", "diff"]
    if not conflict:
        args += ["--cached"]
    diff = rr.git(
        worktree, *args, "--no-ext-diff", "--no-textconv", "--", path, errors="replace"
    ).stdout
    clipped, truncated = _clipped(diff)
    return {
        "path": path,
        "status": "conflict" if conflict else "changed",
        "diff": clipped,
        "truncated": truncated,
        "binary": "Binary files " in diff or "GIT binary patch" in diff,
    }


def _candidates(repo, main, source):
    base = rr.git(repo, "merge-base", main, source).stdout.strip()
    names = rr.git(
        repo,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-only",
        "-z",
        base,
        source,
    ).stdout.split("\0")
    return base, sorted(
        name
        for name in names
        if name and name not in {"PROJECT.md", "AGENTS.md"} and not name.startswith("memory/")
    )


def _bounded_selection(repo, commits, paths):
    total = 0
    for commit in set(commits):
        entries = rr.git(
            repo, "--literal-pathspecs", "ls-tree", "-rlz", commit, "--", *paths
        ).stdout.split("\0")
        for entry in entries:
            if "\t" not in entry:
                continue
            metadata, _path = entry.split("\t", 1)
            _mode, kind, _blob, size = metadata.split()
            if kind == "blob":
                total += int(size)
                if total > SELECTION_BYTES:
                    raise ValueError("选定文件及其基线超过 40 MB，请分批选择文件")


def _prepare(settings, workspace, row, worktree):
    """Stage precisely this preview's selection; conflicting state stays isolated."""
    if row.kind == "memory":
        target = worktree / row.paths[0]
        if target.is_symlink() or target.parent.is_symlink():
            raise ValueError("项目记忆路径不能是符号链接")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(row.preview["memory_text"], encoding="utf-8")
        rr.git(worktree, "--literal-pathspecs", "add", "--", row.paths[0])
    else:
        base = row.preview["base_commit"]
        patchfile = worktree.parent / "selection.patch"
        rr.git(
            rr.repo_dir(settings, workspace.id),
            "--literal-pathspecs",
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            f"--output={patchfile}",
            base,
            row.expected_source_commit,
            "--",
            *row.paths,
        )
        if patchfile.stat().st_size > SELECTION_BYTES:
            raise ValueError("选定文件的差异超过 40 MB，请分批选择文件")
        if patchfile.stat().st_size:
            applied = rr.git(
                worktree, "apply", "--3way", "--index", str(patchfile), check=False
            )
            conflicts = [
                x
                for x in rr.git(
                    worktree, "diff", "--name-only", "--diff-filter=U", "-z"
                ).stdout.split("\0")
                if x
            ]
            if conflicts:
                changed = set(
                    x
                    for x in rr.git(
                        worktree, "diff", "--cached", "--name-only", "-z"
                    ).stdout.split("\0")
                    if x
                )
                conflict_files = [
                    _file_diff(worktree, name, True) for name in conflicts
                ]
                return {
                    "files": [
                        _file_diff(worktree, name)
                        for name in sorted(changed - set(conflicts))
                    ]
                    + conflict_files,
                    "conflicts": conflict_files,
                }
            if applied.returncode:
                raise rr.GitError("选定文件无法合并：" + applied.stderr.strip()[-500:])
    changed = [
        x
        for x in rr.git(worktree, "diff", "--cached", "--name-only", "-z").stdout.split(
            "\0"
        )
        if x
    ]
    return {"files": [_file_diff(worktree, path) for path in changed], "conflicts": []}


def preview(d, settings, workspace, project, kind, paths=None):
    capability = options(d, project, workspace)
    if not capability[kind]:
        raise ValueError(capability[f"{kind}_reason"])
    repo = rr.repo_dir(settings, workspace.id)
    with rr._locked(rr.home(settings, workspace.id)):
        repo, _source, main, source = _heads(settings, workspace, project)
        if _external(workspace):
            # Refresh only our private mirror; the user's Git is never staged.
            rr.snapshot_source(settings, workspace, repo)
            rr.checkpoint(repo, "记录成果预览时的工作区状态")
            repo, _source, main, source = _heads(settings, workspace, project)
        data = {}
        if kind == "memory":
            if paths is not None:
                raise ValueError("项目记忆的目标路径由系统确定")
            data["memory_text"] = _memory(d, project, source)
            data["data_hash"] = hashlib.sha256(data["memory_text"].encode()).hexdigest()
            selection = [f"memory/{project.id}.md"]
        else:
            base, candidates = _candidates(repo, main, source)
            selection = sorted(
                set(
                    _safe_path(path)
                    for path in (candidates if paths is None else paths)
                )
            )
            if not selection or len(selection) > 200:
                raise ValueError("请选择 1 至 200 个有修改的文件")
            if any(path not in candidates for path in selection):
                raise ValueError("只能选择这项研究中有修改的文件")
            data["base_commit"] = base
        _bounded_selection(
            repo, [main, source, data.get("base_commit", main)], selection
        )
        if _external(workspace):
            from . import research_publish

            data["target_location"] = _target(settings, workspace)
            data["target_manifest"] = research_publish.manifest(settings, workspace, selection)
        row = ResearchMerge(
            owner=project.owner,
            workspace_id=workspace.id,
            project_id=project.id,
            kind=kind,
            expected_main_commit=main,
            expected_source_commit=source,
            paths=selection,
            preview=data,
            status="preview",
        )
        d.add(row)
        d.flush()
        with rr.temporary_worktree(settings, workspace.id, main) as worktree:
            result = _prepare(settings, workspace, row, worktree)
            if _external(workspace) and not result["conflicts"]:
                research_publish.changes(worktree, selection, data["target_manifest"])
        row.preview = {**data, **result}
        if result["conflicts"]:
            row.status = "conflict"
        return row


def _committed(repo, merge_id):
    marker = f"ORA-Merge: {merge_id}"
    found = rr.git(
        repo,
        "log",
        "refs/heads/main",
        "--fixed-strings",
        f"--grep={marker}",
        "--format=%H%x00%B%x00",
    ).stdout.split("\0")
    for index in range(0, len(found) - 1, 2):
        if marker in found[index + 1].splitlines():
            return found[index].strip()
    return ""


def _mark_applied(d, project, row, commit):
    from . import research_map

    row.status, row.commit_sha, row.error, row.updated_at = "applied", commit, "", now()
    project.merged = {
        **(project.merged or {}),
        row.kind: {
            "merge_id": row.id,
            "commit_sha": commit,
            "paths": row.paths,
            "at": row.updated_at,
        },
    }
    if not any(
        (event.detail or {}).get("merge_id") == row.id
        for event in d.scalars(
            select(ResearchEvent).where(
                ResearchEvent.project_id == project.id,
                ResearchEvent.action == "results_merged",
            )
        )
    ):
        research_map.event(
            d,
            project,
            None,
            "human",
            "results_merged",
            {
                "summary": (
                    "已合并研究结论与证据"
                    if row.kind == "memory"
                    else "已合并研究代码：" + "、".join(row.paths)
                ),
                "research_id": project.id,
                "merge_id": row.id,
                "commit_sha": commit,
                "kind": row.kind,
            },
        )
    return row


def apply(d, settings, workspace, project, row, expected_main, expected_source):
    if (expected_main, expected_source) != (
        row.expected_main_commit,
        row.expected_source_commit,
    ):
        raise ValueError("确认的提交与预览不一致，请重新预览")
    if row.status == "applied":
        return row
    if row.status != "preview":
        raise ValueError("这份预览不能应用，请重新预览")
    with rr._locked(rr.home(settings, workspace.id)):
        repo = rr.repo_dir(settings, workspace.id)
        recovered = _committed(repo, row.id)
        if recovered:
            if _external(workspace) and not _published(
                settings, workspace, row, recovered
            ):
                from .research_locations import busy_workspace

                if _active(d, project):
                    raise ValueError("请等待当前轮次和实验结束")
                if busy_workspace(d, workspace, exclude_session_id=project.session_id):
                    raise ValueError("工作区里另一项研究仍在运行，请等待其结束或暂停")
                _publish(settings, workspace, row, recovered, recover=True)
            return _mark_applied(d, project, row, recovered)
        capability = options(d, project, workspace)
        if not capability[row.kind]:
            raise ValueError(capability[f"{row.kind}_reason"])
        repo, _source, main, source = _heads(settings, workspace, project)
        if main != expected_main or source != expected_source:
            raise ValueError("主分支或研究检查点已经变化，请重新预览")
        if (row.preview or {}).get("target_manifest"):
            from . import research_publish

            if _target(settings, workspace) != row.preview["target_location"] or research_publish.manifest(
                settings, workspace, row.paths
            ) != row.preview["target_manifest"]:
                raise ValueError("工作区文件或目录已经变化，请重新预览")
        if (
            row.kind == "memory"
            and hashlib.sha256(_memory(d, project, source).encode()).hexdigest()
            != row.preview["data_hash"]
        ):
            raise ValueError("研究结论或证据已经变化，请重新预览")
        with rr.temporary_worktree(settings, workspace.id, main) as worktree:
            result = _prepare(settings, workspace, row, worktree)
            if result["conflicts"]:
                row.preview = {**row.preview, **result}
                row.status, row.updated_at = "conflict", now()
                return row
            if result["files"]:
                rr.git(
                    worktree,
                    "commit",
                    "-q",
                    "--no-verify",
                    "-m",
                    f"合并研究成果：{' '.join(project.question.split())[:100]}\n\nORA-Merge: {row.id}",
                )
                commit = rr.head(worktree)
                # Recheck just before changing main; never force-reset user files.
                _repo, _source, fresh_main, fresh_source = _heads(
                    settings, workspace, project
                )
                if (fresh_main, fresh_source) != (main, source):
                    raise ValueError("主分支或研究检查点已经变化，请重新预览")
                rr.git(
                    repo,
                    "merge",
                    "--ff-only",
                    "--no-overwrite-ignore",
                    "--no-edit",
                    commit,
                )
            else:
                commit = main
        _publish(settings, workspace, row, commit)
        return _mark_applied(d, project, row, commit)


def install_merge_routes(app, settings, db, auth, human, owned):
    def allowed(a):
        human(a)
        if settings.mode != "local":
            raise HTTPException(403, "研究功能只在本机版提供")

    def workspace_of(d, id, a):
        allowed(a)
        return owned(d, ResearchWorkspace, id, a)

    def project_of(d, id, a, writable=False):
        allowed(a)
        project = owned(d, ResearchProject, id, a)
        if not project.workspace_id:
            raise HTTPException(409, "研究没有所属项目")
        workspace = owned(d, ResearchWorkspace, project.workspace_id, a)
        if writable:
            from .research_chat import lock_session
            from .research_workspaces import lock_workspace

            session = owned(d, AgentSession, project.session_id, a)
            lock_session(d, session)
            lock_workspace(d, workspace)
            d.refresh(project)
            if session.archived_at or workspace.archived:
                raise HTTPException(409, "请先恢复项目或研究会话")
        return project, workspace

    @app.get(BASE + "/projects/{id}/merge-options")
    def get_options(id: str, d=Depends(db), a=Depends(auth)):
        project, workspace = project_of(d, id, a)
        result = options(d, project, workspace)
        if not (rr.thread_dir(settings, workspace.id, project.id) / ".git").exists():
            return {
                "memory": False,
                "code": False,
                "reason": "研究尚未建立自己的文件检查点",
            }
        return result

    @app.get(BASE + "/projects/{id}/merges")
    def project_merges(id: str, d=Depends(db), a=Depends(auth)):
        project, _workspace = project_of(d, id, a)
        return [
            output(row, project)
            for row in d.scalars(
                select(ResearchMerge)
                .where(
                    ResearchMerge.project_id == project.id,
                    ResearchMerge.owner == a["id"],
                )
                .order_by(ResearchMerge.created_at.desc(), ResearchMerge.id.desc())
            )
        ]

    @app.get(BASE + "/workspaces/{id}/merges")
    def workspace_merges(id: str, d=Depends(db), a=Depends(auth)):
        workspace_of(d, id, a)
        rows = d.execute(
            select(ResearchMerge, ResearchProject)
            .join(ResearchProject, ResearchProject.id == ResearchMerge.project_id)
            .where(
                ResearchMerge.workspace_id == id,
                ResearchMerge.owner == a["id"],
                ResearchProject.owner == a["id"],
            )
            .order_by(ResearchMerge.created_at.desc(), ResearchMerge.id.desc())
        )
        return [output(row, project) for row, project in rows]

    @app.get(BASE + "/workspaces/{id}/memory")
    def memory(
        id: str,
        response: Response,
        limit: int | None = Query(default=None, ge=1, le=200),
        after: str = Query(default="", max_length=1000),
        d=Depends(db),
        a=Depends(auth),
    ):
        workspace_of(d, id, a)
        try:
            items, next_cursor = rr.memory_page(
                settings, id, limit=limit, after=unquote(after)
            )
        except (rr.GitError, UnicodeError, ValueError) as exc:
            raise HTTPException(409, "无法读取项目记忆：" + str(exc)) from None
        if next_cursor:
            response.headers["X-Next-Cursor"] = quote(next_cursor, safe="")
        records = list(
            d.scalars(
                select(ResearchMerge)
                .options(
                    load_only(
                        ResearchMerge.project_id,
                        ResearchMerge.paths,
                        ResearchMerge.commit_sha,
                        ResearchMerge.updated_at,
                    )
                )
                .where(
                    ResearchMerge.workspace_id == id,
                    ResearchMerge.owner == a["id"],
                    ResearchMerge.kind == "memory",
                    ResearchMerge.status == "applied",
                )
                .order_by(ResearchMerge.created_at.desc())
            )
        )
        by_path = {}
        for record in records:
            for path in record.paths:
                by_path.setdefault(path, record)
        titles = dict(
            d.execute(
                select(ResearchProject.id, ResearchProject.question).where(
                    ResearchProject.workspace_id == id, ResearchProject.owner == a["id"]
                )
            ).all()
        )
        result = []
        for item in items:
            record = by_path.get(item["path"])
            research_id = (
                record.project_id if record and record.project_id in titles else ""
            )
            result.append(
                {
                    **item,
                    "research_id": research_id,
                    "title": titles.get(research_id, item["path"]),
                    "merge_commit_sha": record.commit_sha if record else "",
                    "updated_at": record.updated_at if record else "",
                }
            )
        return result

    @app.post(BASE + "/projects/{id}/merge-preview")
    def make_preview(id: str, body: PreviewInput, d=Depends(db), a=Depends(auth)):
        project, workspace = project_of(d, id, a, True)
        try:
            row = preview(d, settings, workspace, project, body.kind, body.paths)
            d.commit()
            return output(row, project)
        except (ValueError, rr.GitError) as exc:
            raise HTTPException(409, str(exc)) from None

    def merge_of(d, id, merge_id, a):
        project, workspace = project_of(d, id, a, True)
        row = d.get(ResearchMerge, merge_id)
        if (
            row is None
            or row.project_id != project.id
            or row.owner != a["id"]
            or row.workspace_id != workspace.id
        ):
            raise HTTPException(404, "Not found")
        return project, workspace, row

    @app.post(BASE + "/projects/{id}/merges/{merge_id}/apply")
    def apply_preview(
        id: str, merge_id: str, body: ApplyInput, d=Depends(db), a=Depends(auth)
    ):
        project, workspace, row = merge_of(d, id, merge_id, a)
        try:
            apply(
                d,
                settings,
                workspace,
                project,
                row,
                body.expected_main_commit,
                body.expected_source_commit,
            )
            d.commit()
            return output(row, project)
        except (ValueError, rr.GitError) as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post(BASE + "/projects/{id}/merges/{merge_id}/cancel")
    def cancel(id: str, merge_id: str, d=Depends(db), a=Depends(auth)):
        project, workspace, row = merge_of(d, id, merge_id, a)
        if row.status == "applied":
            raise HTTPException(409, "已应用的成果不能取消")
        try:
            with rr._locked(rr.home(settings, workspace.id)):
                recovered = _committed(rr.repo_dir(settings, workspace.id), row.id)
                if recovered:
                    _mark_applied(d, project, row, recovered)
                else:
                    row.status, row.updated_at = "cancelled", now()
                d.commit()
                return output(row, project)
        except rr.GitError as exc:
            raise HTTPException(409, str(exc)) from None
