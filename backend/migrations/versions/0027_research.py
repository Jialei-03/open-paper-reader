"""Research projects: the map, its change log, sprints and background jobs (new tables only)."""

from alembic import op

from backend.models import (
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
)

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

# Parents first; dropped in the reverse order.
TABLES = (ResearchProject, ResearchNode, ResearchEvent, ResearchSprint, ResearchJob)


def upgrade():
    for model in TABLES:
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    for model in reversed(TABLES):
        model.__table__.drop(op.get_bind(), checkfirst=True)
