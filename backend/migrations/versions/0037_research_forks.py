"""Immutable round boundaries and independent research forks."""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("research_projects")}
    additions = (
        sa.Column("parent_id", sa.String(36), nullable=True),
        sa.Column("forked_from", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("fork_key", sa.String(100), nullable=True),
        sa.Column("inherited_history", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("merged", sa.JSON(), nullable=False, server_default="{}"),
    )
    for column in additions:
        if column.name not in columns:
            op.add_column("research_projects", column)
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("research_projects")}
    if "ix_research_projects_parent_id" not in indexes:
        op.create_index(
            "ix_research_projects_parent_id", "research_projects", ["parent_id"]
        )
    if "ix_research_projects_fork_key" not in indexes:
        op.create_index(
            "ix_research_projects_fork_key",
            "research_projects",
            ["fork_key"],
            unique=True,
        )
    sprint_columns = {
        c["name"] for c in sa.inspect(bind).get_columns("research_sprints")
    }
    if "snapshot" not in sprint_columns:
        op.add_column(
            "research_sprints",
            sa.Column("snapshot", sa.JSON(), nullable=False, server_default="{}"),
        )


def downgrade():
    with op.batch_alter_table("research_sprints") as batch:
        batch.drop_column("snapshot")
    op.drop_index("ix_research_projects_fork_key", table_name="research_projects")
    op.drop_index("ix_research_projects_parent_id", table_name="research_projects")
    with op.batch_alter_table("research_projects") as batch:
        for name in (
            "merged",
            "inherited_history",
            "fork_key",
            "forked_from",
            "parent_id",
        ):
            batch.drop_column(name)
