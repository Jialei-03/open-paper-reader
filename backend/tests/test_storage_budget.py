import io
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from backend import storage_budget
from backend.models import Paper
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.translations import store_file


def test_all_durable_files_share_account_budget_and_duplicates_are_free(env):
    app, a, b, settings = env
    p = paper(a)
    attach(a, p, "paper.txt", b"paper content")
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])
    chat = a.post("/api/v1/agent/attachments", files={"file": ("note.txt", b"hello")})
    assert chat.status_code == 200
    out = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(out, "PNG")
    image = a.post(
        f"/api/v1/items/{note['id']}/images",
        files={"file": ("image.png", out.getvalue())},
    )
    assert image.status_code == 200
    usage = a.get("/api/v1/storage-usage").json()
    assert usage["categories"]["papers"] == len(b"paper content")
    assert usage["categories"]["chat_attachments"] == 5
    assert usage["categories"]["note_images"] > 0
    assert usage["used_bytes"] == sum(usage["categories"].values())
    assert b.get("/api/v1/storage-usage").json()["used_bytes"] == 0
    settings.storage_limit = usage["used_bytes"]
    duplicate = a.post(
        "/api/v1/agent/attachments", files={"file": ("note.txt", b"hello")}
    )
    assert duplicate.status_code == 200 and duplicate.json()["id"] == chat.json()["id"]
    assert (
        a.post(
            f"/api/v1/items/{note['id']}/images",
            files={"file": ("image.png", out.getvalue())},
        ).json()["id"]
        == image.json()["id"]
    )
    assert (
        a.post(
            "/api/v1/agent/attachments", files={"file": ("new.txt", b"new")}
        ).status_code
        == 413
    )
    denied = a.post(
        f"/api/v1/papers/{p['id']}/files",
        data={"version_id": p["current_version"]},
        files={"file": ("new.txt", b"new")},
        headers={"Idempotency-Key": "over-budget"},
    )
    assert denied.status_code == 413
    before = set(Path(settings.storage).iterdir())
    with app.state.maker() as d, pytest.raises(storage_budget.StorageBudgetExceeded):
        store_file(
            d,
            settings,
            d.get(Paper, p["id"]),
            p["current_version"],
            "translation.txt",
            b"new translated content",
        )
    assert set(Path(settings.storage).iterdir()) == before
    assert a.get("/api/v1/storage-usage").json()["used_bytes"] == usage["used_bytes"]


def test_low_disk_checks_incoming_bytes_and_does_not_create_file(env, monkeypatch):
    _, a, _, settings = env
    p = paper(a)
    monkeypatch.setattr(
        storage_budget.shutil,
        "disk_usage",
        lambda _: SimpleNamespace(free=settings.storage_min_free + 1),
    )
    response = a.post(
        f"/api/v1/papers/{p['id']}/files",
        data={"version_id": p["current_version"]},
        files={"file": ("a.txt", b"two")},
        headers={"Idempotency-Key": "low-disk"},
    )
    assert response.status_code == 413 and "服务器" in response.json()["detail"]
    assert a.get("/api/v1/storage-usage").json()["used_bytes"] == 0


def test_failed_write_removes_partial_but_never_existing_file(env, monkeypatch):
    _, _, _, settings = env
    target = Path(settings.storage) / "fixture"
    target.write_bytes(b"keep")
    with pytest.raises(FileExistsError):
        storage_budget.write_blob(settings, "fixture", b"replace")
    assert target.read_bytes() == b"keep"
    original = storage_budget.os.fdopen

    @contextmanager
    def broken(fd, mode):
        with original(fd, mode) as file:

            class Writer:
                fileno = file.fileno

                def write(self, data):
                    file.write(data[:1])
                    raise OSError("simulated full disk")

            yield Writer()

    monkeypatch.setattr(storage_budget.os, "fdopen", broken)
    with pytest.raises(OSError):
        storage_budget.write_blob(settings, "partial", b"new data")
    assert not (Path(settings.storage) / "partial").exists()


def test_arxiv_quota_failure_rolls_back_paper_and_reports_storage(env, monkeypatch):
    from backend import translations

    _, a, _, settings = env
    settings.storage_limit = 1
    monkeypatch.setattr(
        translations,
        "metadata",
        lambda _: {
            "arxiv_id": "2601.00001v1",
            "title": "Fixture",
            "authors": "Test",
            "abstract": "Test",
        },
    )
    monkeypatch.setattr(translations, "download", lambda _: b"%PDF-1.7\nfixture")
    result = a.post(
        "/api/v1/import/arxiv",
        json={"url": "https://arxiv.org/abs/2601.00001"},
        headers={"Idempotency-Key": "quota-import"},
    )
    assert result.status_code == 413 and "账号存储" in result.json()["detail"]
    assert a.get("/api/v1/papers").json() == []
    assert a.get("/api/v1/storage-usage").json()["used_bytes"] == 0
