"""Versioned paper reading guides and quizzes."""

from alembic import op

from backend.models import ReadingArtifact

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    ReadingArtifact.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("reading_artifacts")
