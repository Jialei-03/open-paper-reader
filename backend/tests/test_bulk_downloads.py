import io
import zipfile
from pathlib import Path

import pytest
from backend.models import Paper, TranslationJob
from backend.tests.test_acceptance import attach, bearer, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def setup_bundle(env):
    app, a, _, _ = env
    first = paper(a, "Same / paper")
    second = paper(a, "Same / paper")
    original = attach(a, first, "source.pdf", pdf_bytes())
    attach(a, second, "source.pdf", pdf_bytes())
    translated = attach(a, first, "translated.pdf", pdf_bytes(False))
    with app.state.maker() as d:
        d.add(TranslationJob(owner=d.get(Paper, first["id"]).owner, paper_id=first["id"], version_id=first["current_version"], arxiv_id="", status="completed", source_file=original["id"], translated_file=translated["id"]))
        d.commit()
    return first, second, original, translated


def test_original_zip_preserves_bytes_excludes_translations_and_handles_duplicate_titles(env):
    _, a, _, _ = env
    first, second, _, _ = setup_bundle(env)
    query = {"ids": first["id"] + "," + second["id"], "mode": "original"}
    plan = a.get("/api/v1/paper-downloads/plan", params=query)
    assert plan.status_code == 200
    assert plan.json()["papers"] == 2 and plan.json()["files"] == 2
    assert plan.json()["missing"] == []
    # Completed streams free their export slot for subsequent downloads.
    for _ in range(3):
        response = a.get("/api/v1/paper-downloads/archive", params=query)
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert response.headers["cache-control"] == "private, no-store"
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            assert len(z.namelist()) == 2
            assert len(set(z.namelist())) == 2
            assert all(not name.startswith("/") and "../" not in name for name in z.namelist())
            assert all(z.read(name) == pdf_bytes() for name in z.namelist())


def test_translated_zip_reports_missing_and_keeps_available_translation(env):
    _, a, _, _ = env
    first, second, _, _ = setup_bundle(env)
    query = {"ids": first["id"] + "," + second["id"], "mode": "translated"}
    plan = a.get("/api/v1/paper-downloads/plan", params=query).json()
    assert plan["papers"] == 1 and plan["files"] == 1
    assert plan["missing"][0]["paper_id"] == second["id"]
    response = a.get("/api/v1/paper-downloads/archive", params=query)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        names = [name for name in z.namelist() if name.endswith(".pdf")]
        assert len(names) == 1 and z.read(names[0]) == pdf_bytes(False)
        assert "当前版本尚无已完成" in z.read("未下载论文.txt").decode()
    assert a.get("/api/v1/paper-downloads/archive", params={"ids": second["id"], "mode": "translated"}).status_code == 409


def test_batch_download_rejects_mixed_owners_and_agent_identity(env):
    app, a, b, _ = env
    first = paper(a)
    second = paper(b)
    query = {"ids": first["id"] + "," + second["id"]}
    for endpoint in ("plan", "archive"):
        assert a.get("/api/v1/paper-downloads/" + endpoint, params=query).status_code == 404
        assert b.get("/api/v1/paper-downloads/" + endpoint, params=query).status_code == 404
    agent, _ = bearer(app, a)
    assert agent.get("/api/v1/paper-downloads/plan", params={"ids": first["id"]}).status_code == 403
    agent.close()


@pytest.mark.parametrize("damage", ["same-size", "symlink"])
def test_bundle_rejects_tampered_or_unsafe_source(env, damage):
    _, a, _, settings = env
    first = paper(a)
    f = attach(a, first, "source.pdf", pdf_bytes())
    path = Path(settings.storage) / f["id"]
    if damage == "same-size":
        data = path.read_bytes()
        path.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
    else:
        other = path.with_name("other")
        other.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(other)
    assert a.get("/api/v1/paper-downloads/archive", params={"ids": first["id"]}).status_code == 409
