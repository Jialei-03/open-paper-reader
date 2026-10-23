import io
import json
import uuid
import zipfile

import pytest
from sqlalchemy import select, text

from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import Base, File, TextAnnotation
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def annotation_fixture(env):
    app, a, b, settings = env
    p = paper(a)
    f = attach(a, p, "annotated.pdf", pdf_bytes())
    endpoint = f"/api/v1/files/{f['id']}/annotations"
    url = endpoint + "/" + str(uuid.uuid4())
    payload = {
        "page": 2,
        "quote": "Selected evidence",
        "prefix": "Previous sentence",
        "rects": [{"x": 0.1, "y": 0.2, "w": 0.6, "h": 0.02}],
        "color": "#fde68a",
        "comment": "Needs replication",
    }
    return app, a, b, settings, p, f, endpoint, url, payload


def test_annotation_crud_ownership_revision_and_idempotency(env):
    app, a, b, _, p, f, endpoint, url, payload = annotation_fixture(env)
    notes_before = a.get("/api/v1/items").json()
    assert b.get(endpoint).status_code == 404
    assert b.put(url, json=payload).status_code == 404
    first = a.put(url, json=payload)
    assert first.status_code == 200, first.text
    row = first.json()
    assert row["file_id"] == f["id"]
    assert row["version_id"] == f["version_id"]
    assert row["paper_id"] == p["id"]
    assert row["rects"] == payload["rects"]
    assert a.put(url, json=payload).json() == row
    assert len(a.get(endpoint).json()) == 1
    assert a.put(url, json={**payload, "quote": "different"}).status_code == 409
    assert b.patch(url, json={"revision": 1, "comment": "attack"}).status_code == 404
    assert b.delete(url + "?revision=1").status_code == 404
    other_file = attach(a, p, "translation.pdf", pdf_bytes())
    wrong_path = f"/api/v1/files/{other_file['id']}/annotations/{row['id']}"
    assert a.put(wrong_path, json=payload).status_code == 404
    assert (
        a.patch(wrong_path, json={"revision": 1, "comment": "wrong file"}).status_code
        == 404
    )
    edited = a.patch(
        url, json={"revision": 1, "comment": "Updated comment", "color": "#aabbcc"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 2
    assert a.patch(url, json={"revision": 1, "comment": "stale"}).status_code == 409
    assert a.delete(url + "?revision=1").status_code == 409
    assert a.get(endpoint).json()[0]["comment"] == "Updated comment"
    assert a.get("/api/v1/items").json() == notes_before
    assert a.get("/api/v1/storage-usage").json()["categories"]["text_annotations"] > 0
    assert a.delete(url + "?revision=2").status_code == 200
    assert a.delete(url + "?revision=2").status_code == 200
    assert a.get(endpoint).json() == []
    assert a.put(url, json=payload).json()["deleted"] is True
    assert a.patch(url, json={"revision": 3, "comment": "revive"}).status_code == 404
    deleted = a.delete(
        "/api/v1/papers/" + p["id"],
        headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
    )
    assert deleted.status_code == 200, deleted.text
    with app.state.maker() as d:
        assert d.scalar(select(TextAnnotation)) is None


@pytest.mark.parametrize(
    "change",
    [
        {"page": 13},
        {"page": True},
        {"quote": " "},
        {"quote": "a" * 10001},
        {"comment": "a" * 10001},
        {"color": "url(evil)"},
        {"rects": []},
        {"rects": [{"x": 0.9, "y": 0, "w": 0.2, "h": 0.1}]},
        {"rects": [{"x": 0, "y": 0, "w": 0, "h": 0.1}]},
        {"rects": [{"x": 0, "y": 0, "w": 0.1, "h": 0.1}] * 65},
    ],
)
def test_annotation_rejects_invalid_geometry_and_unbounded_payload(env, change):
    _, a, _, _, _, _, endpoint, url, payload = annotation_fixture(env)
    assert a.put(url, json={**payload, **change}).status_code == 422
    assert a.get(endpoint).json() == []


def test_annotation_quota_and_file_limits(env):
    app, a, _, settings, _, f, endpoint, url, payload = annotation_fixture(env)
    original_limit = settings.storage_limit
    settings.storage_limit = 1
    assert a.put(url, json=payload).status_code == 413
    settings.storage_limit = original_limit
    row = a.put(url, json=payload).json()
    with app.state.maker() as d:
        d.get(TextAnnotation, row["id"]).size = 16 * 1024**2
        d.commit()
    assert a.put(endpoint + "/" + str(uuid.uuid4()), json=payload).status_code == 409
    with app.state.maker() as d:
        annotation = d.get(TextAnnotation, row["id"])
        annotation.size = row["size"]
        # Tombstones also consume the count budget: retry IDs cannot grow unbounded.
        for _ in range(4999):
            d.add(
                TextAnnotation(
                    id=str(uuid.uuid4()),
                    owner=annotation.owner,
                    paper_id=annotation.paper_id,
                    file_id=f["id"],
                    version_id=f["version_id"],
                    page=1,
                    quote="",
                    prefix="",
                    rects=[],
                    color="#fde68a",
                    comment="",
                    size=512,
                    deleted=True,
                )
            )
        d.commit()
    assert a.put(endpoint + "/" + str(uuid.uuid4()), json=payload).status_code == 409


def test_annotations_export_backup_restore_and_old_backup(env, tmp_path):
    _app, a, b, settings, _, _, _, url, payload = annotation_fixture(env)
    row = a.put(url, json=payload).json()
    for client, expected in ((a, 1), (b, 0)):
        with zipfile.ZipFile(io.BytesIO(client.get("/api/v1/export").content)) as z:
            assert (
                len(json.loads(z.read("workspace.json"))["data"]["text_annotations"])
                == expected
            )
    archive = tmp_path / "annotations.zip"
    backup(settings, archive)
    for legacy in (False, True):
        source = archive
        if legacy:
            source = tmp_path / "old.zip"
            with (
                zipfile.ZipFile(archive) as original,
                zipfile.ZipFile(source, "w") as old,
            ):
                for name in original.namelist():
                    raw = original.read(name)
                    if name == "backup.json":
                        data = json.loads(raw)
                        data["schema_version"] = 10
                        data["data"].pop("text_annotations")
                        raw = json.dumps(data).encode()
                    old.writestr(name, raw)
        restored = Settings(
            database_url="sqlite:///" + str(tmp_path / f"restore-{legacy}.db"),
            storage=str(tmp_path / f"files-{legacy}"),
            testing=True,
        )
        other = create_app(restored)
        Base.metadata.create_all(other.state.engine)
        assert restore(restored, source)["text_annotations"] == (0 if legacy else 1)
        if not legacy:
            with other.state.maker() as d:
                restored_row = d.get(TextAnnotation, row["id"])
                assert restored_row.comment == payload["comment"]
                assert restored_row.rects == payload["rects"]
        other.state.engine.dispose()


def test_annotation_migration_preserves_file(env, monkeypatch):
    from alembic import command
    from alembic.config import Config

    app, _, _, settings, _, f, _, _, _ = annotation_fixture(env)
    monkeypatch.setenv("DATABASE_URL", settings.database_url)
    with app.state.engine.begin() as conn:
        conn.execute(text("DROP TABLE text_annotations"))
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        conn.execute(text("INSERT INTO alembic_version VALUES ('0014')"))
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    with app.state.maker() as d:
        assert d.get(File, f["id"]).name == f["name"]
        assert d.scalar(select(TextAnnotation)) is None
    command.downgrade(Config(toml_file="pyproject.toml"), "0014")
    with app.state.maker() as d:
        assert d.get(File, f["id"]) is not None
