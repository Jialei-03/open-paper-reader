"""Each round's checkpoint in the project's repository (research_repo)."""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("research_sprints")}
    if "commit_sha" not in columns:
        op.add_column(
            "research_sprints",
            sa.Column("commit_sha", sa.String(64), nullable=False, server_default=""),
        )


def downgrade():
    op.drop_column("research_sprints", "commit_sha")
