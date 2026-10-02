"""Keep outstanding model allowances separate from provider-reported usage."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    if "reserved_tokens" not in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("model_usage")
    }:
        op.add_column(
            "model_usage",
            sa.Column(
                "reserved_tokens", sa.BigInteger(), nullable=False, server_default="0"
            ),
        )


def downgrade():
    op.drop_column("model_usage", "reserved_tokens")
