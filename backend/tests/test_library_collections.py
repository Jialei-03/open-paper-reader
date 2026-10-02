from uuid import uuid4

from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper, write


def create(a, name="Memory", ids=None, identifier=None):
    return write(
        a,
        "/library-collections",
        {"id": identifier or str(uuid4()), "name": name, "paper_ids": ids or []},
    )


def test_collection_explicit_creation_membership_revision_and_delete_keeps_papers(env):
    _, a, _, _ = env
    first, second = paper(a), paper(a)
    assert a.get("/api/v1/library-collections").json() == []
    identifier = str(uuid4())
    created = create(a, ids=[first["id"]], identifier=identifier)
    assert created.status_code == 200, created.text
    collection = created.json()
    assert (
        create(a, ids=[first["id"]], identifier=identifier).json()["id"] == identifier
    )
    assert len(a.get("/api/v1/library-collections").json()) == 1
    assert create(a, name="memory").status_code == 409
    assert create(a, name="  ").status_code == 422
    updated = write(
        a,
        f"/library-collections/{identifier}",
        {
            "revision": 1,
            "name": "Agent memory",
            "paper_ids": [first["id"], second["id"], first["id"]],
        },
        "PATCH",
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["paper_ids"] == [first["id"], second["id"]]
    assert updated.json()["revision"] == collection["revision"] + 1
    assert (
        write(
            a,
            f"/library-collections/{identifier}",
            {"revision": 1, "name": "Stale"},
            "PATCH",
        ).status_code
        == 409
    )
    assert (
        a.delete(f"/api/v1/library-collections/{identifier}?revision=1").status_code
        == 409
    )
    assert (
        a.delete(f"/api/v1/library-collections/{identifier}?revision=2").status_code
        == 200
    )
    assert len(a.get("/api/v1/papers").json()) == 2
    assert len(a.get("/api/v1/items").json()) == 2


def test_collection_rejects_foreign_papers_and_cross_user_access(env):
    _, a, b, _ = env
    own, foreign = paper(a), paper(b)
    assert create(a, ids=[foreign["id"]]).status_code == 404
    c = create(a, ids=[own["id"]]).json()
    assert b.get("/api/v1/library-collections").json() == []
    assert create(b, identifier=c["id"]).status_code == 404
    assert (
        write(
            b,
            f"/library-collections/{c['id']}",
            {"revision": 1, "name": "Wrong"},
            "PATCH",
        ).status_code
        == 404
    )
    assert (
        b.delete(f"/api/v1/library-collections/{c['id']}?revision=1").status_code == 404
    )
    assert (
        write(
            a,
            f"/library-collections/{c['id']}",
            {"revision": 1, "paper_ids": [foreign["id"]]},
            "PATCH",
        ).status_code
        == 404
    )
    assert a.get("/api/v1/library-collections").json()[0]["paper_ids"] == [own["id"]]


def test_paper_delete_removes_collection_membership_in_same_transaction(env):
    _, a, _, _ = env
    p = paper(a)
    c = create(a, ids=[p["id"]]).json()
    response = a.delete(
        f"/api/v1/papers/{p['id']}",
        headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
    )
    assert response.status_code == 200, response.text
    rows = a.get("/api/v1/library-collections").json()
    assert rows[0]["id"] == c["id"] and rows[0]["paper_ids"] == []
    assert rows[0]["revision"] == c["revision"] + 1


def test_collections_survive_backup_restore_and_export(env, tmp_path):
    import io
    import json
    import zipfile

    from sqlalchemy import select

    from backend.cli import backup, restore
    from backend.config import Settings, database
    from backend.library_collections import LibraryCollection
    from backend.models import Base

    _, a, _, settings = env
    p = paper(a)
    c = create(a, ids=[p["id"]]).json()
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as archive:
        assert (
            json.loads(archive.read("workspace.json"))["data"]["library_collections"][
                0
            ]["id"]
            == c["id"]
        )
    archive = tmp_path / "backup.zip"
    backup(settings, archive)
    target = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    engine, maker = database(target)
    Base.metadata.create_all(engine)
    restore(target, archive)
    with maker() as d:
        row = d.scalar(select(LibraryCollection))
        assert row.name == c["name"] and row.paper_ids == [p["id"]]
    engine.dispose()
