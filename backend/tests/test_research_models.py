from sqlalchemy import inspect, select

from backend.config import Settings, database
from backend.models import (
    AgentSession,
    Base,
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    User,
)

TABLES = {
    "research_projects",
    "research_nodes",
    "research_events",
    "research_sprints",
    "research_jobs",
}


def make_session(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "research.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    return engine, maker


def test_research_tables_roundtrip(tmp_path):
    engine, maker = make_session(tmp_path)
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        session = AgentSession(owner=user.id, title="研究")
        d.add(session)
        d.flush()
        project = ResearchProject(
            owner=user.id,
            question="Does L2 help?",
            model_config_id="m",
            session_id=session.id,
        )
        d.add(project)
        d.flush()
        root = ResearchNode(
            project_id=project.id, kind="question", title="Does L2 help?"
        )
        d.add(root)
        d.flush()
        hyp = ResearchNode(
            project_id=project.id,
            parent_id=root.id,
            kind="hypothesis",
            title="Moderate L2 is best",
            kill_if="gain < 0.5% on 3 seeds",
        )
        sprint = ResearchSprint(project_id=project.id, number=1, run_id="run")
        d.add_all([hyp, sprint])
        d.flush()
        d.add(
            ResearchEvent(
                project_id=project.id,
                node_id=hyp.id,
                sprint_id=sprint.id,
                actor="executor",
                action="add_node",
                detail={"reason": "start"},
            )
        )
        d.add(
            ResearchJob(
                project_id=project.id,
                node_id=hyp.id,
                sprint_id=sprint.id,
                command="echo hi",
                container="ora-job-x",
            )
        )
        d.commit()
        project_id = project.id

    with maker() as d:
        project = d.get(ResearchProject, project_id)
        assert project.status == "active"
        assert project.end_reason == ""
        assert project.spent == {"sprints": 0, "tokens": 0, "job_seconds": 0}
        assert project.budget["max_sprints"] == 30
        nodes = d.scalars(
            select(ResearchNode).where(ResearchNode.project_id == project_id)
        ).all()
        hyp = next(n for n in nodes if n.kind == "hypothesis")
        assert hyp.confidence == 0.5
        assert hyp.status == "open"
        assert hyp.evidence_for == [] and hyp.doubts == []
        job = d.scalars(select(ResearchJob)).one()
        assert job.status == "running" and job.timeout_seconds == 7200
        sprint = d.scalars(select(ResearchSprint)).one()
        assert sprint.status == "running" and sprint.role == "executor"
        assert sprint.waiting_on == []
    engine.dispose()


def test_migration_0027_upgrades(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    url = "sqlite:///" + str(tmp_path / "migration.db")
    monkeypatch.setenv("DATABASE_URL", url)
    settings = Settings(database_url=url, storage=str(tmp_path / "files"), testing=True)
    engine, _ = database(settings)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for table in TABLES:
            conn.execute(text(f"DROP TABLE {table}"))
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        conn.execute(text("INSERT INTO alembic_version VALUES ('0026')"))
    command.upgrade(Config("alembic.ini"), "head")
    assert TABLES <= set(inspect(engine).get_table_names())
    command.downgrade(Config("alembic.ini"), "0026")
    assert not TABLES & set(inspect(engine).get_table_names())
    engine.dispose()
