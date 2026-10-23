"""A project's files as a git repository, and each research as a worktree of it.

    <data>/research-projects/<project id>/
      repo/                 the project: main branch (AGENTS.md, memory/, shared/)
      threads/<research>/   one worktree per research, on branch research/<short id>

A research's working folder (research_sandbox.workdir) is its worktree: the
old folder research/<id>/work becomes a link to it, so everything that finds
the folder by the research's id alone (tools, jobs, the files panel, SSH sync)
keeps working. At the end of each round the worktree is committed, a
checkpoint later steps fork from and compare against.

As in Codex's worktree manager, a worktree records which research owns it in
its git metadata (ora-research.json), a worktree that could not be finished
is removed again, and macOS is asked not to index the folders.

Git is the one the desktop app carries (ORA_GIT_DIR), else the system's. With
no git at all research keeps its plain folders, as before.
"""

import contextlib
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import time
import tempfile
from pathlib import Path

from .filelock import lock_nowait, unlock

IDENTITY = ["-c", "user.name=Open Research Agent", "-c", "user.email=agent@ora.local"]
# Nothing of the person's own git setup applies here: no hooks, no signing,
# no prompts, no pager.
QUIET = [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.quotepath=false",
    "-c",
    "init.defaultBranch=main",
]
# Larger files are left out of a checkpoint (weights, arrays, archives).
MAX_BYTES = 20 * 1024 * 1024
IGNORE = """\
# Kept out of the project's history: data, environments, weights, caches.
library/
data/
.venv/
venv/
__pycache__/
*.pyc
.ipynb_checkpoints/
*.pt
*.pth
*.ckpt
*.safetensors
*.onnx
*.h5
wandb/
swanlog/
mlruns/
.DS_Store
"""
OWNER = "ora-research.json"


class GitError(RuntimeError):
    pass


def git_binary():
    home = os.environ.get("ORA_GIT_DIR")
    if home:
        found = Path(home) / "bin" / "git"
        if found.exists():
            return str(found)
    return shutil.which("git")


def available():
    return git_binary() is not None


def _env():
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("GIT_") or k in ("GIT_SSH_COMMAND",)
    }
    env.update(
        GIT_TERMINAL_PROMPT="0",
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
        LC_ALL="C",
    )
    home = os.environ.get("ORA_GIT_DIR")
    if home:
        # The carried git finds its helpers and templates beside itself.
        env["GIT_EXEC_PATH"] = str(Path(home) / "libexec" / "git-core")
        env["GIT_TEMPLATE_DIR"] = str(Path(home) / "share" / "git-core" / "templates")
    return env


def git(cwd, *args, check=True, timeout=120, errors=None, input=None, text=True):
    binary = git_binary()
    if binary is None:
        raise GitError("找不到 git")
    try:
        done = subprocess.run(
            [binary, *IDENTITY, *QUIET, *args],
            cwd=str(cwd),
            env=_env(),
            capture_output=True,
            text=text,
            errors=errors,
            input=input,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitError("Git 暂时不可用：" + str(exc)[:300]) from None
    if check and done.returncode != 0:
        detail = done.stderr or done.stdout or ""
        if isinstance(detail, bytes):
            detail = detail.decode("utf-8", errors="replace")
        raise GitError(f"git {args[0]} 失败：" + detail.strip()[-500:])
    return done


def home(settings, workspace_id):
    if not workspace_id or "/" in workspace_id or ".." in workspace_id:
        raise ValueError("项目编号不合法")
    return Path(settings.storage).parent / "research-projects" / workspace_id


def repo_dir(settings, workspace_id):
    return home(settings, workspace_id) / "repo"


def thread_dir(settings, workspace_id, project_id):
    if not project_id or "/" in project_id or ".." in project_id:
        raise ValueError("研究编号不合法")
    return home(settings, workspace_id) / "threads" / project_id


def branch_of(project_id):
    return f"research/{project_id[:8]}"


@contextlib.contextmanager
def _locked(root, wait=60.0):
    """One git writer per project at a time (worktrees share one repository)."""
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".lock", "a+") as handle:
        deadline = time.monotonic() + wait
        while True:
            try:
                lock_nowait(handle)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise GitError("项目仓库正被占用，稍后再试") from None
                time.sleep(0.05)
        try:
            yield
        finally:
            unlock(handle)


def _never_index(folder):
    if sys.platform == "darwin":
        (folder / ".metadata_never_index").touch()


def ensure_repo(settings, workspace, *, snapshot=True):
    """The project's repository, made once: AGENTS.md, memory/, the ignore list."""
    repo = repo_dir(settings, workspace.id)
    if (repo / ".git").exists():
        migrate_instructions(settings, workspace)
        return repo
    root = home(settings, workspace.id)
    with _locked(root):
        if (repo / ".git").exists():
            return repo
        _never_index(root)
        repo.mkdir(parents=True, exist_ok=True)
        git(repo, "init", "-q", "-b", "main")
        (repo / ".gitignore").write_text(IGNORE)
        (repo / "AGENTS.md").write_text(_project_md(workspace))
        for folder in ("memory", "shared"):
            (repo / folder).mkdir(exist_ok=True)
            (repo / folder / ".gitkeep").touch()
        if snapshot:
            snapshot_source(settings, workspace, repo)
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", f"项目：{workspace.name}"[:200])
    return repo


def migrate_instructions(settings, workspace):
    repo = repo_dir(settings, workspace.id)
    old, new = repo / "PROJECT.md", repo / "AGENTS.md"
    if not old.exists() or new.exists():
        return
    with _locked(home(settings, workspace.id)):
        if old.exists() and not new.exists():
            if old.is_symlink():
                raise GitError("PROJECT.md 不能是符号链接")
            old.rename(new)
            git(repo, "add", "--", "PROJECT.md", "AGENTS.md")
            git(
                repo,
                "commit",
                "-q",
                "-m",
                "ORA 将 PROJECT.md 改名为 AGENTS.md",
                "--",
                "PROJECT.md",
                "AGENTS.md",
            )


def _project_md(workspace):
    parts = [f"# {workspace.name}"]
    if workspace.description:
        parts.append(workspace.description)
    if workspace.instructions:
        parts.append("## 项目说明\n\n" + workspace.instructions)
    return "\n\n".join(parts) + "\n"


def owner(worktree):
    path = _git_path(worktree, OWNER)
    try:
        return json.loads(path.read_text()).get("research_id")
    except (OSError, ValueError):
        return None


def _git_path(worktree, name):
    out = git(worktree, "rev-parse", "--git-path", name).stdout.strip()
    return (worktree / out).resolve()


def ensure_thread(settings, workspace, project, base="main"):
    """The research's worktree, made once on its own branch; returns its path."""
    path = thread_dir(settings, workspace.id, project.id)
    if (path / ".git").exists():
        return path
    repo = ensure_repo(settings, workspace)
    with _locked(home(settings, workspace.id)):
        if (path / ".git").exists():
            return path
        snapshot_source(settings, workspace, repo)
        checkpoint(repo, "同步项目代码")
        path.parent.mkdir(parents=True, exist_ok=True)
        # A worktree whose folder was deleted still holds its branch until pruned.
        git(repo, "worktree", "prune")
        branch = branch_of(project.id)
        exists = git(
            repo, "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False
        )
        args = (
            [str(path), branch]
            if exists.returncode == 0
            else ["-b", branch, str(path), base]
        )
        git(repo, "worktree", "add", "-q", *args)
        try:
            _git_path(path, OWNER).write_text(
                json.dumps({"version": 1, "research_id": project.id})
            )
        except Exception:
            # A worktree nobody owns is taken back rather than left half made.
            git(repo, "worktree", "remove", "--force", str(path), check=False)
            raise
    return path


def _guard_large(worktree):
    """Files over MAX_BYTES stay out of history: listed in the repository's exclude."""
    out = git(worktree, "status", "--porcelain", "-z", "-uall").stdout
    large = []
    for entry in out.split("\0"):
        if len(entry) < 4 or entry[:2] not in ("??", " M", "M ", "MM", "A ", "AM"):
            continue
        rel = entry[3:]
        try:
            if (worktree / rel).stat().st_size > MAX_BYTES:
                large.append(rel)
        except OSError:
            continue
    if large:
        exclude = _git_path(worktree, "info/exclude")
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude, "a") as f:
            f.writelines(f"/{rel}\n" for rel in large)
        for rel in large:
            git(worktree, "rm", "-q", "--cached", "--ignore-unmatch", "--", rel)
    return large


def checkpoint(worktree, message):
    """Commits what changed in the worktree; returns the commit, or "" if nothing did."""
    worktree = Path(worktree)
    if not (worktree / ".git").exists():
        return ""
    _guard_large(worktree)
    git(worktree, "add", "-A")
    if git(worktree, "diff", "--cached", "--quiet", check=False).returncode == 0:
        return ""
    git(worktree, "commit", "-q", "--no-verify", "-m", message[:2000] or "检查点")
    return head(worktree)


def head(worktree):
    return git(worktree, "rev-parse", "HEAD").stdout.strip()


def legacy_dir(settings, project_id):
    return Path(settings.storage).parent / "research" / project_id / "work"


def adopt(settings, workspace, project):
    """Moves a research's plain folder into its worktree and links the old path to it.

    Idempotent: a research already in its worktree is left as it is. Files
    move (a rename, so nothing is copied); a name the worktree already has
    from the project (.gitignore, AGENTS.md) keeps the research's own copy.
    """
    from . import research_locations

    location = research_locations.bind(settings, workspace, project)
    old = legacy_dir(settings, project.id)
    if location["kind"] in {"local", "ssh"}:
        path = ensure_thread(settings, workspace, project)
        if old.exists() and not old.is_symlink():
            if (old / ".git").exists():
                raise GitError("暂存目录已有 Git 历史，请先保留原目录再绑定")
            # Uploads may be staged before the first worker tick. This is an app
            # folder, never the user's selected directory; retain those uploads.
            for child in old.iterdir():
                target = path / child.name
                if child.is_dir() and target.is_dir():
                    shutil.copytree(child, target, dirs_exist_ok=True)
                    shutil.rmtree(child)
                elif target.exists() or target.is_symlink():
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                    os.replace(child, target)
                else:
                    os.replace(child, target)
            old.rmdir()
        if not old.is_symlink():
            old.parent.mkdir(parents=True, exist_ok=True)
            old.symlink_to(path, target_is_directory=True)
        return path
    if old.is_symlink():
        return old.resolve()
    path = ensure_thread(settings, workspace, project)
    if old.is_dir():
        for child in sorted(old.iterdir()):
            target = path / child.name
            if child.name == ".git":
                continue
            if child.name == ".gitignore" and child.is_file():
                # The research's own rules come on top of the project's.
                with open(target, "a") as f:
                    f.write(
                        "\n# The research's own\n" + child.read_text(errors="replace")
                    )
                child.unlink()
                continue
            if target.exists() or target.is_symlink():
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            os.replace(child, target)
        old.rmdir()
    old.parent.mkdir(parents=True, exist_ok=True)
    old.symlink_to(path, target_is_directory=True)
    with _locked(home(settings, workspace.id)):
        checkpoint(path, "导入研究原有的文件")
    return path.resolve()


def settle(settings, maker):
    """Brings every research into its project's repository (once each)."""
    if not available():
        return
    from sqlalchemy import select

    from .models import ResearchProject, ResearchSprint, ResearchWorkspace

    with maker() as d:
        rows = [
            (p, d.get(ResearchWorkspace, p.workspace_id))
            for p in d.scalars(
                select(ResearchProject).where(ResearchProject.workspace_id.is_not(None))
            )
        ]
        for project, workspace in rows:
            if workspace is None or legacy_dir(settings, project.id).is_symlink():
                continue
            path = adopt(settings, workspace, project)
            # Rounds from before have no checkpoint of their own: the import stands for them.
            imported = head(path)
            for sprint in d.scalars(
                select(ResearchSprint).where(
                    ResearchSprint.project_id == project.id,
                    ResearchSprint.status != "running",
                    ResearchSprint.commit_sha == "",
                )
            ):
                sprint.commit_sha = imported
            d.commit()


def checkpoints(settings, maker):
    """Commits each research round that ended since: its worktree as it stood then.

    A research on an SSH machine has its files there; what changed comes back
    first (files over MAX_BYTES stay there).
    """
    if not available():
        return
    from sqlalchemy import select

    from . import research_remote
    from .research_locations import execution_compute
    from .models import ResearchProject, ResearchSprint

    with maker() as d:
        for sprint in d.scalars(
            select(ResearchSprint).where(
                ResearchSprint.status.in_(["ended", "abnormal"]),
                ResearchSprint.commit_sha == "",
            )
        ):
            project = d.get(ResearchProject, sprint.project_id)
            if project is None or not legacy_dir(settings, project.id).is_symlink():
                continue
            if sprint.role == "executor":
                try:
                    item = execution_compute(settings, d, project)
                except ValueError:
                    item = None
                if (
                    item is not None
                    and item["kind"] == "ssh"
                    and not item.get("workspace_path")
                ):
                    research_remote.pull(settings, item, project.id, small=True)
            commit_round(settings, project, sprint)
            d.commit()


def commit_round(settings, project, sprint):
    """The checkpoint at the end of a round, its commit kept on the round."""
    old = legacy_dir(settings, project.id)
    if not old.is_symlink() or not available():
        return ""
    path = old.resolve()
    summary = (sprint.summary or "").strip().splitlines()
    message = f"第 {sprint.number} 轮" + (f"：{summary[0]}" if summary else "")
    if len(summary) > 1:
        message += "\n\n" + "\n".join(summary[1:])
    with _locked(path.parent.parent):
        from . import research_locations

        binding = research_locations.read_binding(settings, project.id)
        if binding.get("kind") in {"local", "ssh"}:
            from types import SimpleNamespace

            snapshot_source(
                settings,
                SimpleNamespace(id=project.workspace_id, location=binding),
                path,
            )
        commit = checkpoint(path, message) or head(path)
    sprint.commit_sha = commit
    return commit


SNAPSHOT_DIRS = {
    ".git",
    "data",
    "library",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    ".next",
    ".cache",
    ".ipynb_checkpoints",
    "wandb",
    "swanlog",
    "mlruns",
}
SNAPSHOT_FILES = (
    "*.pyc",
    "*.pt",
    "*.pth",
    "*.ckpt",
    "*.safetensors",
    "*.onnx",
    "*.h5",
    ".DS_Store",
)
SOURCE_FILES = "ora-source-files.json"


def _source_names(dest, settings, workspace):
    for path in (
        _git_path(dest, SOURCE_FILES),
        _git_path(repo_dir(settings, workspace.id), SOURCE_FILES),
    ):
        try:
            return {
                name
                for name in json.loads(path.read_text())
                if isinstance(name, str)
                and name
                and not Path(name).is_absolute()
                and ".." not in Path(name).parts
                and ".git" not in Path(name).parts
            }
        except (OSError, ValueError):
            continue
    return {
        p
        for p in git(dest, "ls-files", "-z").stdout.split("\0")
        if p
        and p not in {"PROJECT.md", "AGENTS.md", ".gitignore", "shared/.gitkeep"}
        and not p.startswith(("memory/", ".ora/agents/"))
    }


def snapshot_source(settings, workspace, dest):
    """Mirror physical source into an app-owned Git tree; never write the source.

    Caller holds the project Git writer lock. Source-file ownership is stored in
    Git metadata, so deletions are mirrored without deleting app memory files.
    """
    from . import research_locations

    location = research_locations.location_for(settings, workspace)
    if location["kind"] == "managed":
        return
    dest = Path(dest)
    previous = _source_names(dest, settings, workspace)
    if location["kind"] == "ssh":
        from . import research_remote

        with tempfile.TemporaryDirectory(
            prefix="source-", dir=home(settings, workspace.id)
        ) as folder:
            research_remote.snapshot_pull(
                settings,
                research_locations.connection(settings, location["connection_id"]),
                location["path"],
                Path(folder),
            )
            _mirror_local(settings, Path(folder), dest, previous)
    else:
        _mirror_local(settings, Path(location["path"]), dest, previous)


def snapshot_remote_worktree(settings, item, project_id, path, *, timeout=60):
    """Import remote code, including deletions, into an owned private worktree.

    SSH forks execute remotely after their initial seed. Pulling onto the old
    mirror without removing vanished source files would seal the wrong history.
    A fresh bounded snapshot lets the normal source-ownership importer distinguish
    deletions while retaining Git metadata, datasets, dependencies and weights.
    Never reconcile directly into a user's selected local directory.
    """
    from types import SimpleNamespace

    from . import research_locations, research_remote, research_sandbox

    binding = research_locations.read_binding(settings, project_id)
    if binding.get("kind") == "local":
        raise GitError("远端代码不能同步到本机绑定的用户目录")
    dest = research_sandbox.workdir(settings, project_id)
    if not (dest / ".git").exists():
        # Git-less legacy research cannot offer round forks. Its existing plain
        # app-owned folder retains the append-only transfer used before Git.
        legacy = legacy_dir(settings, project_id)
        if legacy.is_symlink() or dest.resolve() != legacy.resolve():
            raise GitError("远端代码同步目标不是应用私有目录")
        return False
    wid = binding.get("workspace_id")
    if (
        not wid
        or dest.resolve() != thread_dir(settings, wid, project_id).resolve()
        or owner(dest) != project_id
    ):
        raise GitError("远端代码同步目标不是本研究的私有工作树")
    workspace = SimpleNamespace(id=wid)
    with _locked(home(settings, wid)):
        with tempfile.TemporaryDirectory(
            prefix="remote-", dir=home(settings, wid)
        ) as folder:
            research_remote.snapshot_pull(
                settings, item, path, Path(folder), timeout=timeout
            )
            _mirror_local(
                settings, Path(folder), dest, _source_names(dest, settings, workspace)
            )
    return True


def _mirror_local(settings, source, dest, previous):
    if not source.is_dir():
        raise GitError("绑定的工作目录不存在")
    source = source.resolve()
    appdata = Path(settings.storage).parent.resolve()
    files, total = {}, 0
    for root, dirs, names in os.walk(source, followlinks=False):
        root = Path(root)
        dirs[:] = [
            name
            for name in dirs
            if name not in SNAPSHOT_DIRS
            and not (root / name).is_symlink()
            and (root / name).resolve() != appdata
            and not (root / name).resolve().is_relative_to(dest.resolve())
        ]
        for name in names:
            if name == ".git" or any(
                fnmatch.fnmatch(name, pattern) for pattern in SNAPSHOT_FILES
            ):
                continue
            path = root / name
            stat = path.lstat()
            if not path.is_file() or path.is_symlink() or stat.st_size > MAX_BYTES:
                continue
            rel = str(path.relative_to(source))
            files[rel] = (path, stat)
            total += stat.st_size
            if len(files) > 10_000 or total > 200 * 1024 * 1024:
                raise GitError(
                    "工作区代码快照超过 10000 个文件或 200 MB，请先排除数据和依赖目录"
                )
    # Record the intended ownership first: an interrupted copy can be safely retried.
    _git_path(dest, SOURCE_FILES).write_text(
        json.dumps(sorted(previous | files.keys()))
    )
    for rel in previous - files.keys():
        target = dest / rel
        if target.is_symlink() or target.is_file():
            target.unlink()
    for rel, (path, before) in files.items():
        target = dest / rel
        for parent in reversed(target.parents):
            if parent == dest:
                continue
            if dest in parent.parents and parent.is_symlink():
                parent.unlink()
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            target.unlink()
        if target.is_dir():
            shutil.rmtree(target)
        shutil.copy2(path, target)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise GitError("工作区文件在保存检查点时变化，请稍后重试")
    _git_path(dest, SOURCE_FILES).write_text(json.dumps(sorted(files)))


def validate_checkpoint(settings, workspace, source, commit_sha):
    """Resolve a checkpoint only when it belongs to this research's branch."""
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", commit_sha or ""):
        raise GitError("研究检查点不合法")
    repo = repo_dir(settings, workspace.id)
    resolved = git(
        repo, "rev-parse", "--verify", f"{commit_sha}^{{commit}}"
    ).stdout.strip()
    branch = f"refs/heads/{branch_of(source.id)}"
    if git(
        repo, "merge-base", "--is-ancestor", resolved, branch, check=False
    ).returncode:
        raise GitError("检查点不属于这项研究")
    return resolved


def fork_thread(settings, workspace, source, child, commit_sha):
    """Create an independently owned worktree at exactly the sealed checkpoint."""
    repo = ensure_repo(settings, workspace)
    path = thread_dir(settings, workspace.id, child.id)
    old = legacy_dir(settings, child.id)
    with _locked(home(settings, workspace.id)):
        commit = validate_checkpoint(settings, workspace, source, commit_sha)
        origin = {"research_id": source.id, "commit_sha": commit}
        if (path / ".git").exists():
            try:
                metadata = json.loads(_git_path(path, OWNER).read_text())
            except (OSError, ValueError):
                raise GitError("分叉目录缺少归属信息") from None
            if (
                metadata.get("research_id") != child.id
                or metadata.get("origin") != origin
            ):
                raise GitError("分叉目录已被其他研究使用")
            if not old.is_symlink() or old.resolve() != path.resolve():
                raise GitError("分叉目录链接不一致")
            return path
        if path.exists() or old.exists() or old.is_symlink():
            raise GitError("分叉目录已经存在")
        branch = branch_of(child.id)
        if (
            git(
                repo,
                "show-ref",
                "--verify",
                "--quiet",
                f"refs/heads/{branch}",
                check=False,
            ).returncode
            == 0
        ):
            raise GitError("分叉分支已经存在")
        path.parent.mkdir(parents=True, exist_ok=True)
        git(repo, "worktree", "prune")
        git(repo, "worktree", "add", "-q", "-b", branch, str(path), commit)
        try:
            _git_path(path, OWNER).write_text(
                json.dumps({"version": 1, "research_id": child.id, "origin": origin})
            )
            old.parent.mkdir(parents=True, exist_ok=True)
            old.symlink_to(path, target_is_directory=True)
        except Exception:
            if old.is_symlink() and old.resolve() == path.resolve():
                old.unlink()
            git(repo, "worktree", "remove", "--force", str(path), check=False)
            git(repo, "branch", "-D", branch, check=False)
            raise
    return path


def remove_thread(settings, workspace, child):
    """Remove only a failed child's owned worktree, branch, and legacy link."""
    repo = repo_dir(settings, workspace.id)
    path = thread_dir(settings, workspace.id, child.id)
    old = legacy_dir(settings, child.id)
    with _locked(home(settings, workspace.id)):
        if not (path / ".git").exists():
            return
        if owner(path) != child.id:
            raise GitError("不能清理其他研究的目录")
        branch = git(path, "symbolic-ref", "--short", "HEAD").stdout.strip()
        if branch != branch_of(child.id):
            raise GitError("研究分支与目录不一致")
        if old.is_symlink() and old.resolve() == path.resolve():
            old.unlink()
        git(repo, "worktree", "remove", "--force", str(path))
        git(repo, "branch", "-D", branch)


@contextlib.contextmanager
def temporary_worktree(settings, workspace_id, commit):
    """An isolated disposable worktree; caller holds the project's writer lock."""
    repo = repo_dir(settings, workspace_id)
    with tempfile.TemporaryDirectory(
        prefix="merge-", dir=home(settings, workspace_id)
    ) as folder:
        path = Path(folder) / "work"
        git(repo, "worktree", "add", "-q", "--detach", str(path), commit)
        try:
            yield path
        finally:
            git(repo, "worktree", "remove", "--force", str(path), check=False)
            git(repo, "worktree", "prune", check=False)


def committed_memory(settings, workspace_id):
    """Read confirmed project memory from main's Git objects, never dirty files."""
    repo = repo_dir(settings, workspace_id)
    if not available() or not (repo / ".git").exists():
        return []
    try:
        commit = git(repo, "rev-parse", "refs/heads/main").stdout.strip()
        entries = git(repo, "ls-tree", "-rlz", commit, "--", "memory/").stdout.split(
            "\0"
        )
        result, total = [], 0
        # Stable path order and hard bounds keep project context predictable.
        for entry in entries:
            if "\t" not in entry:
                continue
            metadata, path = entry.split("\t", 1)
            mode, kind, blob, size = metadata.split()
            if (
                mode not in ("100644", "100755")
                or kind != "blob"
                or not path.endswith(".md")
                or int(size) > 40_000
            ):
                continue
            if len(result) >= 20 or total + int(size) > 80_000:
                break
            try:
                text = git(repo, "cat-file", "blob", blob).stdout
            except UnicodeError:
                continue
            if "\0" in text:
                continue
            result.append({"path": path, "text": text, "commit_sha": commit})
            total += len(text.encode("utf-8"))
        return result
    except (GitError, UnicodeError, ValueError):
        return []


def memory_page(settings, workspace_id, *, limit=None, after=""):
    """UI memory, separate from the small model context budget.

    The compatible unpaged list includes every note's full body. Optional path
    pagination bounds each request for larger projects. One cat-file batch reads
    immutable blobs from a single captured main commit, without one process per
    note and without following filesystem symlinks.
    """
    repo = repo_dir(settings, workspace_id)
    if not available() or not (repo / ".git").exists():
        return [], ""
    commit = git(repo, "rev-parse", "refs/heads/main").stdout.strip()
    entries = git(repo, "ls-tree", "-rlz", commit, "--", "memory/").stdout.split("\0")
    candidates = []
    for entry in entries:
        if "\t" not in entry:
            continue
        metadata, path = entry.split("\t", 1)
        mode, kind, blob, _size = metadata.split()
        if (
            mode in ("100644", "100755")
            and kind == "blob"
            and path.endswith(".md")
            and path > after
        ):
            candidates.append((path, blob))
    candidates.sort()
    selected = candidates if limit is None else candidates[:limit]
    next_cursor = (
        selected[-1][0] if selected and len(selected) < len(candidates) else ""
    )
    if not selected:
        return [], next_cursor
    data = git(
        repo,
        "cat-file",
        "--batch",
        input="".join(f"{blob}\n" for _path, blob in selected).encode("ascii"),
        text=False,
    ).stdout
    result, offset = [], 0
    for path, blob in selected:
        newline = data.find(b"\n", offset)
        header = data[offset:newline].split()
        if (
            newline < 0
            or len(header) != 3
            or header[0].decode("ascii") != blob
            or header[1] != b"blob"
        ):
            raise GitError("无法读取项目记忆文件")
        size = int(header[2])
        raw = data[newline + 1 : newline + 1 + size]
        offset = newline + 1 + size + 1
        try:
            body = raw.decode("utf-8")
        except UnicodeError:
            continue
        if "\0" not in body:
            result.append({"path": path, "text": body, "commit_sha": commit})
    return result, next_cursor
