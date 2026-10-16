"""Explicit revocable read-only paper sharing."""

from alembic import op

from backend.paper_shares import PaperShare

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    PaperShare.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("paper_shares")
