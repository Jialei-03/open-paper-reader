"""Persist per-request provider usage without prompt or credential storage."""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("model_usage"):
        return
    op.create_table(
        "model_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("shared", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        *[
            sa.Column(name, sa.BigInteger(), nullable=True)
            for name in (
                "input_tokens",
                "output_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
                "total_tokens",
            )
        ],
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_model_usage_owner_created", "model_usage", ["owner", "created_at"]
    )


def downgrade():
    op.drop_table("model_usage")
