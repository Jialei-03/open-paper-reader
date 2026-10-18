import io
from pathlib import Path

import pypdfium2 as pdfium

from backend import thumbnails
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import (
    env as env,  # noqa: PLC0414 - pytest fixture re-export
)


def pdf_bytes(width=612, height=792):
    document = pdfium.PdfDocument.new()
    document.new_page(width, height)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def test_thumbnail_is_drawn_once_cached_and_isolated(env, monkeypatch):
    _, alice, bob, settings = env
    record = attach(alice, paper(alice), "a.pdf", pdf_bytes())
    url = f"/api/v1/files/{record['id']}/thumbnail"
    stored = Path(settings.storage) / (record["id"] + ".thumb.jpg")
    calls = []
    real = thumbnails.render
    monkeypatch.setattr(
        thumbnails, "render", lambda *a: calls.append(1) or real(*a)
    )
    first = alice.get(url)
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/jpeg"
    assert first.content.startswith(b"\xff\xd8")
    assert first.headers["cache-control"] == "private, max-age=31536000, immutable"
    etag = first.headers["etag"]
    from PIL import Image

    assert Image.open(io.BytesIO(first.content)).width == thumbnails.WIDTH
    assert stored.is_file()
    n = len(calls)
    assert alice.get(url).content == first.content
    assert len(calls) == n  # not drawn again
    assert alice.get(url, headers={"If-None-Match": etag}).status_code == 304
    assert bob.get(url).status_code == 404
    assert bob.get(url, headers={"If-None-Match": etag}).status_code == 404
    # A missing picture is drawn again.
    stored.unlink()
    assert alice.get(url).status_code == 200 and stored.is_file()
    # Deleting the unused file takes the picture with it.
    thumbnails.remove(settings, record["id"])
    assert not stored.exists()


def test_thumbnail_drawn_on_import_and_removed_with_paper(env):
    _, alice, _, settings = env
    p = paper(alice)
    record = attach(alice, p, "a.pdf", pdf_bytes())
    stored = Path(settings.storage) / (record["id"] + ".thumb.jpg")
    assert stored.is_file()  # drawn after the upload, before any view
    revision = alice.get("/api/v1/papers/" + p["id"]).json()["revision"]
    response = alice.delete(
        "/api/v1/papers/" + p["id"], headers={"If-Match": str(revision), "X-Confirm-Delete": p["id"]}
    )
    assert response.status_code == 200, response.text
    assert not stored.exists()
    assert not (Path(settings.storage) / record["id"]).exists()


def test_thumbnail_unreadable_or_not_pdf_is_404(env):
    _, alice, _, settings = env
    bad = attach(alice, paper(alice), "bad.pdf", pdf_bytes())
    # The bytes go bad after the upload check (a damaged disk, a hostile edit).
    (Path(settings.storage) / bad["id"]).write_bytes(b"%PDF-1.7\ninvalid")
    for r in (bad,):
        (Path(settings.storage) / (r["id"] + ".thumb.jpg")).unlink(missing_ok=True)
    text = attach(alice, paper(alice))
    huge = attach(alice, paper(alice), "huge.pdf", pdf_bytes(20000, 20000))
    thin = attach(alice, paper(alice), "thin.pdf", pdf_bytes(100, 2000))
    for r in (huge, thin):  # refused at the page-shape check, never stored
        assert not (Path(settings.storage) / (r["id"] + ".thumb.jpg")).exists()
    for r in (bad, text, huge, thin):
        response = alice.get(f"/api/v1/files/{r['id']}/thumbnail")
        assert response.status_code == 404, r
        assert "immutable" not in response.headers.get("cache-control", "")
