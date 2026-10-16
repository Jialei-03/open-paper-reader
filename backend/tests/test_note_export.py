import io
import zipfile

from PIL import Image

from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper, write


def image(a, note_id):
    output = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(output, format="PNG")
    response = a.post(
        f"/api/v1/items/{note_id}/images",
        files={"file": ("../unsafe.png", output.getvalue(), "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def note(a):
    p = paper(a)
    return next(
        row for row in a.get("/api/v1/items").json() if row["paper_id"] == p["id"]
    )


def save(a, n, body):
    return write(
        a,
        "/items/" + n["id"],
        {
            "kind": "note",
            "paper_id": n["paper_id"],
            "title": "Portable note",
            "body": body,
        },
        "PUT",
        n["revision"],
    ).json()


def test_note_export_packages_only_referenced_images_and_rewrites_links(env):
    _, a, _, _ = env
    n = note(a)
    asset = image(a, n["id"])
    n = save(a, n, f"Evidence\n\n![Figure]({asset['url']})\n\n![Again]({asset['url']})")
    result = a.get(f"/api/v1/items/{n['id']}/export?revision={n['revision']}")
    assert result.status_code == 200, result.text
    with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
        path = f"images/{asset['id']}.png"
        assert archive.namelist() == ["note.md", path]
        text = archive.read("note.md").decode()
        assert text.startswith("# Portable note")
        assert text.count(path) == 2 and "/api/v1/note-images/" not in text
        assert archive.read(path).startswith(b"\x89PNG")
    assert a.get(f"/api/v1/items/{n['id']}/export?revision=1").status_code == 409


def test_note_export_rejects_foreign_note_or_embedded_foreign_image(env):
    app, a, b, _ = env
    first, second = note(a), note(b)
    asset = image(b, second["id"])
    assert b.get(f"/api/v1/items/{first['id']}/export").status_code == 404
    # Simulate a stale/restored document bypassing current write validation.
    from backend.models import Item

    with app.state.maker() as d:
        d.get(Item, first["id"]).body = f"![Private]({asset['url']})"
        d.commit()
    assert a.get(f"/api/v1/items/{first['id']}/export").status_code == 404


def test_note_export_missing_image_fails_and_external_urls_are_not_fetched(env):
    app, a, _, _ = env
    n = note(a)
    n = save(a, n, "![Remote](https://invalid.example/a.png)")
    response = a.get(f"/api/v1/items/{n['id']}/export")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["note.md"]
        assert b"https://invalid.example/a.png" in archive.read("note.md")
    from backend.models import Item

    with app.state.maker() as d:
        d.get(
            Item, n["id"]
        ).body = "![Missing](/api/v1/note-images/00000000-0000-0000-0000-000000000001)"
        d.commit()
    assert a.get(f"/api/v1/items/{n['id']}/export").status_code == 404
