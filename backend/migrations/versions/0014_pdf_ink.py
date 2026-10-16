"""Persistent vector handwriting attached to immutable PDF files."""

from alembic import op

from backend.models import InkStroke

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    InkStroke.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("ink_strokes")
