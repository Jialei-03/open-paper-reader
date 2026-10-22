"""Scheduled research messages and their delivery history."""

from alembic import op
import sqlalchemy as sa

revision = "0041"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "research_schedules" not in tables:
        op.create_table(
            "research_schedules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("research_workspaces.id"),
                nullable=False,
            ),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("destination", sa.String(16), nullable=False),
            sa.Column("research_id", sa.String(36)),
            sa.Column("frequency", sa.String(16), nullable=False),
            sa.Column("local_time", sa.String(5), nullable=False),
            sa.Column("weekday", sa.Integer(), nullable=False),
            sa.Column("interval_hours", sa.Integer(), nullable=False),
            sa.Column("timezone", sa.String(100), nullable=False),
            sa.Column("paused", sa.Boolean(), nullable=False),
            sa.Column("next_run_at", sa.String(40), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
        )
        op.create_index("ix_research_schedules_owner", "research_schedules", ["owner"])
        op.create_index(
            "ix_research_schedules_due", "research_schedules", ["paused", "next_run_at"]
        )
    if "research_schedule_runs" not in tables:
        op.create_table(
            "research_schedule_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "schedule_id",
                sa.String(36),
                sa.ForeignKey("research_schedules.id"),
                nullable=False,
            ),
            sa.Column("trigger", sa.String(16), nullable=False),
            sa.Column("scheduled_for", sa.String(40), nullable=False),
            sa.Column("started_at", sa.String(40), nullable=False),
            sa.Column("finished_at", sa.String(40), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("research_id", sa.String(36)),
            sa.Column("error", sa.Text(), nullable=False),
        )
        op.create_index(
            "ix_research_schedule_runs_history",
            "research_schedule_runs",
            ["schedule_id", "started_at"],
        )


def downgrade():
    op.drop_table("research_schedule_runs")
    op.drop_table("research_schedules")
