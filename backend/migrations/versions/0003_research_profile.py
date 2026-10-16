"""Persist explicit research preferences and external discovery feedback."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "research_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("excluded", sa.JSON(), nullable=False),
        sa.Column("tracking", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
    )
    op.create_table(
        "discovery_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("external_id", sa.String(200), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("owner", "external_id"),
    )
    op.create_index("ix_discovery_candidates_owner", "discovery_candidates", ["owner"])


def downgrade():
    op.drop_table("discovery_candidates")
    op.drop_table("research_profiles")
