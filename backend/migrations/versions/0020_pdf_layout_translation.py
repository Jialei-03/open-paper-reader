"""Keep PDF layout tasks separate from arXiv source translation."""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    if "engine" not in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("translation_jobs")
    }:
        op.add_column(
            "translation_jobs",
            sa.Column("engine", sa.String(20), nullable=False, server_default="latex"),
        )


def downgrade():
    op.drop_column("translation_jobs", "engine")
