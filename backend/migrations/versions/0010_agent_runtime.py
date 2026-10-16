"""Durable Agent execution phase and elapsed time counters."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "runtime" not in columns:
        op.add_column(
            "agent_runs",
            sa.Column("runtime", sa.JSON(), nullable=False, server_default="{}"),
        )


def downgrade():
    op.drop_column("agent_runs", "runtime")
