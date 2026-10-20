"""Research records: stages, compute, environment, conclusion, datasets, run metrics."""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

PROJECT = [
    ("stage", sa.String(16), "experiments"),
    ("compute_id", sa.String(64), "local"),
    ("environment", sa.JSON(), "{}"),
    ("plan", sa.JSON(), "{}"),
    ("conclusion", sa.JSON(), "{}"),
]
JOB = [
    ("compute_id", sa.String(64), "local"),
    ("remote", sa.JSON(), "{}"),
    ("config", sa.JSON(), "{}"),
    ("metrics", sa.JSON(), "{}"),
    ("points", sa.Integer(), "0"),
    ("tracker_url", sa.String(500), ""),
]


def _add(table, columns):
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for name, kind, default in columns:
        if name not in have:
            op.add_column(
                table,
                sa.Column(name, kind, nullable=False, server_default=default),
            )


def upgrade():
    _add("research_projects", PROJECT)
    _add("research_jobs", JOB)
    # Jobs from before trackers existed are not mirrored after the fact.
    op.execute("UPDATE research_jobs SET tracker_url = 'none' WHERE tracker_url = ''")
    if "research_datasets" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "research_datasets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("research_projects.id"),
                nullable=False,
            ),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("source", sa.String(16), nullable=False),
            sa.Column("path", sa.String(300), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("files", sa.JSON(), nullable=False),
            sa.Column("bytes", sa.BigInteger(), nullable=False),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_research_datasets_project_id", "research_datasets", ["project_id"]
        )


def downgrade():
    op.drop_index("ix_research_datasets_project_id", "research_datasets")
    op.drop_table("research_datasets")
    with op.batch_alter_table("research_jobs") as batch:
        for name, _, _ in reversed(JOB):
            batch.drop_column(name)
    with op.batch_alter_table("research_projects") as batch:
        for name, _, _ in reversed(PROJECT):
            batch.drop_column(name)
