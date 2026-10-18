"""The two full-translation methods (LaTeX source, PDF layout) coexist for one paper."""

import importlib

from sqlalchemy import select, text

from backend.models import Paper, TranslationJob
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_pdf_layout_jobs import setup_pdf


def both(env):
    app, a, _, settings = env
    paper, source, _ = setup_pdf(env)
    settings.pdf_layout_image = "fixture-layout"
    with app.state.maker() as d:
        d.get(Paper, paper["id"]).external_id = "arxiv:2504.19413v1"
        d.commit()
    return app, a, paper["id"], source


def jobs(app, paper_id):
    with app.state.maker() as d:
        return list(
            d.scalars(
                select(TranslationJob)
                .where(TranslationJob.paper_id == paper_id)
                .order_by(TranslationJob.created_at)
            )
        )


def test_each_method_has_its_own_active_job(env):
    app, a, pid, source = both(env)
    url = f"/papers/{pid}/translations"
    latex = write(a, url, {"engine": "latex"}).json()
    layout = write(a, url, {"engine": "pdf", "source_file_id": source}).json()
    assert latex["id"] != layout["id"]
    assert (latex["engine"], layout["engine"]) == ("latex", "pdf")
    # Asking again for the same method returns the running job of that method.
    assert write(a, url, {"engine": "latex"}).json()["id"] == latex["id"]
    body = {"engine": "pdf", "source_file_id": source}
    assert write(a, url, body).json()["id"] == layout["id"]
    listed = a.get("/api/v1" + url).json()
    assert {j["id"] for j in listed} == {latex["id"], layout["id"]}


def test_retry_of_a_failed_job_ignores_the_other_methods_newer_job(env):
    app, a, pid, source = both(env)
    url = f"/papers/{pid}/translations"
    latex = write(a, url, {"engine": "latex"}).json()
    with app.state.maker() as d:
        j = d.get(TranslationJob, latex["id"])
        j.status, j.error = "failed", "编译失败"
        d.commit()
    layout = write(a, url, {"engine": "pdf", "source_file_id": source}).json()
    with app.state.maker() as d:
        j = d.get(TranslationJob, layout["id"])
        j.status = "completed"
        d.commit()
    # The newer, finished layout job must not stop the LaTeX one from being retried.
    again = write(a, url, {"engine": "latex"}).json()
    assert again["id"] == latex["id"] and again["status"] == "queued"
    assert len(jobs(app, pid)) == 2


def test_index_migration_allows_one_active_job_per_method(env):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    app, a, pid, source = both(env)
    migration = importlib.import_module(
        "backend.migrations.versions.0026_translation_per_engine"
    )
    with app.state.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            migration.upgrade()
            migration.upgrade()
        sql = connection.execute(
            text("SELECT sql FROM sqlite_master WHERE name='uq_active_translation'")
        ).scalar_one()
        assert "engine" in sql
