import os
import time
from datetime import datetime, timedelta, timezone

import pytest

from backend import research_sandbox
from backend.models import AgentRun, ResearchJob, ResearchSprint
from backend.research_sandbox import workdir
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


BASE = "/api/v1/research/projects"
# What every research's worktree starts with from its project (research_repo).
PROJECT_FILES = {".gitignore", "AGENTS.md", "memory", "shared", ".ora"}


def mine(entries):
    return [e for e in entries if e["name"] not in PROJECT_FILES]


def project(app, a, settings):
    _, model = configure(app, a, settings)
    r = a.post(BASE, json={"question": "Does L2 help?", "model_config_id": model})
    assert r.status_code == 200, r.text
    return r.json()


def url(p, what):
    return f"{BASE}/{p['id']}/workspace/{what}"


def test_lists_and_reads_files(env):
    app, a, _b, settings = env
    p = project(app, a, settings)
    root = workdir(settings, p["id"])
    (root / "src").mkdir()
    (root / "src" / "train.py").write_text("print('hi')\n")
    (root / "notes.md").write_text("# Notes\n")
    (root / "data.csv").write_text("a,b\n1,2\n")
    (root / "model.pt").write_bytes(b"\x00\x01\x02")
    (root / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    listed = a.get(url(p, "list")).json()
    assert [e["name"] for e in mine(listed["entries"])] == [
        "src",
        "data.csv",
        "model.pt",
        "notes.md",
        "plot.png",
    ]
    assert mine(listed["entries"])[0]["type"] == "dir"
    assert listed["path"] == "" and listed["round"] is None
    inner = a.get(url(p, "list"), params={"path": "src"}).json()
    assert [e["path"] for e in inner["entries"]] == ["src/train.py"]

    text = a.get(url(p, "file"), params={"path": "src/train.py"}).json()
    assert text["kind"] == "text" and text["content"] == "print('hi')\n"
    assert a.get(url(p, "file"), params={"path": "notes.md"}).json()["kind"] == "markdown"
    assert a.get(url(p, "file"), params={"path": "data.csv"}).json()["kind"] == "csv"
    binary = a.get(url(p, "file"), params={"path": "model.pt"}).json()
    assert binary["kind"] == "binary" and "content" not in binary
    image = a.get(url(p, "file"), params={"path": "plot.png", "raw": "true"})
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["content-disposition"].startswith("inline")
    down = a.get(url(p, "file"), params={"path": "src/train.py", "download": "true"})
    assert down.headers["content-disposition"].startswith("attachment")
    assert down.content == b"print('hi')\n"
    # Raw bytes of something that is not an image or PDF are never shown inline.
    page = a.get(url(p, "file"), params={"path": "notes.md", "raw": "true"})
    assert page.headers["content-disposition"].startswith("attachment")
    assert page.headers["content-type"] == "application/octet-stream"


def test_large_text_is_cut(env, monkeypatch):
    from backend import research_files

    monkeypatch.setattr(research_files, "TEXT_BYTES", 10)
    app, a, _b, settings = env
    p = project(app, a, settings)
    (workdir(settings, p["id"]) / "log.txt").write_text("x" * 50)
    out = a.get(url(p, "file"), params={"path": "log.txt"}).json()
    assert out["truncated"] is True and out["content"] == "x" * 10


def test_paths_stay_in_the_workspace(env, tmp_path):
    app, a, _b, settings = env
    p = project(app, a, settings)
    root = workdir(settings, p["id"])
    outside = tmp_path / "secret"
    outside.mkdir()
    (outside / "key.txt").write_text("secret")
    os.symlink(outside, root / "away")
    os.symlink(outside / "key.txt", root / "key.txt")
    (root / "ok.txt").write_text("fine")
    os.symlink(root / "ok.txt", root / "alias.txt")

    for path in ["../x", "/etc/passwd", "a/../../x", "away/key.txt", "key.txt"]:
        r = a.get(url(p, "file"), params={"path": path})
        assert r.status_code in (400, 403), (path, r.status_code)
        assert "secret" not in r.text
    assert a.get(url(p, "list"), params={"path": "away"}).status_code == 403
    assert a.get(url(p, "list"), params={"path": ".."}).status_code == 400
    r = a.get(url(p, "file"), params={"path": "key.txt", "download": "true"})
    assert r.status_code == 403
    # A link that stays inside is followed; one that leaves is listed, not opened.
    assert a.get(url(p, "file"), params={"path": "alias.txt"}).json()["content"] == "fine"
    entries = {e["name"]: e for e in a.get(url(p, "list")).json()["entries"]}
    assert entries["away"]["outside"] and entries["key.txt"]["outside"]
    assert entries["alias.txt"]["type"] == "file"
    # Uploads cannot be aimed outside either.
    up = a.post(url(p, "upload"), data={"path": "away"}, files={"file": ("x.txt", b"x")})
    assert up.status_code == 403 and not (outside / "x.txt").exists()
    up = a.post(url(p, "upload"), data={"path": "../.."}, files={"file": ("x.txt", b"x")})
    assert up.status_code == 400


def test_upload_conflicts(env):
    app, a, _b, settings = env
    p = project(app, a, settings)
    root = workdir(settings, p["id"])
    (root / "src").mkdir()

    def send(name, body, **form):
        return a.post(url(p, "upload"), data=form, files={"file": (name, body)})

    first = send("a.txt", b"one", path="src")
    assert first.status_code == 200 and first.json()["path"] == "src/a.txt"
    assert send("a.txt", b"two", path="src").status_code == 409
    assert (root / "src" / "a.txt").read_bytes() == b"one"
    renamed = send("a.txt", b"two", path="src", conflict="rename").json()
    assert renamed["path"] == "src/a (1).txt"
    assert (root / "src" / "a (1).txt").read_bytes() == b"two"
    replaced = send("a.txt", b"three", path="src", conflict="replace").json()
    assert replaced["replaced"] is True
    assert (root / "src" / "a.txt").read_bytes() == b"three"
    # A name cannot climb out, hide, or be a link that is overwritten.
    assert send("../evil.txt", b"x").json()["path"] == "evil.txt"
    assert send(".hidden", b"x").status_code == 422
    os.symlink(root / "src" / "a.txt", root / "link.txt")
    assert send("link.txt", b"x", conflict="replace").status_code == 409
    assert send("a.txt", b"x", conflict="bogus").status_code == 422
    # The data folder's uploads are recorded as data, as the data upload does.
    (root / "data").mkdir()
    send("rows.csv", b"a\n1\n", path="data")
    detail = a.get(f"{BASE}/{p['id']}").json()
    assert [x["name"] for x in detail["datasets"]] == ["rows.csv"]


def test_upload_respects_the_quota(env, monkeypatch):
    app, a, _b, settings = env
    p = project(app, a, settings)
    root = workdir(settings, p["id"])
    (root / "big.bin").write_bytes(b"x" * 100)
    monkeypatch.setattr(
        research_sandbox, "WORKSPACE_BYTES", research_sandbox._size(root) + 20
    )
    r = a.post(url(p, "upload"), files={"file": ("more.bin", b"y" * 30)})
    assert r.status_code == 413
    # Replacing a file counts what it frees.
    r = a.post(
        url(p, "upload"),
        data={"conflict": "replace"},
        files={"file": ("big.bin", b"z" * 110)},
    )
    assert r.status_code == 200, r.text


def test_cloud_edition_and_other_users_are_refused(env):
    app, a, b, settings = env
    p = project(app, a, settings)
    assert b.get(url(p, "list")).status_code == 404
    assert b.get(url(p, "file"), params={"path": "x"}).status_code == 404
    assert b.post(url(p, "upload"), files={"file": ("x.txt", b"x")}).status_code == 404
    settings.mode = "cloud"
    assert a.get(url(p, "list")).status_code == 403
    assert a.get(url(p, "file"), params={"path": "x"}).status_code == 403
    assert a.post(url(p, "upload"), files={"file": ("x.txt", b"x")}).status_code == 403


def test_marks_what_the_latest_round_changed(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    p = project(app, a, settings)
    root = workdir(settings, p["id"])
    (root / "src").mkdir()
    for name in ["src/train.py", "old.py", "edited.py", "notes.md", "results.json"]:
        (root / name).write_text("x")
    (root / "empty").mkdir()
    old = time.time() - 3600
    for name in ["src/train.py", "old.py", "edited.py", "notes.md", "empty"]:
        os.utime(root / name, (old, old))
    start = datetime.now(timezone.utc) - timedelta(minutes=5)

    def run(steps):
        r = AgentRun(
            owner=owner,
            session_id=p["session_id"],
            model_config_id=model,
            model="m",
            prompt="sprint",
            status="completed",
            lane="research",
            steps=steps,
        )
        d.add(r)
        d.flush()
        return r.id

    with app.state.maker() as d:
        earlier = run([{"name": "write", "arguments": {"path": "old.py"}}])
        d.add(ResearchSprint(project_id=p["id"], number=1, run_id=earlier))
        latest = run(
            [
                {"name": "write", "arguments": {"path": "/work/src/train.py"}},
                {"name": "edit", "arguments": {"path": "./edited.py"}},
                {"name": "read", "arguments": {"path": "notes.md"}},
                {"name": "write", "status": "failed", "arguments": {"path": "x"}},
            ]
        )
        sprint = ResearchSprint(project_id=p["id"], number=2, run_id=latest)
        d.add(sprint)
        d.flush()
        advisor = run([{"name": "write", "arguments": {"path": "notes.md"}}])
        d.add(
            ResearchSprint(project_id=p["id"], number=3, role="advisor", run_id=advisor)
        )
        d.add(
            ResearchJob(
                project_id=p["id"],
                node_id="n",
                sprint_id=sprint.id,
                command="python src/train.py",
                status="succeeded",
                started_at=start.isoformat(),
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
        )
        d.commit()

    listed = a.get(url(p, "list")).json()
    assert listed["round"] == 2
    assert listed["changed"] == ["edited.py", "src/train.py"]
    changed = {e["name"]: e["changed"] for e in mine(listed["entries"])}
    assert changed == {
        "src": True,
        "empty": False,
        "edited.py": True,
        "notes.md": False,
        "old.py": False,
        # Written while the round's job ran: what it produced.
        "results.json": True,
    }
    inner = a.get(url(p, "list"), params={"path": "src"}).json()["entries"]
    assert inner[0]["changed"] is True
