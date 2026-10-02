from sqlalchemy import select

from backend.cli import backup, restore
from backend.config import Settings, database
from backend.models import Base, PaperPreparation, TranslationJob
from backend.preparation_worker import reconcile
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def test_restore_preserves_progress_without_replaying_automatic_tasks(env, tmp_path):
    app, client, _, settings = env
    document = paper(client)
    source = attach(client, document, "paper.pdf", pdf_bytes())
    reconcile(settings, app.state.maker)
    with app.state.maker() as d:
        preparation = d.scalar(select(PaperPreparation))
        preparation.status = "running"
        preparation.completed = 1
        preparation.total = 2
        d.add(
            TranslationJob(
                owner=preparation.owner,
                paper_id=document["id"],
                version_id=document["current_version"],
                arxiv_id="",
                source_file=source["id"],
                preparation_id=preparation.id,
            )
        )
        d.commit()
    archive = tmp_path / "backup.zip"
    backup(settings, archive)
    restored = Settings(
        database_url=f"sqlite:///{tmp_path}/restored.db",
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    engine, maker = database(restored)
    Base.metadata.create_all(engine)
    try:
        assert restore(restored, archive)["paper_preparations"] == 1
        with maker() as d:
            preparation = d.scalar(select(PaperPreparation))
            assert preparation.status == "paused"
            assert (preparation.completed, preparation.total) == (1, 2)
            assert d.scalar(select(TranslationJob)).status == "cancelled"
        reconcile(restored, maker)
        with maker() as d:
            assert d.scalar(select(PaperPreparation)).status == "paused"
    finally:
        engine.dispose()
