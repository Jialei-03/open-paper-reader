import io
import json
import uuid
import zipfile

from pypdf import PdfWriter
from sqlalchemy import select

from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import Base, InkStroke
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper


def test_ink_isolated_idempotent_validated_and_restored(env, tmp_path):
    app, a, b, settings = env
    p = paper(a)
    doc = PdfWriter()
    doc.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    doc.write(buffer)
    file = a.post(
        f"/api/v1/papers/{p['id']}/files",
        data={"version_id": p["current_version"]},
        files={"file": ("ink.pdf", buffer.getvalue(), "application/pdf")},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    ).json()
    endpoint = f"/api/v1/files/{file['id']}/ink"
    identifier = str(uuid.uuid4())
    data = {
        "page": 1,
        "color": "#2456a6",
        "width": 2,
        "points": [[0.1, 0.2, 0.5], [0.3, 0.4, 0.8]],
    }
    assert b.get(endpoint).status_code == 404
    assert b.put(endpoint + "/" + identifier, json=data).status_code == 404
    for invalid in (
        {**data, "page": 2},
        {**data, "points": [[1.5, 0, 0.5]]},
        {**data, "color": "url(x)"},
        {**data, "points": []},
    ):
        assert a.put(endpoint + "/" + identifier, json=invalid).status_code == 422
    for _ in range(2):
        response = a.put(endpoint + "/" + identifier, json=data)
        assert response.status_code == 200, response.text
    assert len(a.get(endpoint).json()) == 1
    assert a.get(endpoint).json()[0]["data"] == data
    assert b.delete(endpoint + "/" + identifier).status_code == 404
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as z:
        assert len(json.loads(z.read("workspace.json"))["data"]["ink_strokes"]) == 1
    archive = tmp_path / "backup.zip"
    backup(settings, archive)
    restored = Settings(
        database_url="sqlite:///" + str(tmp_path / "restore.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    other = create_app(restored)
    Base.metadata.create_all(other.state.engine)
    assert restore(restored, archive)["ink_strokes"] == 1
    with other.state.maker() as d:
        assert d.scalar(select(InkStroke)).data == data
    other.state.engine.dispose()
    assert a.delete(endpoint + "/" + identifier).status_code == 200
    assert a.delete(endpoint + "/" + identifier).status_code == 200
    # A delayed retry cannot resurrect a stroke already erased on another device.
    assert a.put(endpoint + "/" + identifier, json=data).json()["deleted"] is True
    assert a.get(endpoint).json() == []
    result = a.delete(
        "/api/v1/papers/" + p["id"],
        headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
    )
    assert result.status_code == 200, result.text
    with app.state.maker() as d:
        assert d.scalar(select(InkStroke)) is None


def test_ink_migration_preserves_existing_file(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from backend.config import database

    url = "sqlite:///" + str(tmp_path / "migration.db")
    monkeypatch.setenv("DATABASE_URL", url)
    settings = Settings(database_url=url, storage=str(tmp_path / "files"), testing=True)
    engine, _ = database(settings)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE ink_strokes"))
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        conn.execute(text("INSERT INTO alembic_version VALUES ('0013')"))
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM ink_strokes")).scalar() == 0
    command.downgrade(Config(toml_file="pyproject.toml"), "0013")
    engine.dispose()
