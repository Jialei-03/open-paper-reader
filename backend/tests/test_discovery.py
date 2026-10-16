import httpx
import pytest
from backend.tests.test_acceptance import env, write, paper


@pytest.fixture(autouse=True)
def arxiv_downloads(monkeypatch):
    from backend.tests.test_agents import pdf_bytes
    from backend.arxiv_import import identifier

    def meta(url):
        value = identifier(url)
        if not value.endswith("v1"):
            value += "v1"
        return {
            "arxiv_id": value,
            "title": "New agent memory study",
            "authors": "B",
            "abstract": "agent memory retrieval",
        }

    monkeypatch.setattr("backend.translations.metadata", meta)
    monkeypatch.setattr("backend.translations.download", lambda path: pdf_bytes())


def fixture_rows(terms):
    return [
        {
            "external_id": "arxiv:2504.19413",
            "title": "Mem0",
            "abstract": "agent memory",
            "authors": "A",
            "published": "2025-04-28",
            "url": "https://arxiv.org/abs/2504.19413",
        },
        {
            "external_id": "arxiv:2601.00001",
            "title": "New agent memory study",
            "abstract": "agent memory retrieval",
            "authors": "B",
            "published": "2026-01-01",
            "url": "https://arxiv.org/abs/2601.00001",
        },
    ]


def test_external_discovery_profile_feedback_and_isolation(env):
    app, a, b, _ = env
    app.state.discovery_fetcher = fixture_rows
    existing = write(
        a,
        "/papers",
        {
            "title": "Mem0",
            "external_id": "https://arxiv.org/abs/2504.19413v1",
            "tags": ["agent memory"],
        },
    ).json()
    write(a, "/papers/" + existing["id"], {"archived": True}, "PATCH", 1)
    profile = a.get("/api/v1/research-profile").json()
    assert profile["body"] == ""
    body = {
        "body": "Private research goal",
        "interests": ["agent memory"],
        "excluded": [],
        "tracking": True,
    }
    assert write(a, "/research-profile", body, "PUT", 88).status_code == 409
    profile = write(a, "/research-profile", body, "PUT", profile["revision"]).json()
    assert "Private research goal" in profile["document"]
    assert b.get("/api/v1/research-profile").json()["body"] == ""
    rows = write(a, "/discovery/refresh", {}).json()["items"]
    assert len(rows) == 1 and rows[0]["title"] != "Mem0"
    candidate = rows[0]["id"]
    assert (
        write(b, f"/discovery/{candidate}/feedback", {"action": "import"}).status_code
        == 404
    )
    assert (
        write(
            a, f"/discovery/{candidate}/feedback", {"action": "not_interested"}
        ).status_code
        == 200
    )
    assert a.get("/api/v1/discovery").json()["items"] == []
    assert (
        a.get("/api/v1/research-profile").json()["feedback"][0]["action"]
        == "not_interested"
    )
    write(a, f"/discovery/{candidate}/feedback", {"action": "reset"})
    result = write(a, f"/discovery/{candidate}/feedback", {"action": "import"}).json()
    again = write(a, f"/discovery/{candidate}/feedback", {"action": "import"}).json()
    assert again["paper_id"] == result["paper_id"]
    assert a.get("/api/v1/discovery").json()["items"] == []
    imported = a.get("/api/v1/papers/" + result["paper_id"]).json()
    assert imported["reading_status"] == "unread"
    updated = a.get("/api/v1/research-profile").json()
    assert updated["signals"][0]["reason"] == "入库线索（待确认）"
    assert updated["body"] == "Private research goal"
    body["tracking"] = False
    stopped = write(a, "/research-profile", body, "PUT", updated["revision"]).json()
    assert stopped["signals"] == []


def test_discovery_failure_preserves_cache_and_exclusions(env):
    app, a, _, _ = env
    paper(a, tags=["agent memory"])
    app.state.discovery_fetcher = fixture_rows
    write(a, "/discovery/refresh", {})
    assert len(a.get("/api/v1/discovery").json()["items"]) == 2

    def unavailable(terms):
        raise httpx.ConnectError("unavailable")

    app.state.discovery_fetcher = unavailable
    assert write(a, "/discovery/refresh", {}).status_code == 502
    assert len(a.get("/api/v1/discovery").json()["items"]) == 2
    p = a.get("/api/v1/research-profile").json()
    write(
        a,
        "/research-profile",
        {
            "body": "",
            "interests": ["agent memory"],
            "excluded": ["retrieval"],
            "tracking": True,
        },
        "PUT",
        p["revision"],
    )
    rows = a.get("/api/v1/discovery").json()["items"]
    assert len(rows) == 1 and rows[0]["title"] == "Mem0"


def test_profile_and_discovery_survive_backup(env, tmp_path):
    from backend.cli import backup, restore
    from backend.config import Settings, database
    from backend.models import Base, ResearchProfile, DiscoveryCandidate
    from sqlalchemy import select

    app, a, _, settings = env
    p = a.get("/api/v1/research-profile").json()
    write(
        a,
        "/research-profile",
        {
            "body": "Persistent preference",
            "interests": ["agent memory"],
            "excluded": [],
            "tracking": True,
        },
        "PUT",
        p["revision"],
    )
    app.state.discovery_fetcher = fixture_rows
    rows = write(a, "/discovery/refresh", {}).json()["items"]
    write(a, "/discovery/" + rows[0]["id"] + "/feedback", {"action": "not_interested"})
    path = tmp_path / "profile-backup.zip"
    backup(settings, path)
    target = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    engine, maker = database(target)
    Base.metadata.create_all(engine)
    restore(target, path)
    with maker() as d:
        assert d.scalar(select(ResearchProfile)).body == "Persistent preference"
        assert any(
            c.action == "not_interested" for c in d.scalars(select(DiscoveryCandidate))
        )
    engine.dispose()


def test_direction_merge_agent_permissions_and_revision(env):
    app, a, b, _ = env
    p = paper(a, tags=["Memory", "agent memory"])
    other = paper(b, tags=["Memory"])
    note = write(
        a,
        "/items",
        {
            "kind": "note",
            "paper_id": p["id"],
            "title": "Keep my note",
            "body": "Unchanged",
            "tags": ["Memory"],
        },
    ).json()
    before = a.get("/api/v1/research-directions").json()
    token = write(
        a,
        "/tokens",
        {"name": "Direction editor", "scopes": ["read", "write"], "days": 1},
    ).json()["token"]
    body = {"sources": ["Memory", "agent memory"], "target": "Agent Memory"}
    response = a.post(
        "/api/v1/research-directions",
        json=body,
        headers={
            "Authorization": "Bearer " + token,
            "If-Match": before["revision"],
            "Idempotency-Key": "merge-directions",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"] == [{"name": "Agent Memory", "papers": 1}]
    assert a.get("/api/v1/items/" + note["id"]).json()["body"] == "Unchanged"
    assert a.get("/api/v1/items/" + note["id"]).json()["tags"] == ["Agent Memory"]
    assert b.get("/api/v1/papers/" + other["id"]).json()["tags"] == ["Memory"]
    assert a.get("/api/v1/papers/" + p["id"]).json()["revision"] == 2
    assert (
        a.post(
            "/api/v1/research-directions",
            json=body,
            headers={
                "If-Match": before["revision"],
                "Idempotency-Key": "stale-directions",
            },
        ).status_code
        == 409
    )
    current = a.get("/api/v1/research-directions").json()
    assert (
        a.post(
            "/api/v1/research-directions",
            json={"sources": [], "target": "Planning"},
            headers={
                "If-Match": current["revision"],
                "Idempotency-Key": "create-direction",
            },
        ).status_code
        == 200
    )
    profile = a.get("/api/v1/research-profile").json()
    assert "Planning" in profile["interests"]
    assert (
        write(
            a,
            "/papers/" + p["id"] + "/events",
            {"kind": "reading", "reading_status": "queued", "body": "invalid"},
            revision=2,
        ).status_code
        == 422
    )


def test_discovery_import_downloads_pdf_and_failed_download_remains_retryable(
    env, monkeypatch
):
    app, a, _, _ = env
    paper(a, tags=["agent memory"])
    app.state.discovery_fetcher = fixture_rows
    candidate = write(a, "/discovery/refresh", {}).json()["items"][0]
    from backend.tests.test_agents import pdf_bytes

    monkeypatch.setattr("backend.translations.download", lambda path: b"not a PDF")
    response = write(a, f"/discovery/{candidate['id']}/feedback", {"action": "import"})
    assert response.status_code == 502
    assert any(
        row["id"] == candidate["id"]
        for row in a.get("/api/v1/discovery").json()["items"]
    )
    assert len(a.get("/api/v1/papers").json()) == 1
    monkeypatch.setattr("backend.translations.download", lambda path: pdf_bytes())
    result = write(
        a, f"/discovery/{candidate['id']}/feedback", {"action": "import"}
    ).json()
    files = a.get(f"/api/v1/papers/{result['paper_id']}/files").json()
    assert len(files) == 1 and files[0]["mime"] == "application/pdf"
    assert a.get(f"/api/v1/files/{files[0]['id']}/content").content.startswith(b"%PDF-")


def test_discovery_repairs_metadata_only_paper_without_duplicate_note(env):
    app, a, _, _ = env
    app.state.discovery_fetcher = fixture_rows
    profile = a.get("/api/v1/research-profile").json()
    write(
        a,
        "/research-profile",
        {"body": "", "interests": ["agent memory"], "excluded": [], "tracking": True},
        "PUT",
        profile["revision"],
    )
    candidate = write(a, "/discovery/refresh", {}).json()["items"][0]
    existing = write(
        a, "/papers", {"title": candidate["title"], "external_id": candidate["url"]}
    ).json()
    notes_before = a.get("/api/v1/items").json()
    result = write(
        a, f"/discovery/{candidate['id']}/feedback", {"action": "import"}
    ).json()
    assert result["paper_id"] == existing["id"]
    assert len(a.get("/api/v1/papers").json()) == 1
    assert a.get("/api/v1/items").json() == notes_before
    assert len(a.get(f"/api/v1/papers/{existing['id']}/files").json()) == 1
    again = write(a, "/import/arxiv", {"url": candidate["url"]})
    assert again.status_code == 200 and again.json()["id"] == existing["id"]
    assert len(a.get(f"/api/v1/papers/{existing['id']}/files").json()) == 1


def test_import_cleans_blob_when_snapshot_conflicts_before_commit(env):
    from pathlib import Path
    from sqlalchemy.orm.exc import StaleDataError
    from backend.models import Paper
    from backend.translations import import_arxiv_paper

    app, a, _, settings = env
    existing = write(
        a, "/papers", {"title": "Existing", "external_id": "arxiv:2601.00001"}
    ).json()
    before = set(Path(settings.storage).iterdir())
    with app.state.maker() as d:
        current = d.get(Paper, existing["id"])
        owner = current.owner

        def conflict(*args):
            raise StaleDataError("concurrent revision changed")

        with pytest.raises(StaleDataError):
            import_arxiv_paper(
                d, settings, {"id": owner, "actor": "test"}, "2601.00001", conflict
            )
        d.rollback()
    assert set(Path(settings.storage).iterdir()) == before
    assert a.get(f"/api/v1/papers/{existing['id']}/files").json() == []
    assert (
        a.get(f"/api/v1/papers/{existing['id']}").json()["revision"]
        == existing["revision"]
    )


def test_arxiv_import_progress_is_authenticated_owner_scoped_and_idempotent(env):
    import uuid

    _, alice, bob, _ = env
    token = str(uuid.uuid4())
    response = alice.post(
        "/api/v1/import/arxiv",
        json={"url": "2504.19413v1"},
        headers={"X-Import-ID": token, "Idempotency-Key": token},
    )
    assert response.status_code == 200
    path = "/api/v1/import/arxiv/progress/" + token
    assert alice.get(path).json()["stage"] == "done"
    assert bob.get(path).json()["stage"] == "waiting"
    repeated = alice.post(
        "/api/v1/import/arxiv",
        json={"url": "2504.19413v1"},
        headers={"X-Import-ID": token, "Idempotency-Key": token},
    )
    assert repeated.json()["id"] == response.json()["id"]
    assert len(alice.get("/api/v1/papers").json()) == 1
