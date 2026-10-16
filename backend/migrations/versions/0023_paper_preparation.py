"""Durable automatic preparation and shared sentence translation memory."""

from alembic import op
import sqlalchemy as sa
from backend.models import PreparationSetting, PaperPreparation, TranslationMemory

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    if "preparation_id" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("translation_jobs")}:
        op.add_column("translation_jobs", sa.Column("preparation_id", sa.String(36), nullable=False, server_default=""))
    for model in (PreparationSetting, PaperPreparation, TranslationMemory):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_column("translation_jobs", "preparation_id")
    for model in (TranslationMemory, PaperPreparation, PreparationSetting):
        model.__table__.drop(op.get_bind(), checkfirst=True)
