import io
from pathlib import Path

import pytest
from pypdf import PdfWriter
from sqlalchemy import select

from backend.models import File, Paper, TranslationJob
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.translations import store_file


def setup_pdf(env, client=None):
    app, a, _, settings = env
    client = client or a
    paper = write(client, "/papers", {"title": "Uploaded PDF"}).json()
    document = PdfWriter()
    document.add_blank_page(612, 792)
    buffer = io.BytesIO()
    document.write(buffer)
    raw = buffer.getvalue()
    with app.state.maker() as d:
        p = d.get(Paper, paper["id"])
        f = store_file(d, settings, p, p.current_version, "source.pdf", raw)
        identifier = f.id
        d.commit()
    write(
        a,
        "/translation-settings",
        {
            "base_url": "https://api.openai.com/v1",
            "model": "fixture",
            "api_key": "fake",
        },
        "PUT",
    )
    return paper, identifier, raw


def test_pdf_job_requires_enabled_engine_owned_current_pdf(env):
    _, a, b, settings = env
    paper, source, _ = setup_pdf(env)
    endpoint = f"/papers/{paper['id']}/translations"
    body = {"engine": "pdf", "source_file_id": source}
    assert a.get("/api/v1/translation-settings").json()["pdf_layout_enabled"] is False
    assert write(a, endpoint, body).status_code == 409
    settings.pdf_layout_image = "fixture-layout"
    assert a.get("/api/v1/translation-settings").json()["pdf_layout_enabled"] is True
    _, foreign, _ = setup_pdf(env, b)
    assert write(a, endpoint, {**body, "source_file_id": foreign}).status_code == 404
    _, wrong_paper, _ = setup_pdf(env)
    assert (
        write(a, endpoint, {**body, "source_file_id": wrong_paper}).status_code == 422
    )
    response = write(a, endpoint, body)
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["engine"] == "pdf" and job["source_file"] == source
    assert job["arxiv_id"] == ""
    assert write(a, endpoint, body).json()["id"] == job["id"]


@pytest.mark.parametrize("outcome", ["success", "cancel", "failure", "changed_source"])
def test_pdf_worker_only_publishes_verified_active_job(env, monkeypatch, outcome):
    from backend import pdf_layout_jobs, translation_worker

    app, a, _, settings = env
    settings.pdf_layout_image = "fixture-layout"
    paper, source, raw = setup_pdf(env)
    job = write(
        a,
        f"/papers/{paper['id']}/translations",
        {
            "engine": "pdf",
            "source_file_id": source,
        },
    ).json()
    with app.state.maker() as d:
        d.get(TranslationJob, job["id"]).status = "running"
        d.commit()
    if outcome == "changed_source":
        (Path(settings.storage) / source).write_bytes(b"%PDF-corrupted")

    calls = []

    def translate(runtime, original, output, config, progress, cancelled, **kwargs):
        calls.append(True)
        assert kwargs["container_image"] == "fixture-layout"
        assert original.read_bytes() == raw
        assert not cancelled()
        progress({"stage": "Translate Paragraphs", "overall_progress": 60})
        if outcome == "failure":
            raise ValueError("版面译文不完整：1/2 个段落未返回译文")
        if outcome == "cancel":
            with app.state.maker() as d:
                d.get(TranslationJob, job["id"]).status = "cancelled"
                d.commit()
            assert cancelled()
        output.mkdir(parents=True)
        target = output / "result.pdf"
        target.write_bytes(raw)
        return target, {"translated_paragraphs": 2}

    monkeypatch.setattr(pdf_layout_jobs, "translate_pdf", translate)
    monkeypatch.setattr(
        translation_worker,
        "download",
        lambda *_: pytest.fail("PDF job must not fetch arXiv"),
    )
    translation_worker.process(settings, app.state.maker, job["id"])
    with app.state.maker() as d:
        current = d.get(TranslationJob, job["id"])
        files = list(d.scalars(select(File).where(File.paper_id == paper["id"])))
        if outcome == "success":
            assert current.status == "completed" and current.completed == 100
            assert current.translated_file and len(files) == 2
        else:
            assert current.status == ("cancelled" if outcome == "cancel" else "failed")
            assert not current.translated_file and len(files) == 1
        if outcome == "changed_source":
            assert not calls and "内容已变化" in current.error
    assert not (
        Path(settings.storage).parent / "translation-work" / job["id"] / "layout"
    ).exists()


def test_layout_migration_preserves_existing_latex_job(env):
    import importlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    app, a, _, _ = env
    setup_pdf(env)
    paper = write(
        a, "/papers", {"title": "Existing arXiv", "external_id": "arxiv:2504.19413v1"}
    ).json()
    job = write(a, f"/papers/{paper['id']}/translations", {}).json()
    migration = importlib.import_module(
        "backend.migrations.versions.0020_pdf_layout_translation"
    )
    with app.state.engine.begin() as connection:
        # The active-job index names the column; the old shape had none.
        connection.execute(text("DROP INDEX uq_active_translation"))
        connection.execute(text("ALTER TABLE translation_jobs DROP COLUMN engine"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
        restored = connection.execute(
            text("SELECT engine FROM translation_jobs WHERE id=:id"), {"id": job["id"]}
        ).scalar_one()
        assert restored == "latex"
