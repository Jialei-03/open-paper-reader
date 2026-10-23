import asyncio
import io
import json
import uuid
import zipfile
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select, text

from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import Base, File, Item
from backend.paper_shares import PaperShare
from backend.storage_files import references
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def setup_share(env):
    app, a, b, settings = env
    p = paper(a, "Public paper")
    f = attach(a, p, "original.pdf", pdf_bytes())
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])
    raw = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(raw, "PNG")
    image = a.post(
        f"/api/v1/items/{note['id']}/images",
        files={"file": ("chart.png", raw.getvalue(), "image/png")},
    ).json()
    with app.state.maker() as d:
        item = d.get(Item, note["id"])
        item.title = "Snapshot note"
        item.body = (
            "Original note\n\n![Chart]("
            + image["url"]
            + ")\n![remote](https://remote.invalid/image.png)"
        )
        d.commit()
    endpoint = f"/api/v1/papers/{p['id']}/shares"
    body = {"file_id": f["id"], "note_id": note["id"], "expires_days": 7}
    return app, a, b, settings, p, f, note, image, endpoint, body


def test_private_by_default_public_snapshot_resources_and_revocation(env):
    app, a, b, _, p, f, note, image, endpoint, body = setup_share(env)
    anonymous = TestClient(app)
    assert a.get(endpoint).json() == []
    assert anonymous.get(f"/api/v1/files/{f['id']}/content").status_code == 401
    shared = a.post(endpoint, json=body)
    assert shared.status_code == 200, shared.text
    link = shared.json()
    assert len(link["token"]) == 43
    assert link["token"] not in a.get(endpoint).text
    assert b.get(endpoint).status_code == 404
    assert b.delete(endpoint + "/" + link["id"]).status_code == 404
    path = "/api/v1/shared/" + link["token"]
    data = anonymous.get(path)
    assert data.status_code == 200
    result = data.json()
    assert set(result) == {
        "title",
        "authors",
        "file_name",
        "pdf_url",
        "expires_at",
        "note",
    }
    assert result["title"] == p["title"]
    assert result["file_name"] == f["name"]
    assert image["id"] in result["note"]["body"]
    assert path + "/images/" + image["id"] in result["note"]["body"]
    assert "remote.invalid" not in result["note"]["body"]
    assert (
        "owner" not in result and "file_id" not in result and "token_hash" not in result
    )
    assert data.headers["cache-control"] == "private, no-store"
    assert data.headers["referrer-policy"] == "no-referrer"
    assert anonymous.get(result["pdf_url"]).content.startswith(b"%PDF-")
    image_path = path + "/images/" + image["id"]
    assert anonymous.get(image_path).content.startswith(b"\x89PNG")
    assert anonymous.get(path + "/images/" + str(uuid.uuid4())).status_code == 404
    with app.state.maker() as d:
        item = d.get(Item, note["id"])
        item.body = "NEW PRIVATE SECRET"
        d.commit()
        row = d.get(PaperShare, link["id"])
        assert link["token"] not in json.dumps(
            {k: v for k, v in row.__dict__.items() if k != "_sa_instance_state"}
        )
        assert image["id"] in references(d, row.owner)
    assert anonymous.get(path).json() == result
    assert (
        a.delete(
            "/api/v1/storage-files/note_images/" + image["id"],
            headers={"X-Confirm-Delete": image["id"]},
        ).status_code
        == 409
    )
    assert a.delete(endpoint + "/" + link["id"]).status_code == 200
    assert a.delete(endpoint + "/" + link["id"]).status_code == 200
    for target in (path, path + "/pdf", image_path, "/api/v1/shared/" + "a" * 43):
        failed = anonymous.get(target)
        assert failed.status_code == 404
        assert failed.json()["detail"] == "分享不存在或已失效"
        assert failed.headers["referrer-policy"] == "no-referrer"
    assert (
        a.delete(
            "/api/v1/storage-files/note_images/" + image["id"],
            headers={"X-Confirm-Delete": image["id"]},
        ).status_code
        == 200
    )
    anonymous.close()


def test_share_owner_file_note_limits_and_expiry(env):
    app, a, b, settings, p, f, _note, _, endpoint, body = setup_share(env)
    other = paper(b)
    other_file = attach(b, other, "other.pdf", pdf_bytes())
    other_note = next(
        n for n in b.get("/api/v1/items").json() if n["paper_id"] == other["id"]
    )
    for invalid, status in [
        ({**body, "file_id": other_file["id"]}, 404),
        ({**body, "note_id": other_note["id"]}, 404),
        ({**body, "expires_days": 2}, 422),
        ({**body, "file_id": attach(a, p)["id"]}, 422),
    ]:
        assert a.post(endpoint, json=invalid).status_code == status
    second = paper(a)
    assert a.post(f"/api/v1/papers/{second['id']}/shares", json=body).status_code == 422
    previous = settings.storage_limit
    settings.storage_limit = 1
    assert a.post(endpoint, json=body).status_code == 413
    settings.storage_limit = previous
    link = a.post(endpoint, json=body).json()
    with app.state.maker() as d:
        d.get(PaperShare, link["id"]).expires_at = "2000-01-01T00:00:00+00:00"
        d.commit()
    assert TestClient(app).get("/api/v1/shared/" + link["token"]).status_code == 404
    with app.state.maker() as d:
        base = d.get(PaperShare, link["id"])
        for _ in range(99):
            d.add(
                PaperShare(
                    owner=base.owner,
                    paper_id=p["id"],
                    file_id=f["id"],
                    file_sha256=f["sha256"],
                    file_name=f["name"],
                    title=p["title"],
                    token_hash=uuid.uuid4().hex,
                    size=2048,
                    expires_at=base.expires_at,
                )
            )
        d.commit()
    assert a.post(endpoint, json=body).status_code == 409
    assert a.get("/api/v1/storage-usage").json()["categories"]["paper_shares"] > 0


def test_share_rejects_tampered_files_and_unselected_images(env):
    app, a, _, settings, _, f, _, image, endpoint, body = setup_share(env)
    link = a.post(endpoint, json={**body, "note_id": None}).json()
    client = TestClient(app)
    path = "/api/v1/shared/" + link["token"]
    assert client.get(path).json()["note"] is None
    assert client.get(path + "/images/" + image["id"]).status_code == 404
    file_path = Path(settings.storage) / f["id"]
    file_path.write_bytes(b"changed")
    assert client.get(path + "/pdf").status_code == 404
    file_path.unlink()
    file_path.symlink_to("/etc/passwd")
    assert client.get(path + "/pdf").status_code == 404
    client.close()


def test_public_share_request_and_byte_rate_limits(env):
    app, a, _, _, _, f, _, _, endpoint, body = setup_share(env)
    link = a.post(endpoint, json=body).json()
    client = TestClient(app)
    path = "/api/v1/shared/" + link["token"]
    app.state.share_limiter.request_limit = 2
    assert client.get(path).status_code == 200
    assert client.get(path).status_code == 200
    limited = client.get(path)
    assert limited.status_code == 429
    assert limited.headers["referrer-policy"] == "no-referrer"
    app.state.share_limiter.request_limit = 10
    app.state.share_limiter.ip_bytes = f["size"] - 1
    assert client.get(path + "/pdf").status_code == 429
    client.close()


def test_agent_identity_cannot_publish_share_even_with_owner_scope(env):
    app, a, _, _, _, _, _, _, endpoint, body = setup_share(env)
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]

    async def scoped(scope, receive, send):
        scope["workspace_agent_identity"] = {
            "id": owner,
            "agent": False,
            "actor": "agent:test",
        }
        await app(scope, receive, send)

    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=scoped), base_url="http://internal"
        ) as agent:
            assert (await agent.post(endpoint, json=body)).status_code == 403

    asyncio.run(request())
    assert a.get(endpoint).json() == []


def test_share_backup_export_restore_migration_and_paper_delete(
    env, tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config

    app, a, _, settings, p, f, _, _, endpoint, body = setup_share(env)
    link = a.post(endpoint, json=body).json()
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as z:
        rows = json.loads(z.read("workspace.json"))["data"]["paper_shares"]
        assert len(rows) == 1
        assert link["token"] not in json.dumps(rows)
    archive = tmp_path / "shares.zip"
    backup(settings, archive)
    restored = Settings(
        database_url="sqlite:///" + str(tmp_path / "restore.db"),
        storage=str(tmp_path / "restored"),
        testing=True,
    )
    other = create_app(restored)
    Base.metadata.create_all(other.state.engine)
    assert restore(restored, archive)["paper_shares"] == 1
    assert TestClient(other).get("/api/v1/shared/" + link["token"]).status_code == 200
    other.state.engine.dispose()
    monkeypatch.setenv("DATABASE_URL", settings.database_url)
    with app.state.engine.begin() as conn:
        conn.execute(text("DROP TABLE paper_shares"))
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        conn.execute(text("INSERT INTO alembic_version VALUES ('0018')"))
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    with app.state.maker() as d:
        assert d.get(File, f["id"]) is not None
        assert d.scalar(select(PaperShare)) is None
    fresh = a.post(endpoint, json=body).json()
    assert (
        a.delete(
            "/api/v1/papers/" + p["id"],
            headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
        ).status_code
        == 200
    )
    with app.state.maker() as d:
        assert d.scalar(select(PaperShare)) is None

    assert (
        TestClient(app).get("/api/v1/shared/" + fresh["token"] + "/pdf").status_code
        == 404
    )
