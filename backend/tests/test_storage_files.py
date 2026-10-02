import io
from pathlib import Path

from PIL import Image

from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper, write
from backend.tests.test_agents import configure


def upload_image(a, note):
    out = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(out, "PNG")
    result = a.post(
        f"/api/v1/items/{note['id']}/images",
        files={"file": ("image.png", out.getvalue())},
    )
    assert result.status_code == 200
    return result.json()


def erase(a, kind, id):
    return a.delete(
        f"/api/v1/storage-files/{kind}/{id}", headers={"X-Confirm-Delete": id}
    )


def test_unused_cleanup_is_private_confirmed_and_releases_quota(env):
    _, a, b, settings = env
    file = a.post(
        "/api/v1/agent/attachments", files={"file": ("draft.txt", b"draft")}
    ).json()
    inventory = a.get("/api/v1/storage-files").json()
    assert inventory["items"][0]["can_delete"]
    assert b.get("/api/v1/storage-files").json()["total"] == 0
    assert erase(b, "chat_attachments", file["id"]).status_code == 404
    assert (
        a.delete(f"/api/v1/storage-files/chat_attachments/{file['id']}").status_code
        == 428
    )
    assert erase(a, "chat_attachments", file["id"]).status_code == 200
    assert not (Path(settings.storage) / file["id"]).exists()
    assert a.get("/api/v1/storage-usage").json()["used_bytes"] == 0


def test_history_keeps_images_and_deleted_links_cannot_be_saved(env):
    _, a, _, _ = env
    p = paper(a)
    note = next(
        row for row in a.get("/api/v1/items").json() if row["paper_id"] == p["id"]
    )
    image = upload_image(a, note)
    saved = write(
        a,
        "/items/" + note["id"],
        {
            "kind": "note",
            "title": note["title"],
            "body": f"![figure]({image['url']})",
            "paper_id": p["id"],
        },
        method="PUT",
        revision=note["revision"],
    ).json()
    assert erase(a, "note_images", image["id"]).status_code == 409
    cleared = write(
        a,
        "/items/" + note["id"],
        {"kind": "note", "title": note["title"], "body": "", "paper_id": p["id"]},
        method="PUT",
        revision=saved["revision"],
    ).json()
    row = next(
        row
        for row in a.get("/api/v1/storage-files").json()["items"]
        if row["id"] == image["id"]
    )
    assert row["reference"] == "历史版本"
    assert erase(a, "note_images", image["id"]).status_code == 409
    assert (
        a.delete(
            "/api/v1/items/" + note["id"],
            headers={"If-Match": str(cleared["revision"])},
        ).status_code
        == 200
    )
    assert erase(a, "note_images", image["id"]).status_code == 200
    rejected = write(
        a,
        "/items",
        {"kind": "note", "title": "new", "body": f"![deleted]({image['url']})"},
    )
    assert rejected.status_code == 422


def test_chat_references_protected_until_session_removed(env):
    app, a, _, settings = env
    _, model = configure(app, a, settings)
    file = a.post(
        "/api/v1/agent/attachments", files={"file": ("draft.txt", b"draft")}
    ).json()
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    run = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={
            "prompt": "read",
            "attachment_ids": [file["id"]],
            "model_config_id": model,
        },
    ).json()
    assert erase(a, "chat_attachments", file["id"]).status_code == 409
    a.post(f"/api/v1/agent/runs/{run['id']}/cancel", json={})
    assert erase(a, "chat_attachments", file["id"]).status_code == 409
    assert a.delete(f"/api/v1/agent/sessions/{session}").status_code == 200
    assert erase(a, "chat_attachments", file["id"]).status_code == 200


def test_external_image_path_is_not_a_local_attachment(env):
    _, a, _, _ = env
    result = write(
        a,
        "/items",
        {
            "kind": "note",
            "title": "External image",
            "body": "![image](https://example.org/api/v1/note-images/00000000-0000-0000-0000-000000000000)",
        },
    )
    assert result.status_code == 200
