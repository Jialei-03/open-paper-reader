"""Member library, team overrides and per-wake capabilities/budgets."""

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "member_library" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "member_library",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner", sa.String(100), nullable=False, index=True),
            sa.Column("config", sa.JSON(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        )
    for column in (
        sa.Column("library_id", sa.String(36), nullable=True),
        sa.Column("overrides", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("role_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("avatar_color", sa.String(24), nullable=False, server_default="blue"),
        sa.Column("permissions", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("subscriptions", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("wake_turns", sa.Integer(), nullable=False, server_default="32"),
        sa.Column("wake_tokens", sa.Integer(), nullable=False, server_default="200000"),
    ):
        if column.name not in {
            c["name"] for c in sa.inspect(bind).get_columns("team_members")
        }:
            op.add_column("team_members", column)
    if not any(
        fk["constrained_columns"] == ["library_id"]
        for fk in sa.inspect(bind).get_foreign_keys("team_members")
    ):
        with op.batch_alter_table("team_members") as batch:
            batch.create_foreign_key(
                "fk_team_members_library", "member_library", ["library_id"], ["id"]
            )


def downgrade():
    with op.batch_alter_table("team_members") as batch:
        batch.drop_constraint("fk_team_members_library", type_="foreignkey")
        for name in (
            "library_id",
            "overrides",
            "role_description",
            "avatar_color",
            "permissions",
            "subscriptions",
            "enabled",
            "deleted",
            "wake_turns",
            "wake_tokens",
        ):
            batch.drop_column(name)
    op.drop_table("member_library")
