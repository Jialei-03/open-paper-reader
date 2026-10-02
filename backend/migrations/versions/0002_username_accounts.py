"""Separate username login from verified recovery email."""

import re
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("username", sa.String(32), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "email_verified", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    connection = op.get_bind()
    rows = (
        connection.execute(
            sa.text("SELECT id, email FROM users ORDER BY created_at, id")
        )
        .mappings()
        .all()
    )
    used = set()
    # Preserve literal local usernames such as admin before deriving email prefixes.
    rows.sort(key=lambda row: "@" in row["email"])
    for row in rows:
        base = re.sub(r"[^a-z0-9_]", "_", row["email"].split("@")[0].lower())[:24]
        if not re.fullmatch(r"[a-z][a-z0-9_]{2,31}", base):
            base = "user_" + row["id"].replace("-", "")[:12]
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        used.add(candidate)
        connection.execute(
            sa.text("UPDATE users SET username=:username WHERE id=:id"),
            {"username": candidate, "id": row["id"]},
        )
    with op.batch_alter_table("users") as batch:
        batch.alter_column("username", existing_type=sa.String(32), nullable=False)
        batch.alter_column("email", existing_type=sa.String(254), nullable=True)
        batch.create_unique_constraint("uq_users_username", ["username"])
    connection.execute(
        sa.text("UPDATE users SET email=NULL WHERE email NOT LIKE '%@%'")
    )
    # Old email-bound invitations cannot be reused with different identity semantics.
    connection.execute(sa.text("DELETE FROM invitations"))
    with op.batch_alter_table("invitations") as batch:
        batch.alter_column(
            "email",
            new_column_name="username",
            existing_type=sa.String(254),
            type_=sa.String(32),
        )
    op.create_table(
        "account_challenges",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("expires", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
    )


def downgrade():
    raise RuntimeError(
        "Username migration is forward-only; restore a pre-migration backup to roll back"
    )
