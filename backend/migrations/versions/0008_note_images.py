"""Private images reusable across notes and retained for revision history."""

from alembic import op

from backend.models import NoteImage

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    NoteImage.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    NoteImage.__table__.drop(op.get_bind())
