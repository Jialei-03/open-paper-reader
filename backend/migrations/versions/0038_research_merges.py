"""Reviewed research result merges."""

from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade():
    if "research_merges" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "research_merges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("research_workspaces.id"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("research_projects.id"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="preview"),
        sa.Column("expected_main_commit", sa.String(64), nullable=False),
        sa.Column("expected_source_commit", sa.String(64), nullable=False),
        sa.Column("paths", sa.JSON(), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("commit_sha", sa.String(64), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
    )
    for column in ("owner", "workspace_id", "project_id"):
        op.create_index(f"ix_research_merges_{column}", "research_merges", [column])


def downgrade():
    op.drop_table("research_merges")
