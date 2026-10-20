"""Research projects (workspaces) holding researches, and their board's own cards."""

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "research_workspaces" not in tables:
        op.create_table(
            "research_workspaces",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
            sa.Column("kind", sa.String(16), nullable=False, server_default="research"),
            sa.Column("compute_id", sa.String(64), nullable=False, server_default=""),
            sa.Column(
                "model_config_id", sa.String(36), nullable=False, server_default=""
            ),
            sa.Column(
                "archived", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_research_workspaces_owner", "research_workspaces", ["owner"]
        )
    if "research_cards" not in tables:
        op.create_table(
            "research_cards",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("research_workspaces.id"),
                nullable=False,
            ),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(16), nullable=False, server_default="triage"),
            sa.Column("project_id", sa.String(36), nullable=True),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "created_by", sa.String(16), nullable=False, server_default="human"
            ),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_research_cards_workspace_id", "research_cards", ["workspace_id"]
        )
    columns = {c["name"] for c in sa.inspect(bind).get_columns("research_projects")}
    if "workspace_id" not in columns:
        op.add_column(
            "research_projects", sa.Column("workspace_id", sa.String(36), nullable=True)
        )
        op.create_index(
            "ix_research_projects_workspace_id", "research_projects", ["workspace_id"]
        )


def downgrade():
    op.drop_index("ix_research_projects_workspace_id", "research_projects")
    with op.batch_alter_table("research_projects") as batch:
        batch.drop_column("workspace_id")
    op.drop_index("ix_research_cards_workspace_id", "research_cards")
    op.drop_table("research_cards")
    op.drop_index("ix_research_workspaces_owner", "research_workspaces")
    op.drop_table("research_workspaces")
