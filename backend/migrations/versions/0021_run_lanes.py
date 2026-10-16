"""Tell bulk page translation apart from conversation, and lift the one-run rule."""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

ACTIVE = "status IN ('queued', 'running')"


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "lane" not in columns:
        op.add_column(
            "agent_runs",
            sa.Column("lane", sa.String(16), nullable=False, server_default=""),
        )
    # A user may have several tasks at once for now; this index allowed one.
    op.execute("DROP INDEX IF EXISTS uq_active_agent_owner")


def downgrade():
    # One active run per owner again: keep the running one (or else one queued
    # run) and stop the others, which can be started again from the reader.
    op.execute(
        "UPDATE agent_runs SET status = 'cancelled' WHERE "
        + ACTIVE
        + " AND id NOT IN ("
        "SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY owner "
        "ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id) AS n "
        "FROM agent_runs WHERE " + ACTIVE + ") AS ranked WHERE n = 1)"
    )
    op.drop_column("agent_runs", "lane")
    op.create_index(
        "uq_active_agent_owner",
        "agent_runs",
        ["owner"],
        unique=True,
        sqlite_where=sa.text(ACTIVE),
        postgresql_where=sa.text(ACTIVE),
    )
