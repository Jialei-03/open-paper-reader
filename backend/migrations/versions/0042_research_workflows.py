"""Research workflow definitions and immutable conversation snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "research_workflows" not in inspector.get_table_names():
        op.create_table(
            "research_workflows",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("definition", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
        )
        op.create_index("ix_research_workflows_owner", "research_workflows", ["owner"])
    for column in ("workflow", "workflow_state"):
        if column not in {
            c["name"] for c in inspector.get_columns("research_projects")
        }:
            op.add_column(
                "research_projects",
                sa.Column(column, sa.JSON(), nullable=False, server_default="{}"),
            )
    if "workflow_id" not in {
        c["name"] for c in inspector.get_columns("research_schedules")
    }:
        op.add_column(
            "research_schedules",
            sa.Column(
                "workflow_id", sa.String(64), nullable=False, server_default="research"
            ),
        )


def downgrade():
    op.drop_column("research_schedules", "workflow_id")
    op.drop_column("research_projects", "workflow_state")
    op.drop_column("research_projects", "workflow")
    op.drop_index("ix_research_workflows_owner", table_name="research_workflows")
    op.drop_table("research_workflows")
