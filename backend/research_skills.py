"""Read-only access to the bundled research role instructions."""

import re

from .local.paths import agent_runtime_dir


def read_role(role_id):
    if not re.fullmatch(r"research-[a-z0-9]+(?:-[a-z0-9]+)*", role_id):
        raise FileNotFoundError(role_id)
    root = (agent_runtime_dir() / "skills").resolve()
    path = root / role_id / "SKILL.md"
    if path.resolve() != path:
        raise FileNotFoundError(role_id)
    body = path.read_text(encoding="utf-8")
    title = next(
        (line[2:].strip() for line in body.splitlines() if line.startswith("# ")),
        role_id,
    )
    return {"id": role_id, "title": title, "body": body}


def list_roles():
    roles = []
    for path in sorted((agent_runtime_dir() / "skills").glob("research-*/SKILL.md")):
        try:
            role = read_role(path.parent.name)
        except (OSError, UnicodeError):
            continue
        roles.append({"id": role["id"], "title": role["title"]})
    return roles
