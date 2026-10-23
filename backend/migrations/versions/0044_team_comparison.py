"""Grouped workflow evaluations reference existing research projects."""

import sqlalchemy as sa
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade():
    if "research_evaluation_batches" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "research_evaluation_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("research_workspaces.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("workflows", sa.JSON(), nullable=False),
        sa.Column("cells", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_research_evaluation_batches_owner", "research_evaluation_batches", ["owner"]
    )
    op.create_index(
        "ix_research_evaluation_batches_workspace_id",
        "research_evaluation_batches",
        ["workspace_id"],
    )


def downgrade():
    op.drop_table("research_evaluation_batches")
