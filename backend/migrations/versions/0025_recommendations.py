"""Kept recommendations and the papers marked "not interested" (additive only)."""

from alembic import op

from backend.recommendations import RecommendationCache, RecommendationDismissal

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    RecommendationCache.__table__.create(op.get_bind(), checkfirst=True)
    RecommendationDismissal.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    RecommendationDismissal.__table__.drop(op.get_bind(), checkfirst=True)
    RecommendationCache.__table__.drop(op.get_bind(), checkfirst=True)
