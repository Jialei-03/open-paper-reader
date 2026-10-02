"""Private chat attachments and explicit per-turn references."""

import sqlalchemy as sa
from alembic import op

from backend.models import AgentAttachment

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    AgentAttachment.__table__.create(op.get_bind(), checkfirst=True)
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "attachment_ids" not in columns:
        op.add_column(
            "agent_runs",
            sa.Column("attachment_ids", sa.JSON(), nullable=False, server_default="[]"),
        )


def downgrade():
    op.drop_column("agent_runs", "attachment_ids")
    AgentAttachment.__table__.drop(op.get_bind())
