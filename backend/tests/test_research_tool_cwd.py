"""Pi's prompt cwd follows the same workspace/connection as its remote tools."""

import json
import subprocess
from types import SimpleNamespace
from uuid import uuid4

import pytest

from backend import research_locations as locations
from backend import research_sandbox as sandbox
from backend.models import ResearchProject, ResearchWorkspace
from backend.tests.test_research_locations import _ssh, world  # noqa: F401


def _fork(w, workspace, parent, item):
    return SimpleNamespace(
        id=str(uuid4()), parent_id=parent.id, owner=parent.owner,
        workspace_id=workspace.id, compute_id=item["id"],
    )


def test_bound_absolute_directories_need_no_ssh_query(world, monkeypatch):  # noqa: F811
    w = world
    monkeypatch.setattr(
        sandbox, "run", lambda *args, **kw: pytest.fail("must not query SSH")
    )
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        parent = d.get(ResearchProject, w.ids[2])
        assert locations.tool_cwd(w.settings, d, parent) == str(w.folder)
        workspace.location = {
            "kind": "ssh", "path": "/srv/selected remote project", "connection_id": "lab"
        }
        assert locations.tool_cwd(w.settings, d, parent) == "/srv/selected remote project"
        # Legacy managed Docker research keeps the container's actual tool root,
        # rather than advertising its private host-side Git mirror to the model.
        workspace.location = {"kind": "managed"}
        assert locations.tool_cwd(w.settings, d, parent) == "/work"
        parent.workspace_id = None
        assert locations.tool_cwd(w.settings, d, parent) == ""


def test_ssh_fork_resolves_home_on_its_connection_without_requiring_existing_folder(
    world, monkeypatch  # noqa: F811
):
    w = world
    item = _ssh(w)
    calls = []
    resolved = "/unrelated remote home/private work/fork/work"

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, json.dumps({"path": resolved}), "")

    monkeypatch.setattr(sandbox, "run", fake)
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        parent = d.get(ResearchProject, w.ids[2])
        workspace.location = {
            "kind": "ssh", "path": "/srv/team/selected", "connection_id": item["id"]
        }
        child = _fork(w, workspace, parent, item)
        assert locations.tool_cwd(w.settings, d, child) == resolved
    args, kwargs = calls[0]
    assert len(calls) == 1
    assert args[:1] == ["ssh"] and "2202" in args and item["identity_file"] in args
    assert args[-2] == item["host"]
    assert "realpath" in args[-1] and "expanduser" in args[-1]
    assert "isdir" not in args[-1] and "mkdir" not in args[-1]
    assert json.loads(kwargs["input"]) == {"path": f"~/ora/{child.id}/work"}
    assert kwargs["timeout"] == 25


@pytest.mark.parametrize("failure", ["offline", "timeout", "malformed", "relative"])
def test_ssh_cwd_resolution_failure_does_not_guess_local_home(
    world, monkeypatch, failure  # noqa: F811
):
    w = world
    item = _ssh(w)

    def fake(args, **kwargs):
        if failure == "timeout":
            raise subprocess.TimeoutExpired(args, 25)
        if failure == "offline":
            return subprocess.CompletedProcess(args, 255, "", "offline")
        output = "not JSON" if failure == "malformed" else '{"path":"~/still-relative"}'
        return subprocess.CompletedProcess(args, 0, output, "")

    monkeypatch.setattr(sandbox, "run", fake)
    with w.maker() as d:
        workspace = d.get(ResearchWorkspace, w.ids[1])
        parent = d.get(ResearchProject, w.ids[2])
        with pytest.raises(ValueError, match="SSH"):
            locations.tool_cwd(w.settings, d, _fork(w, workspace, parent, item))
