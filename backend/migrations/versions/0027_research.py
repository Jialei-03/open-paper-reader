"""Research projects: the map, its change log, sprints and background jobs (new tables only)."""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def _id():
    return sa.Column("id", sa.String(36), primary_key=True)


def _project():
    return sa.Column(
        "project_id",
        sa.String(36),
        sa.ForeignKey("research_projects.id"),
        nullable=False,
    )


def upgrade():
    op.create_table(
        "research_projects",
        _id(),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("background", sa.Text, nullable=False),
        sa.Column("model_config_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("end_reason", sa.String(16), nullable=False),
        sa.Column("budget", sa.JSON, nullable=False),
        sa.Column("spent", sa.JSON, nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("agent_sessions.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_research_projects_owner", "research_projects", ["owner"])
    op.create_table(
        "research_nodes",
        _id(),
        _project(),
        sa.Column("parent_id", sa.String(36), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("kill_if", sa.Text, nullable=False),
        sa.Column("budget_tokens", sa.Integer, nullable=False),
        sa.Column("evidence_for", sa.JSON, nullable=False),
        sa.Column("evidence_against", sa.JSON, nullable=False),
        sa.Column("doubts", sa.JSON, nullable=False),
        sa.Column("spent_tokens", sa.Integer, nullable=False),
        sa.Column("spent_job_seconds", sa.Integer, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_research_nodes_project_id", "research_nodes", ["project_id"])
    op.create_table(
        "research_events",
        _id(),
        _project(),
        sa.Column("node_id", sa.String(36), nullable=True),
        sa.Column("sprint_id", sa.String(36), nullable=True),
        sa.Column("actor", sa.String(16), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("detail", sa.JSON, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_research_events_project_id", "research_events", ["project_id"])
    op.create_table(
        "research_sprints",
        _id(),
        _project(),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("focus_node_id", sa.String(36), nullable=True),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("next_focus", sa.Text, nullable=False),
        sa.Column("waiting_on", sa.JSON, nullable=False),
        sa.Column("tokens", sa.Integer, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_research_sprints_project_id", "research_sprints", ["project_id"]
    )
    op.create_table(
        "research_jobs",
        _id(),
        _project(),
        sa.Column("node_id", sa.String(36), nullable=False),
        sa.Column("sprint_id", sa.String(36), nullable=False),
        sa.Column("command", sa.Text, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("exit_code", sa.Integer, nullable=True),
        sa.Column("container", sa.String(64), nullable=False),
        sa.Column("timeout_seconds", sa.Integer, nullable=False),
        sa.Column("started_at", sa.String(40), nullable=False),
        sa.Column("finished_at", sa.String(40), nullable=False),
        sa.Column("log_lines", sa.Integer, nullable=False),
    )
    op.create_index("ix_research_jobs_project_id", "research_jobs", ["project_id"])


def downgrade():
    for table in (
        "research_jobs",
        "research_sprints",
        "research_events",
        "research_nodes",
        "research_projects",
    ):
        op.drop_table(table)
