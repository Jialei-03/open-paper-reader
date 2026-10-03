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


def test_original_pdfs_keep_bytes_and_duplicate_titles_have_unique_names(env):
    _, a, _, _ = env
    first, second, _, translated = setup_bundle(env)
    query = {"ids": first["id"] + "," + second["id"], "mode": "original"}
    plan = a.get("/api/v1/paper-downloads/plan", params=query).json()
    assert plan["papers"] == plan["files"] == 2 and not plan["missing"]
    assert len({file["name"] for file in plan["downloads"]}) == 2
    for file in plan["downloads"]:
        assert file["file_id"] != translated["id"] and file["name"].endswith("原文.pdf")
        response = a.get(file["url"])
        assert response.status_code == 200 and response.content == pdf_bytes()
        assert response.headers["content-type"] == "application/pdf"
    assert a.get("/api/v1/paper-downloads/archive", params=query).status_code == 404


def test_translated_pdf_plan_keeps_available_pdf_and_reports_missing(env):
    _, a, _, _ = env
    first, second, _, translated = setup_bundle(env)
    plan = a.get("/api/v1/paper-downloads/plan", params={"ids": first["id"] + "," + second["id"], "mode": "translated"}).json()
    assert plan["papers"] == plan["files"] == 1
    assert plan["missing"][0]["paper_id"] == second["id"]
    assert plan["downloads"][0]["file_id"] == translated["id"]
    assert a.get(plan["downloads"][0]["url"]).content == pdf_bytes(False)
    empty = a.get("/api/v1/paper-downloads/plan", params={"ids": second["id"], "mode": "translated"}).json()
    assert not empty["downloads"] and empty["missing"]


def test_batch_download_rejects_mixed_owners_and_agent_identity(env):
    app, a, b, _ = env
    first = paper(a)
    second = paper(b)
    query = {"ids": first["id"] + "," + second["id"]}
    for endpoint in ("plan",):
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
    plan = a.get("/api/v1/paper-downloads/plan", params={"ids": first["id"]}).json()
    assert not plan["downloads"] and plan["missing"]
