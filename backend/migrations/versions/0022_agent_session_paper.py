"""Associate manually created conversations with their paper."""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_sessions")
    }
    if "paper_id" not in columns:
        op.add_column(
            "agent_sessions", sa.Column("paper_id", sa.String(36), nullable=True)
        )
    indexes = {
        i["name"] for i in sa.inspect(op.get_bind()).get_indexes("agent_sessions")
    }
    if "ix_agent_sessions_paper_id" not in indexes:
        op.create_index("ix_agent_sessions_paper_id", "agent_sessions", ["paper_id"])


def downgrade():
    op.drop_index("ix_agent_sessions_paper_id", table_name="agent_sessions")
    op.drop_column("agent_sessions", "paper_id")
