import asyncio
import io
import zipfile

from fastapi.testclient import TestClient
from PIL import Image

from backend.agent_tools import execute
from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import Base
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes


def test_chat_upload_read_visual_isolation_and_backup(env, tmp_path):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    files = [
        ("paper.pdf", pdf_bytes()),
        ("notes.md", b"Chat attachment finding: blue whale 42"),
    ]
    out = io.BytesIO()
    Image.new("RGB", (48, 32), "blue").save(out, "PNG")
    files.append(("figure.png", out.getvalue()))
    rows = []
    for name, data in files:
        r = a.post("/api/v1/agent/attachments", files={"file": (name, data)})
        assert r.status_code == 200, r.text
        row = r.json()
        rows.append(row)
        assert a.get(row["url"]).content == data
        preview = a.get(row["url"] + "?preview=true")
        assert preview.content == data
        assert preview.headers["content-disposition"] == (
            "inline" if name.endswith(".png") else "attachment"
        )
        assert b.get(row["url"] + "?preview=true").status_code == 404
        assert b.get(row["url"]).status_code == 404
        assert TestClient(app).get(row["url"]).status_code == 401
    assert a.get("/api/v1/papers").json() == []
    text = asyncio.run(
        execute(
            app,
            owner,
            "test-session",
            "read_file",
            {"id": rows[1]["id"]},
            "test-key",
            writable=False,
        )
    )
    assert "blue whale 42" in text["text"]
    pdf = asyncio.run(
        execute(
            app,
            owner,
            "test-session",
            "read_file",
            {"id": rows[0]["id"], "page": 11},
            "test-key",
            writable=False,
        )
    )
    assert pdf["pages"][0]["text"]
    visual = asyncio.run(
        execute(
            app,
            owner,
            "test-session",
            "view_image",
            {"id": rows[2]["id"]},
            "test-key",
            writable=False,
        )
    )
    assert visual["images"][0]["label"] == "figure.png"
    assert visual["_image_content"][0]["mimeType"] == "image/jpeg"
    assert a.get(visual["images"][0]["url"]).status_code == 200
    assert (
        a.post(
            "/api/v1/agent/attachments", files={"file": ("evil.html", b"<script/>")}
        ).status_code
        == 422
    )
    assert (
        a.post(
            "/api/v1/agent/attachments",
            files={"file": ("big.txt", b"x" * (20 * 1024**2 + 1))},
        ).status_code
        == 413
    )
    session = a.post("/api/v1/agent/sessions", json={}).json()
    foreign = b.post(
        "/api/v1/agent/attachments", files={"file": ("private.txt", b"private")}
    ).json()
    request = {
        "prompt": "Read attachments",
        "model_config_id": model,
        "attachment_ids": [foreign["id"]],
    }
    assert (
        a.post(f"/api/v1/agent/sessions/{session['id']}/runs", json=request).status_code
        == 404
    )
    request["attachment_ids"] = [r["id"] for r in rows]
    r = a.post(f"/api/v1/agent/sessions/{session['id']}/runs", json=request)
    assert r.status_code == 200, r.text
    assert len(r.json()["attachments"]) == 3
    assert (
        len(
            a.get(f"/api/v1/agent/sessions/{session['id']}/runs").json()[0][
                "attachments"
            ]
        )
        == 3
    )
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as z:
        assert z.read("files/" + rows[0]["id"]) == files[0][1]
    archive = tmp_path / "chat.zip"
    backup(settings, archive)
    target = Settings(
        database_url="sqlite:///" + str(tmp_path / "new.db"),
        storage=str(tmp_path / "new-files"),
        testing=True,
    )
    other = create_app(target)
    Base.metadata.create_all(other.state.engine)
    assert restore(target, archive)["agent_attachments"] == 4
    assert (tmp_path / "new-files" / rows[0]["id"]).read_bytes() == files[0][1]
    other.state.engine.dispose()
