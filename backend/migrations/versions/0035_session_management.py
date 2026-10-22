"""Explicit project thread identity and reversible conversation organization."""

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("agent_sessions")}
    additions = (
        sa.Column("kind", sa.String(24), nullable=False, server_default="chat"),
        sa.Column("source_session_id", sa.String(36), nullable=True),
        sa.Column("source_run_id", sa.String(36), nullable=True),
        sa.Column("pinned_at", sa.String(40), nullable=True),
        sa.Column("archived_at", sa.String(40), nullable=True),
    )
    for column in additions:
        if column.name not in columns:
            op.add_column("agent_sessions", column)

    metadata = sa.MetaData()
    sessions = sa.Table("agent_sessions", metadata, autoload_with=bind)
    workspaces = sa.Table("research_workspaces", metadata, autoload_with=bind)
    projects = sa.Table("research_projects", metadata, autoload_with=bind)
    runs = sa.Table("agent_runs", metadata, autoload_with=bind)
    artifacts = sa.Table("reading_artifacts", metadata, autoload_with=bind)
    bind.execute(
        sessions.update().where(sessions.c.paper_id.is_not(None)).values(kind="paper")
    )
    bind.execute(
        sessions.update()
        .where(sessions.c.workspace_id.is_not(None))
        .values(kind="project_chat")
    )
    for w in bind.execute(sa.select(workspaces)).mappings():
        if w["session_id"]:
            bind.execute(
                sessions.update()
                .where(
                    sessions.c.id == w["session_id"],
                    sessions.c.owner == w["owner"],
                )
                .values(
                    kind="project_lead",
                    pinned_at=sa.func.coalesce(sessions.c.pinned_at, w["created_at"]),
                )
            )
    bind.execute(
        sessions.update()
        .where(
            sa.exists(
                sa.select(projects.c.id).where(
                    projects.c.session_id == sessions.c.id,
                    projects.c.owner == sessions.c.owner,
                )
            )
        )
        .values(kind="research")
    )
    generated = sa.exists(
        sa.select(runs.c.id).where(
            runs.c.session_id == sessions.c.id,
            runs.c.runtime["reading_artifact_id"].as_string().is_not(None),
        )
    )
    artifact = sa.exists(
        sa.select(artifacts.c.id).where(artifacts.c.session_id == sessions.c.id)
    )
    bind.execute(
        sessions.update().where(sa.or_(generated, artifact)).values(kind="artifact")
    )


def downgrade():
    with op.batch_alter_table("agent_sessions") as batch:
        for name in (
            "archived_at",
            "pinned_at",
            "source_run_id",
            "source_session_id",
            "kind",
        ):
            batch.drop_column(name)
