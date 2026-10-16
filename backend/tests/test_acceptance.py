import os
import io
import json
import zipfile
import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from backend.main import create_app, PASSWORD, digest
from backend.config import Settings
from backend.models import Base, User, Token, Session, Paper
from backend.cli import backup, restore

# Optional integration input: a directory with manifest.json and the original files
# of a real paper. Without it the tests that need it are skipped.
SAMPLE = Path(os.getenv("REALMEM_FIXTURE_DIR", "/nonexistent-fixture-dir"))
PASSWORD_TEXT = "Isolated-test-password-2026!"


@pytest.fixture
def env(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    with app.state.maker() as d:
        for n in ("alice", "bob"):
            d.add(
                User(
                    username=n,
                    email=n + "@test.example",
                    password=PASSWORD.hash(PASSWORD_TEXT),
                    admin=n == "alice",
                )
            )
        d.commit()
    clients = []
    for n in ("alice", "bob"):
        c = TestClient(app)
        r = c.post(
            "/api/v1/auth/login",
            json={"username": n, "password": PASSWORD_TEXT},
        )
        assert r.status_code == 200, r.text
        c.headers["X-CSRF-Token"] = r.json()["csrf"]
        clients.append(c)
    yield app, clients[0], clients[1], settings
    for c in clients:
        c.close()
    app.state.engine.dispose()


def write(c, path, data=None, method="POST", revision=None, key=None, **kwargs):
    headers = {"Idempotency-Key": key or str(uuid.uuid4())}
    if revision is not None:
        headers["If-Match"] = str(revision)
    return c.request(method, "/api/v1" + path, json=data, headers=headers, **kwargs)


def paper(c, title="Test paper", tags=None):
    r = write(c, "/papers", {"title": title, "tags": tags or []})
    assert r.status_code == 200, r.text
    return r.json()


def attach(
    c,
    p,
    name="source.tex",
    data=b"First line\nSecond line\nThird line\n",
    source_path="",
):
    r = c.post(
        "/api/v1/papers/" + p["id"] + "/files",
        data={"version_id": p["current_version"], "source_path": source_path},
        files={"file": (name, data)},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 200, r.text
    return r.json()


def item(c, p, kind="note", **extra):
    body = {
        "kind": kind,
        "paper_id": p["id"] if p else None,
        "body": "Original text",
        "title": "A useful " + kind,
        **extra,
    }
    r = write(c, "/items", body)
    assert r.status_code == 200, r.text
    return r.json()


def bearer(app, c, scopes=["read", "write"]):
    r = write(c, "/tokens", {"name": "test-agent", "scopes": scopes, "days": 1})
    assert r.status_code == 200, r.text
    agent = TestClient(app, headers={"Authorization": "Bearer " + r.json()["token"]})
    return agent, r.json()


def test_login_csrf_logout_registration(env):
    app, a, b, _ = env
    anonymous = TestClient(app)
    assert anonymous.get("/api/v1/papers").status_code == 401
    assert anonymous.get("/api/v1/export").status_code == 401
    assert (
        anonymous.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "Wrong-password-123"},
        ).status_code
        == 401
    )
    assert (
        a.post(
            "/api/v1/papers", json={"title": "x"}, headers={"X-CSRF-Token": ""}
        ).status_code
        == 403
    )
    assert (
        a.post(
            "/api/v1/papers",
            json={"title": "x"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    invitation = write(a, "/invitations", {"username": "charlie"}).json()
    data = {
        "username": "charlie",
        "password": PASSWORD_TEXT,
        "invitation": invitation["invitation"],
    }
    assert (
        anonymous.post(
            "/api/v1/auth/register", json={**data, "username": "other"}
        ).status_code
        == 403
    )
    assert anonymous.post("/api/v1/auth/register", json=data).status_code == 200
    assert anonymous.post("/api/v1/auth/register", json=data).status_code == 403
    assert write(b, "/invitations", {"username": "dave"}).status_code == 403
    assert write(a, "/auth/logout", {}).status_code == 200
    assert a.get("/api/v1/auth/me").status_code == 401


def test_tokens_hash_expiry_revocation_and_human_boundary(env):
    app, a, b, _ = env
    p = paper(a)
    agent, t = bearer(app, a)
    read, rt = bearer(app, a, ["read"])
    assert agent.get("/api/v1/papers").status_code == 200
    assert write(read, "/papers", {"title": "denied"}).status_code == 403
    for path, body in [
        ("/tokens", {"name": "bad", "scopes": ["read"]}),
        ("/invitations", {"username": "other"}),
        ("/items", {"kind": "note", "paper_id": p["id"]}),
        (
            "/papers/" + p["id"] + "/events",
            {"kind": "reading", "body": "read", "reading_status": "read"},
        ),
        (
            "/papers/" + p["id"] + "/events",
            {"kind": "suggestion", "body": "read", "reading_status": "read"},
        ),
    ]:
        assert write(agent, path, body).status_code == 403, path
    assert (
        write(
            agent, "/papers/" + p["id"], {"favorite": True}, "PATCH", p["revision"]
        ).status_code
        == 403
    )
    assert (
        write(
            agent,
            "/papers/" + p["id"],
            {"reading_status": "read"},
            "PATCH",
            p["revision"],
        ).status_code
        == 422
    )
    n = item(a, p)
    assert (
        write(
            agent,
            "/items/" + n["id"],
            {"kind": "analysis", "paper_id": p["id"]},
            "PUT",
            1,
        ).status_code
        == 403
    )
    assert (
        agent.delete("/api/v1/items/" + n["id"], headers={"If-Match": "1"}).status_code
        == 403
    )
    assert agent.get("/api/v1/tokens").status_code == 403
    assert b.delete("/api/v1/tokens/" + t["id"]).status_code == 404
    with app.state.maker() as d:
        stored = d.get(Token, t["id"])
        assert stored.digest == digest(t["token"])
        assert t["token"] not in stored.digest
        stored.expires = "2000-01-01"
        d.commit()
        assert all(
            s.id != a.cookies["paper_session"] for s in d.scalars(select(Session))
        )
    assert agent.get("/api/v1/papers").status_code == 401
    assert a.delete("/api/v1/tokens/" + rt["id"]).status_code == 200
    assert read.get("/api/v1/papers").status_code == 401
    assert "token" not in a.get("/api/v1/tokens").json()[0]


@pytest.mark.parametrize("actor", ["human", "agent"])
@pytest.mark.parametrize(
    "resource",
    [
        "paper",
        "files",
        "versions",
        "events",
        "context",
        "history",
        "item",
        "item_history",
        "file",
        "content",
        "download",
        "items_filter",
    ],
)
def test_foreign_ids_read_rejected(env, actor, resource):
    app, a, b, _ = env
    p = paper(a)
    f = attach(a, p)
    i = item(a, p)
    c = bearer(app, b)[0] if actor == "agent" else b
    paths = {
        "paper": f"/papers/{p['id']}",
        "files": f"/papers/{p['id']}/files",
        "versions": f"/papers/{p['id']}/versions",
        "events": f"/papers/{p['id']}/events",
        "context": f"/papers/{p['id']}/context",
        "history": f"/history/{p['id']}",
        "item": f"/items/{i['id']}",
        "item_history": f"/history/{i['id']}",
        "file": f"/files/{f['id']}",
        "content": f"/files/{f['id']}/content",
        "download": f"/files/{f['id']}/content?download=true",
        "items_filter": f"/items?paper_id={p['id']}",
    }
    assert c.get("/api/v1" + paths[resource]).status_code == 404
    for path in ["/papers", "/items", "/recommendations", "/dashboard"]:
        assert p["id"] not in c.get("/api/v1" + path).text
    z = zipfile.ZipFile(io.BytesIO(c.get("/api/v1/export").content))
    assert p["id"] not in z.read("workspace.json").decode()
    assert "files/" + f["id"] not in z.namelist()


@pytest.mark.parametrize("actor", ["human", "agent"])
@pytest.mark.parametrize(
    "operation",
    [
        "paper_update",
        "file_upload",
        "version",
        "event",
        "item_update",
        "item_create",
        "topic_reference",
        "evidence_reference",
        "locator",
        "delete_item",
    ],
)
def test_foreign_ids_write_rejected(env, actor, operation):
    app, a, b, _ = env
    p = paper(a)
    f = attach(a, p)
    loc = {"file_id": f["id"], "version_id": f["version_id"], "line_start": 1}
    i = item(a, p, "evidence", locator=loc)
    own = paper(b)
    c = bearer(app, b)[0] if actor == "agent" else b
    if operation == "paper_update":
        r = write(c, "/papers/" + p["id"], {"title": "stolen"}, "PATCH", 1)
    elif operation == "file_upload":
        r = c.post(
            "/api/v1/papers/" + p["id"] + "/files",
            files={"file": ("x.txt", b"x")},
            data={"version_id": p["current_version"]},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
    elif operation == "version":
        r = write(c, "/papers/" + p["id"] + "/versions", {"label": "v2"}, revision=1)
    elif operation == "event":
        r = write(
            c,
            "/papers/" + p["id"] + "/events",
            {"kind": "suggestion", "body": "foreign"},
        )
    elif operation == "item_update":
        r = write(
            c,
            "/items/" + i["id"],
            {"kind": "evidence", "paper_id": p["id"], "locator": loc},
            "PUT",
            1,
        )
    elif operation == "item_create":
        r = write(c, "/items", {"kind": "question", "paper_id": p["id"]})
    elif operation == "topic_reference":
        r = write(c, "/items", {"kind": "topic", "paper_ids": [p["id"]]})
    elif operation == "evidence_reference":
        r = write(
            c,
            "/items",
            {"kind": "analysis", "paper_id": own["id"], "evidence_ids": [i["id"]]},
        )
    elif operation == "locator":
        r = write(
            c, "/items", {"kind": "evidence", "paper_id": own["id"], "locator": loc}
        )
    else:
        r = c.delete("/api/v1/items/" + i["id"], headers={"If-Match": "1"})
    assert r.status_code == 404, r.text
    assert a.get("/api/v1/papers/" + p["id"]).json()["title"] == "Test paper"


def test_notes_evidence_topics_history_and_conflicts(env):
    app, a, _, _ = env
    p = paper(a)
    p2 = paper(a, "Related paper")
    f = attach(a, p)
    ev = item(
        a,
        p,
        "evidence",
        locator={
            "file_id": f["id"],
            "version_id": f["version_id"],
            "line_start": 1,
            "line_end": 2,
            "quote": "First line",
        },
    )
    n = item(a, p, "note", evidence_ids=[ev["id"]])
    topic = item(
        a,
        None,
        "topic",
        paper_ids=[p["id"], p2["id"]],
        evidence_ids=[ev["id"]],
        tags=["memory"],
    )
    comparison = item(
        a, None, "link", paper_ids=[p["id"], p2["id"]], evidence_ids=[ev["id"]]
    )
    body = {
        k: n[k]
        for k in (
            "kind",
            "paper_id",
            "title",
            "body",
            "status",
            "tags",
            "paper_ids",
            "evidence_ids",
        )
    }
    body["body"] = "Revised judgment"
    assert write(a, "/items/" + n["id"], body, "PUT").status_code == 428
    updated = write(a, "/items/" + n["id"], body, "PUT", 1).json()
    assert updated["revision"] == 2
    assert write(a, "/items/" + n["id"], body, "PUT", 1).status_code == 409
    hist = a.get("/api/v1/history/" + n["id"]).json()
    assert len(hist) == 2
    assert hist[-1]["snapshot"]["body"] == "Original text"
    assert (
        a.delete("/api/v1/items/" + ev["id"], headers={"If-Match": "1"}).status_code
        == 409
    )
    assert (
        a.delete(
            "/api/v1/items/" + comparison["id"], headers={"If-Match": "1"}
        ).status_code
        == 200
    )
    assert (
        write(a, "/papers/" + p["id"], {"archived": True}, "PATCH", 1).status_code
        == 200
    )
    assert p["id"] not in a.get("/api/v1/papers").text
    assert p["id"] in a.get("/api/v1/papers?archived=true").text
    assert (
        write(a, "/papers/" + p["id"], {"archived": False}, "PATCH", 2).status_code
        == 200
    )
    assert (
        a.delete("/api/v1/papers/" + p["id"], headers={"If-Match": "3"}).status_code
        == 400
    )
    assert (
        a.delete(
            "/api/v1/papers/" + p["id"],
            headers={"If-Match": "3", "X-Confirm-Delete": p["id"]},
        ).status_code
        == 200
    )
    retained = a.get("/api/v1/items/" + topic["id"]).json()
    assert retained["paper_ids"] == [p2["id"]] and retained["evidence_ids"] == []
    assert a.get("/api/v1/files/" + f["id"] + "/content").status_code == 404


def test_progress_agent_status_and_append_only_events(env):
    app, a, _, _ = env
    p = paper(a)
    agent, _ = bearer(app, a)
    assert (
        write(
            agent, "/papers/" + p["id"], {"agent_status": "ready"}, "PATCH", 1
        ).status_code
        == 200
    )
    assert a.get("/api/v1/papers/" + p["id"]).json()["reading_status"] == "unread"
    suggestion = write(
        agent,
        "/papers/" + p["id"] + "/events",
        {"kind": "suggestion", "body": "Consider reading methods"},
    ).json()
    assert not suggestion["confirmed"]
    ev = write(
        a,
        "/papers/" + p["id"] + "/events",
        {
            "kind": "reading",
            "body": "Read introduction only",
            "reading_status": "reading",
        },
        revision=2,
    ).json()
    assert ev["confirmed"]
    assert (
        write(
            a,
            "/papers/" + p["id"] + "/events",
            {
                "kind": "correction",
                "body": "Actually reviewed first paragraph",
                "reading_status": "reading",
            },
            revision=3,
        ).status_code
        == 200
    )
    events = a.get("/api/v1/papers/" + p["id"] + "/events").json()
    assert len(events) == 3
    assert a.delete(
        "/api/v1/papers/" + p["id"] + "/events/" + ev["id"]
    ).status_code in {404, 405}
    assert a.get("/api/v1/dashboard").json()["read"] == 0
    assert a.get("/api/v1/dashboard").json()["resume"][0]["id"] == p["id"]


def test_idempotency_import_update_upload_events(env):
    _, a, _, _ = env
    key = str(uuid.uuid4())
    body = {"title": "Retry-safe import"}
    p = write(a, "/papers", body, key=key).json()
    assert write(a, "/papers", body, key=key).json() == p
    assert write(a, "/papers", {"title": "Different"}, key=key).status_code == 409
    assert a.post("/api/v1/papers", json=body).status_code == 400
    assert len(a.get("/api/v1/papers").json()) == 1
    key = str(uuid.uuid4())
    patch = {"title": "Updated title"}
    first = write(a, "/papers/" + p["id"], patch, "PATCH", 1, key).json()
    assert write(a, "/papers/" + p["id"], patch, "PATCH", 1, key).json() == first
    key = str(uuid.uuid4())
    args = {
        "files": {"file": ("file.txt", b"retry file")},
        "data": {"version_id": p["current_version"]},
        "headers": {"Idempotency-Key": key},
    }
    f = a.post("/api/v1/papers/" + p["id"] + "/files", **args).json()
    assert a.post("/api/v1/papers/" + p["id"] + "/files", **args).json() == f
    key = str(uuid.uuid4())
    event = {"kind": "reading", "body": "queued", "reading_status": "unread"}
    first = write(
        a, "/papers/" + p["id"] + "/events", event, revision=2, key=key
    ).json()
    assert (
        write(a, "/papers/" + p["id"] + "/events", event, revision=2, key=key).json()
        == first
    )
    assert len(a.get("/api/v1/papers/" + p["id"] + "/events").json()) == 1


def test_recommendation_feedback(env):
    _, a, b, _ = env
    p = paper(a, "Anchor", ["memory"])
    p2 = paper(a, "Candidate", ["memory"])
    p3 = paper(a, "Another", ["memory"])
    write(a, "/papers/" + p["id"], {"favorite": True}, "PATCH", 1)
    assert len(a.get("/api/v1/recommendations").json()["items"]) == 3
    assert not b.get("/api/v1/recommendations").json()["items"]
    assert (
        write(
            a,
            "/recommendations/" + p2["id"] + "/feedback",
            {"action": "queue"},
            revision=1,
        ).status_code
        == 200
    )
    assert a.get("/api/v1/papers/" + p2["id"]).json()["reading_status"] == "unread"
    write(a, "/recommendations/" + p3["id"] + "/feedback", {"action": "dismiss"})
    assert p3["id"] not in [
        r["paper"]["id"] for r in a.get("/api/v1/recommendations").json()["items"]
    ]
    write(a, "/recommendations/" + p3["id"] + "/feedback", {"action": "reset"})
    write(a, "/recommendations/" + p3["id"] + "/feedback", {"action": "not_interested"})
    assert not a.get("/api/v1/recommendations").json()["items"]


@pytest.mark.parametrize(
    "name,path",
    [
        ("../bad.txt", ""),
        ("x.txt", "../../bad.txt"),
        ("x.txt", "/etc/passwd"),
        ("x.txt", "a\\bad.txt"),
        ("x.txt", "a/./bad.txt"),
        ("x.txt", "C:drive.txt"),
    ],
)
def test_upload_traversal(env, name, path):
    _, a, _, _ = env
    p = paper(a)
    r = a.post(
        "/api/v1/papers/" + p["id"] + "/files",
        files={"file": (name, b"x")},
        data={"version_id": p["current_version"], "source_path": path},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 422, r.text


def test_upload_types_limits_symlink_and_locators(env):
    app, a, b, settings = env
    p = paper(a)
    p2 = paper(a)
    f = attach(a, p)
    bad = attach(a, p, "attack.html", b"<script>alert(1)</script>")
    assert a.get("/api/v1/files/" + bad["id"] + "/content").status_code == 415
    raw = a.get("/api/v1/files/" + bad["id"] + "/content?download=true")
    assert raw.headers["content-type"] == "application/octet-stream"
    assert "attachment" in raw.headers["content-disposition"]
    assert raw.headers["x-content-type-options"] == "nosniff"
    for loc in [
        {"file_id": f["id"], "version_id": p2["current_version"], "line_start": 1},
        {"file_id": f["id"], "version_id": f["version_id"], "line_start": 9},
        {"file_id": f["id"], "version_id": f["version_id"], "page": 1},
    ]:
        assert (
            write(
                a, "/items", {"kind": "evidence", "paper_id": p["id"], "locator": loc}
            ).status_code
            == 422
        )
    stored = Path(settings.storage) / f["id"]
    stored.unlink()
    stored.symlink_to(Path(settings.storage) / bad["id"])
    assert a.get("/api/v1/files/" + f["id"] + "/content").status_code == 404
    settings.upload_limit = 4
    r = a.post(
        "/api/v1/papers/" + p["id"] + "/files",
        files={"file": ("x.txt", b"12345")},
        data={"version_id": p["current_version"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 413
    assert (
        a.post(
            "/api/v1/papers",
            content=b"x" * (2 * 1024 * 1024 + 1),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )
    assert (
        write(
            a,
            "/papers",
            {"title": "x", "source_url": "http://169.254.169.254/latest/meta-data/"},
        ).status_code
        == 422
    )


@pytest.mark.skipif(
    not (SAMPLE / "manifest.json").exists(),
    reason="RealMem originals unavailable; set REALMEM_FIXTURE_DIR",
)
def test_realmem_files_export_restart_backup_restore(env, tmp_path):
    app, a, b, settings = env
    manifest = json.loads((SAMPLE / "manifest.json").read_text())
    p = write(
        a,
        "/papers",
        {
            "title": manifest["pdf"]["metadata"]["title"],
            "authors": manifest["pdf"]["metadata"]["author"],
            "external_id": manifest["paper_id"],
            "version_label": manifest["version"],
            "provenance": manifest["source_url"],
            "tags": ["memory"],
        },
    ).json()
    files = []
    for path in [
        SAMPLE / "source/paper-v1.pdf",
        SAMPLE / "source/latex-v1/sec/method.tex",
        SAMPLE / "visual/framework.png",
        SAMPLE / "SOP-v0.1.md",
        SAMPLE / "source/source-v1.tar",
    ]:
        data = path.read_bytes()
        f = attach(
            a,
            p,
            path.name,
            data,
            "sec/method.tex" if path.suffix == ".tex" else path.name,
        )
        files.append(f)
        raw = a.get("/api/v1/files/" + f["id"] + "/content?download=true")
        assert raw.content == data
    assert files[0]["pages"] == 18
    assert files[0]["sha256"] == manifest["pdf"]["sha256"]
    assert a.get("/api/v1/files/" + files[0]["id"] + "/content").content.startswith(
        b"%PDF-"
    )
    assert b.get("/api/v1/files/" + files[0]["id"] + "/content").status_code == 404
    e = item(
        a,
        p,
        "evidence",
        body="Source location saved for later reading; no understanding claimed.",
        locator={
            "file_id": files[1]["id"],
            "version_id": p["current_version"],
            "line_start": 1,
            "line_end": 3,
        },
    )
    item(a, p, "note", evidence_ids=[e["id"]])
    item(a, None, "topic", paper_ids=[p["id"]], evidence_ids=[e["id"]])
    zipdata = a.get("/api/v1/export").content
    with zipfile.ZipFile(io.BytesIO(zipdata)) as z:
        payload = json.loads(z.read("workspace.json"))
        assert len(payload["data"]["files"]) == 5
        assert (
            z.read("files/" + files[0]["id"])
            == (SAMPLE / "source/paper-v1.pdf").read_bytes()
        )
        assert all(k not in payload["data"] for k in ["users", "tokens", "sessions"])
        assert len([n for n in z.namelist() if n.startswith("notes/")]) == 3
    restarted = TestClient(create_app(settings))
    login = restarted.post(
        "/api/v1/auth/login",
        json={"username": "alice", "password": PASSWORD_TEXT},
    )
    assert login.status_code == 200
    assert (
        restarted.get("/api/v1/papers/" + p["id"]).json()["reading_status"] == "unread"
    )
    target = tmp_path / "backup.zip"
    counts = backup(settings, target)
    assert counts["files"] == 5
    restored_settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    new_app = create_app(restored_settings)
    Base.metadata.create_all(new_app.state.engine)
    assert restore(restored_settings, target) == counts
    with pytest.raises(ValueError, match="empty"):
        restore(restored_settings, target)
    new = TestClient(new_app)
    assert (
        new.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": PASSWORD_TEXT},
        ).status_code
        == 200
    )
    assert new.get("/api/v1/papers/" + p["id"]).status_code == 200
    assert (
        new.get("/api/v1/files/" + files[0]["id"] + "/content").content
        == (SAMPLE / "source/paper-v1.pdf").read_bytes()
    )
    assert len(new.get("/api/v1/items").json()) == 3


@pytest.mark.parametrize(
    "entry", ["../escape", "files/../../escape", "files/fake", "/absolute"]
)
def test_restore_rejects_archive_traversal(env, tmp_path, entry):
    _, _, _, settings = env
    path = tmp_path / "hostile.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(entry, "bad")
    with pytest.raises(ValueError, match="Unsafe"):
        restore(settings, path)


def test_version_provenance_and_agent_context(env):
    app, a, _, _ = env
    p = paper(a)
    f = attach(a, p)
    v = write(
        a,
        "/papers/" + p["id"] + "/versions",
        {"label": "v2", "provenance": "Corrected source received from author"},
        revision=1,
    ).json()
    assert v["id"] != f["version_id"]
    e = item(
        a,
        p,
        "evidence",
        locator={"file_id": f["id"], "version_id": f["version_id"], "line_start": 1},
    )
    agent, _ = bearer(app, a)
    item(
        agent,
        p,
        "analysis",
        evidence_ids=[e["id"]],
        body="External Agent analysis, not user reading confirmation",
    )
    item(agent, p, "question", title="Unresolved method question")
    context = agent.get("/api/v1/papers/" + p["id"] + "/context").json()
    assert len(context["versions"]) == 2 and len(context["items"]) == 4
    assert sum(i["kind"] == "note" for i in context["items"]) == 1
    assert context["paper"]["reading_status"] == "unread"
    assert context["files"][0]["version_id"] == f["version_id"]
    assert (
        a.get("/api/v1/dashboard").json()["questions"][0]["title"]
        == "Unresolved method question"
    )


def test_secure_production_settings_and_openapi(env):
    app, a, _, settings = env
    settings.secure_cookie = True
    r = TestClient(app).post(
        "/api/v1/auth/login",
        json={"username": "alice", "password": PASSWORD_TEXT},
    )
    assert (
        "Secure" in r.headers["set-cookie"]
        and "HttpOnly" in r.headers["set-cookie"]
        and "SameSite=strict" in r.headers["set-cookie"]
    )
    assert r.headers["strict-transport-security"] == "max-age=31536000"
    spec = a.get("/api/v1/openapi.json").json()
    assert "/api/v1/papers/{id}/context" in spec["paths"]
    assert "/api/v1/export" in spec["paths"]


def test_database_compare_and_swap_rejects_simultaneous_edit(env):
    from sqlalchemy.orm.exc import StaleDataError

    app, a, _, _ = env
    p = paper(a)
    with app.state.maker() as one, app.state.maker() as two:
        first = one.get(Paper, p["id"])
        second = two.get(Paper, p["id"])
        first.title = "First edit"
        first.revision += 1
        one.commit()
        second.title = "Concurrent stale edit"
        second.revision += 1
        with pytest.raises(StaleDataError):
            two.commit()
    assert a.get("/api/v1/papers/" + p["id"]).json()["title"] == "First edit"


def test_foreign_delete_feedback_and_version_attachment(env):
    app, a, b, _ = env
    p = paper(a)
    own = paper(b)
    assert (
        b.delete(
            "/api/v1/papers/" + p["id"],
            headers={"If-Match": "1", "X-Confirm-Delete": p["id"]},
        ).status_code
        == 404
    )
    assert (
        write(
            b,
            "/recommendations/" + p["id"] + "/feedback",
            {"action": "queue"},
            revision=1,
        ).status_code
        == 404
    )
    r = b.post(
        "/api/v1/papers/" + own["id"] + "/files",
        files={"file": ("x.txt", b"x")},
        data={"version_id": p["current_version"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 404
    agent, _ = bearer(app, a)
    assert (
        agent.delete(
            "/api/v1/papers/" + p["id"],
            headers={"If-Match": "1", "X-Confirm-Delete": p["id"]},
        ).status_code
        == 403
    )
    assert (
        write(
            agent,
            "/recommendations/" + p["id"] + "/feedback",
            {"action": "queue"},
            revision=1,
        ).status_code
        == 403
    )
    assert (
        write(
            a,
            "/papers",
            {
                "title": "x",
                "workspace_id": b.get("/api/v1/auth/me").json()["user"]["id"],
            },
        ).status_code
        == 422
    )


def test_expired_session_invitation_and_write_only_token(env):
    from backend.models import Invitation

    app, a, b, _ = env
    invitation = write(a, "/invitations", {"username": "expired"}).json()["invitation"]
    agent, _ = bearer(app, a, ["write"])
    assert agent.get("/api/v1/export").status_code == 403
    assert write(agent, "/papers", {"title": "Write-only import"}).status_code == 200
    with app.state.maker() as d:
        d.get(Invitation, digest(invitation)).expires = "2000-01-01"
        d.get(Session, digest(b.cookies["paper_session"])).expires = "2000-01-01"
        d.commit()
    assert (
        TestClient(app)
        .post(
            "/api/v1/auth/register",
            json={
                "username": "expired",
                "password": PASSWORD_TEXT,
                "invitation": invitation,
            },
        )
        .status_code
        == 403
    )
    assert b.get("/api/v1/export").status_code == 401


@pytest.mark.parametrize("mode", ["symlink", "duplicate", "oversized", "bad_checksum"])
def test_restore_rejects_unsafe_or_corrupt_backup(env, tmp_path, mode):
    app, a, _, settings = env
    p = paper(a)
    attach(a, p)
    archive = tmp_path / "original.zip"
    backup(settings, archive)
    path = tmp_path / "bad.zip"
    with (
        zipfile.ZipFile(archive) as src,
        zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as dst,
    ):
        for name in src.namelist():
            data = src.read(name)
            if name.startswith("files/"):
                if mode == "symlink":
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = 0o120777 << 16
                    dst.writestr(info, "/etc/passwd")
                    continue
                if mode == "oversized":
                    data = b"x" * (settings.upload_limit + 1)
                if mode == "bad_checksum":
                    data = b"corrupted"
            dst.writestr(name, data)
        if mode == "duplicate":
            with pytest.warns(UserWarning):
                dst.writestr("backup.json", src.read("backup.json"))
    destination = Settings(
        database_url="sqlite:///" + str(tmp_path / "restore.db"),
        storage=str(tmp_path / "restore-files"),
    )
    other = create_app(destination)
    Base.metadata.create_all(other.state.engine)
    with pytest.raises(ValueError):
        restore(destination, path)
    with other.state.maker() as d:
        assert not d.scalar(select(User.id))
    assert not list(Path(destination.storage).iterdir())


def test_item_idempotency_and_invalid_media(env):
    _, a, _, _ = env
    p = paper(a)
    key = str(uuid.uuid4())
    body = {"kind": "question", "paper_id": p["id"], "title": "Retryable question"}
    first = write(a, "/items", body, key=key).json()
    assert write(a, "/items", body, key=key).json() == first
    edit = {**body, "body": "Resolved after verification", "status": "resolved"}
    key = str(uuid.uuid4())
    first = write(a, "/items/" + first["id"], edit, "PUT", 1, key).json()
    assert write(a, "/items/" + first["id"], edit, "PUT", 1, key).json() == first
    for name, data in [
        ("bad.pdf", b"%PDF-1.7\ninvalid"),
        ("bad.png", b"<script>not an image</script>"),
    ]:
        r = a.post(
            "/api/v1/papers/" + p["id"] + "/files",
            data={"version_id": p["current_version"]},
            files={"file": (name, data)},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert r.status_code == 422
    spec = a.get("/api/v1/openapi.json").json()
    assert spec["components"]["securitySchemes"]["AgentToken"]["scheme"] == "bearer"
    assert any(
        p["name"] == "If-Match"
        for p in spec["paths"]["/api/v1/papers/{id}"]["patch"]["parameters"]
    )


def test_portable_pdf_and_image_inspection(env):
    """Run the real inspector subprocess, including macOS's resource limits."""
    from pypdf import PdfWriter
    from PIL import Image

    _, a, b, _ = env
    p = paper(a, "Synthetic media acceptance")
    pdf = PdfWriter()
    pdf.add_blank_page(width=612, height=792)
    pdf_bytes = io.BytesIO()
    pdf.write(pdf_bytes)
    pdf_file = attach(a, p, "synthetic.pdf", pdf_bytes.getvalue())
    assert pdf_file["mime"] == "application/pdf"
    assert pdf_file["pages"] == 1
    image_bytes = io.BytesIO()
    Image.new("RGB", (24, 24), "blue").save(image_bytes, format="PNG")
    image_file = attach(a, p, "synthetic.png", image_bytes.getvalue())
    assert image_file["mime"] == "image/png"
    for file, raw in [
        (pdf_file, pdf_bytes.getvalue()),
        (image_file, image_bytes.getvalue()),
    ]:
        assert a.get("/api/v1/files/" + file["id"] + "/content").content == raw
        assert b.get("/api/v1/files/" + file["id"] + "/content").status_code == 404


def test_username_identity_is_separate_from_email(env):
    app, a, _, _ = env
    c = TestClient(app)
    assert (
        c.post(
            "/api/v1/auth/login", json={"username": "ALICE", "password": PASSWORD_TEXT}
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/api/v1/auth/login",
            json={"email": "alice@test.example", "password": PASSWORD_TEXT},
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/v1/auth/login",
            json={"username": "alice@test.example", "password": PASSWORD_TEXT},
        ).status_code
        == 422
    )
    me = a.get("/api/v1/auth/me").json()["user"]
    assert me["username"] == "alice" and me["email_verified"] is False
    assert "password" not in me


def test_verified_email_reset_is_single_use_and_revokes_access(env):
    import re
    from backend.models import AccountChallenge

    app, a, b, _ = env
    messages = []
    app.state.mail_sender = lambda address, subject, body: messages.append(
        (address, body)
    )
    agent, _ = bearer(app, a)

    def request_binding(password=PASSWORD_TEXT):
        return a.post(
            "/api/v1/auth/email/request",
            json={"email": "recovery@test.example", "password": password},
        )

    assert request_binding("wrong").status_code == 401
    assert request_binding().status_code == 200
    binding = re.search(r"token=([\w-]+)", messages[-1][1])[1]
    with app.state.maker() as d:
        assert d.get(AccountChallenge, binding) is None
        assert d.get(AccountChallenge, digest(binding)) is not None
    # Neither another user nor an agent may bind the address.
    assert (
        b.post("/api/v1/auth/email/confirm", json={"token": binding}).status_code == 400
    )
    assert (
        agent.post("/api/v1/auth/email/confirm", json={"token": binding}).status_code
        == 403
    )
    assert (
        a.post("/api/v1/auth/email/confirm", json={"token": binding}).status_code == 200
    )
    assert (
        a.post("/api/v1/auth/email/confirm", json={"token": binding}).status_code == 400
    )
    assert a.get("/api/v1/auth/me").json()["user"]["email_verified"] is True
    c = TestClient(app)
    known = c.post(
        "/api/v1/auth/password-reset/request", json={"email": "recovery@test.example"}
    )
    unknown = c.post(
        "/api/v1/auth/password-reset/request", json={"email": "unknown@test.example"}
    )
    assert (
        known.status_code == unknown.status_code == 200
        and known.json() == unknown.json()
    )
    assert "alice" in messages[-1][1]
    reset = re.search(r"token=([\w-]+)", messages[-1][1])[1]
    changed = "Eight123"
    assert (
        a.post(
            "/api/v1/auth/password-reset/complete",
            json={"token": reset, "password": "Seven12"},
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/v1/auth/password-reset/complete",
            json={"token": reset, "password": changed},
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/api/v1/auth/password-reset/complete",
            json={"token": reset, "password": changed},
        ).status_code
        == 400
    )
    assert a.get("/api/v1/auth/me").status_code == 401
    assert agent.get("/api/v1/papers").status_code == 401
    assert (
        c.post(
            "/api/v1/auth/login", json={"username": "alice", "password": PASSWORD_TEXT}
        ).status_code
        == 401
    )
    assert (
        c.post(
            "/api/v1/auth/login", json={"username": "alice", "password": changed}
        ).status_code
        == 200
    )


def test_recovery_unverified_expiry_and_missing_mail(env, monkeypatch):
    from backend.models import AccountChallenge

    app, a, _, _ = env
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert a.get("/api/v1/auth/options").json()["email_recovery_enabled"] is False
    assert (
        a.post(
            "/api/v1/auth/password-reset/request", json={"email": "alice@test.example"}
        ).status_code
        == 503
    )
    messages = []
    app.state.mail_sender = lambda *args: messages.append(args)
    assert (
        a.post(
            "/api/v1/auth/password-reset/request", json={"email": "alice@test.example"}
        ).status_code
        == 200
    )
    assert not messages  # A migrated, unverified email cannot recover the account.
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    token = "expired-token-" + "x" * 32
    with app.state.maker() as d:
        d.add(
            AccountChallenge(
                id=digest(token),
                owner=owner,
                email="alice@test.example",
                purpose="reset",
                expires="2000-01-01",
            )
        )
        d.commit()
    assert (
        a.post(
            "/api/v1/auth/password-reset/complete",
            json={"token": token, "password": PASSWORD_TEXT},
        ).status_code
        == 400
    )


def test_legacy_backup_gets_username_and_unverified_email(env, tmp_path):
    app, _, _, settings = env
    archive = tmp_path / "new.zip"
    backup(settings, archive)
    with zipfile.ZipFile(archive) as z:
        payload = json.loads(z.read("backup.json"))
    payload["schema_version"] = 1
    for user in payload["data"]["users"]:
        user.pop("username")
        user.pop("email_verified")
    legacy = tmp_path / "legacy.zip"
    with zipfile.ZipFile(legacy, "w") as z:
        z.writestr("backup.json", json.dumps(payload))
    target = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    restored = create_app(target)
    Base.metadata.create_all(restored.state.engine)
    restore(target, legacy)
    client = TestClient(restored)
    result = client.post(
        "/api/v1/auth/login", json={"username": "alice", "password": PASSWORD_TEXT}
    )
    assert result.status_code == 200
    assert result.json()["user"]["email_verified"] is False
    assert result.json()["user"]["id"] == next(
        u["id"] for u in payload["data"]["users"] if u["email"] == "alice@test.example"
    )
    client.close()
    restored.state.engine.dispose()
