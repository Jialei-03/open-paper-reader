from sqlalchemy import func, select

from backend.models import AgentSession, Paper, PaperPreparation, TranslationJob
from backend.preparation_worker import reconcile
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def add_paper(client, title):
    document = paper(client, title=title)
    source = attach(client, document, "source.pdf", pdf_bytes())
    return document, source


def test_overview_live_layout_owner_scope_and_read_only(env):
    app, alice, bob, settings = env
    document, source = add_paper(alice, "Current paper")
    add_paper(bob, "Private paper")
    reconcile(settings, app.state.maker)
    with app.state.maker() as d:
        row = d.scalar(select(PaperPreparation).where(PaperPreparation.paper_id == document["id"]))
        row.status = "waiting"
        row.guide_status = row.translation_status = "completed"
        row.completed = row.total = 12
        job = TranslationJob(owner=row.owner, paper_id=row.paper_id, version_id=row.version_id,
                             source_file=source["id"], arxiv_id="", preparation_id=row.id,
                             status="running", stage="等待可用内存进行排版", completed=42, total=100,
                             base_url="https://private-provider.example/v1", model_options={"private": "configuration"})
        d.add(job)
        d.commit()
        job_id = job.id
    result = alice.get("/api/v1/preparations").json()
    assert result["summary"]["total"] == result["summary"]["active"] == 1
    row = result["items"][0]
    assert row["title"] == "Current paper"
    assert row["status"] == "running"  # Body complete is not PDF complete.
    assert row["layout_progress"]["completed"] == 42
    assert row["stage"] == "等待可用内存进行排版"
    assert "private-provider" not in str(result) and "model_options" not in str(result)
    assert bob.get("/api/v1/preparations").json()["items"][0]["title"] == "Private paper"
    single = alice.get(f"/api/v1/papers/{document['id']}/preparation").json()
    assert single["layout_progress"] == row["layout_progress"]
    with app.state.maker() as d:
        assert d.scalar(select(func.count()).select_from(AgentSession)) == 0
        assert d.scalar(select(func.count()).select_from(PaperPreparation)) == 2
        assert d.get(TranslationJob, job_id).status == "running"
        d.get(TranslationJob, job_id).status = "completed"
        d.commit()
    assert alice.get("/api/v1/preparations?status=completed").json()["total"] == 1
    assert alice.get("/api/v1/preparations?status=active").json()["total"] == 0


def test_overview_pagination_excludes_archived_and_old_version_tasks(env):
    app, alice, _, settings = env
    documents = [add_paper(alice, title)[0] for title in ["Failed", "Ready", "Archived", "Old version"]]
    reconcile(settings, app.state.maker)
    with app.state.maker() as d:
        rows = {row.paper_id: row for row in d.scalars(select(PaperPreparation))}
        rows[documents[0]["id"]].status = "failed"
        rows[documents[1]["id"]].status = "completed"
        d.get(Paper, documents[2]["id"]).archived = True
        rows[documents[3]["id"]].version_id = "previous-version"
        d.commit()
    result = alice.get("/api/v1/preparations?limit=1").json()
    assert result["total"] == result["summary"]["total"] == 2
    assert result["summary"]["failed"] == result["summary"]["completed"] == 1
    assert result["items"][0]["title"] == "Failed"
    assert alice.get("/api/v1/preparations?limit=1&offset=1").json()["items"][0]["title"] == "Ready"
    assert alice.get("/api/v1/preparations?status=failed").json()["total"] == 1
    assert alice.get("/api/v1/preparations?offset=-1").status_code == 422
    assert alice.get("/api/v1/preparations?limit=101").status_code == 422


def test_overview_pause_is_not_overridden_by_finished_layout(env):
    app, alice, _, settings = env
    document, source = add_paper(alice, "Paused")
    reconcile(settings, app.state.maker)
    with app.state.maker() as d:
        row = d.scalar(select(PaperPreparation))
        row.status = "paused"
        row.guide_status = row.translation_status = "completed"
        d.add(TranslationJob(owner=row.owner, paper_id=row.paper_id, version_id=row.version_id,
                             source_file=source["id"], arxiv_id="", status="completed"))
        d.commit()
    assert alice.get("/api/v1/preparations?status=paused").json()["total"] == 1
