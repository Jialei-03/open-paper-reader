import io
import json
import zipfile

from fastapi.testclient import TestClient
from PIL import Image

from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import Base
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write


def test_note_images_private_durable_and_exported(env, tmp_path):
    app, a, b, settings = env
    note = write(
        a, "/items", {"kind": "note", "title": "Illustrated", "body": ""}
    ).json()
    out = io.BytesIO()
    Image.new("RGB", (48, 32), "green").save(out, "PNG")
    raw = out.getvalue()
    endpoint = f"/api/v1/items/{note['id']}/images"
    assert b.post(endpoint, files={"file": ("x.png", raw)}).status_code == 404
    assert (
        a.post(
            endpoint, files={"file": ("x.svg", b'<svg onload="alert(1)"/>')}
        ).status_code
        == 422
    )
    assert (
        a.post(
            endpoint, files={"file": ("x.png", b"x" * (8 * 1024**2 + 1))}
        ).status_code
        == 413
    )
    r = a.post(endpoint, files={"file": ("screenshot.png", raw)})
    assert r.status_code == 200, r.text
    image = r.json()
    assert (
        a.post(endpoint, files={"file": ("duplicate.png", raw)}).json()["id"]
        == image["id"]
    )
    content = a.get(image["url"])
    assert content.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(content.content)).size == (48, 32)
    assert b.get(image["url"]).status_code == 404
    assert TestClient(app).get(image["url"]).status_code == 401
    body = f"图片之前\n\n![实验图]({image['url']})\n\n图片之后"
    note = write(
        a,
        f"/items/{note['id']}",
        {"kind": "note", "title": note["title"], "body": body},
        method="PUT",
        revision=note["revision"],
    ).json()
    assert a.get(f"/api/v1/items/{note['id']}").json()["body"] == body
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as z:
        assert z.read("files/" + image["id"]) == content.content
        assert ("../files/" + image["id"]) in z.read(f"notes/{note['id']}.md").decode()
        assert len(json.loads(z.read("workspace.json"))["data"]["note_images"]) == 1
    archive = tmp_path / "backup.zip"
    backup(settings, archive)
    restored = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    restored_app = create_app(restored)
    Base.metadata.create_all(restored_app.state.engine)
    counts = restore(restored, archive)
    assert counts["note_images"] == 1
    assert (tmp_path / "restored-files" / image["id"]).read_bytes() == content.content
    restored_app.state.engine.dispose()
