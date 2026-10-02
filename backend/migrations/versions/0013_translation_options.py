"""Capture user inference preferences for each translation job."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    if "model_options" not in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("translation_jobs")
    }:
        op.add_column(
            "translation_jobs",
            sa.Column("model_options", sa.JSON(), nullable=False, server_default="{}"),
        )


def downgrade():
    op.drop_column("translation_jobs", "model_options")
