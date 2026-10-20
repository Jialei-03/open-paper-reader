"""Conversations kept as Pi sessions: their entries, and the model they go on with."""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "agent_session_entries" not in inspector.get_table_names():
        op.create_table(
            "agent_session_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "session_id",
                sa.String(36),
                sa.ForeignKey("agent_sessions.id"),
                nullable=False,
            ),
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("entry", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_agent_session_entries_session_id",
            "agent_session_entries",
            ["session_id"],
        )
    columns = {c["name"] for c in inspector.get_columns("agent_sessions")}
    if "model_config_id" not in columns:
        op.add_column(
            "agent_sessions",
            sa.Column("model_config_id", sa.String(36), nullable=True),
        )


def downgrade():
    with op.batch_alter_table("agent_sessions") as batch:
        batch.drop_column("model_config_id")
    op.drop_index("ix_agent_session_entries_session_id", "agent_session_entries")
    op.drop_table("agent_session_entries")
