"""The team's project tree, including its authoritative agent documents."""

from . import research_repo as repo


def workdir(settings, workspace):
    # Member editors and external edits use this same tree. A second branch
    # would leave AGENTS.md and .ora/agents behind after definition edits.
    # Never fetch source code or open SSH just to run a channel/DM member.
    return repo.ensure_repo(settings, workspace, snapshot=False)


def seal(settings, workspace, run, message):
    info = (run.runtime or {}).get("team", {})
    if info.get("research_round") or "team_base" not in (run.runtime or {}):
        return
    path = workdir(settings, workspace)
    with repo._locked(repo.home(settings, workspace.id)):
        commit = repo.checkpoint(path, f"Team: {run.id}") or repo.head(path)
        changed = repo.git(
            path, "diff", "--name-only", "-z", run.runtime["team_base"], commit
        ).stdout
    files = []
    for rel in changed.split("\0"):
        target = path / rel
        if rel and target.is_file() and not target.is_symlink():
            files.append({"path": rel, "name": target.name})
    message.data = {**message.data, "files": files, "commit": commit}
