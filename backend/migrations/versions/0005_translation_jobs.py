"""Versioned translation tasks and bilingual content alignment."""

from alembic import op
from backend.models import TranslationJob

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    TranslationJob.__table__.create(op.get_bind())


def downgrade():
    op.drop_table("translation_jobs")
