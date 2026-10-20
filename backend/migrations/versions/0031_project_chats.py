"""Conversations inside a research project."""

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_sessions")
    }
    if "workspace_id" not in columns:
        op.add_column(
            "agent_sessions", sa.Column("workspace_id", sa.String(36), nullable=True)
        )
        op.create_index(
            "ix_agent_sessions_workspace_id", "agent_sessions", ["workspace_id"]
        )


def downgrade():
    op.drop_index("ix_agent_sessions_workspace_id", "agent_sessions")
    with op.batch_alter_table("agent_sessions") as batch:
        batch.drop_column("workspace_id")
