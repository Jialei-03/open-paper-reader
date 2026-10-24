"""Researcher reactions to team messages."""

from alembic import op

from backend.models import TeamMessageReaction

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade():
    TeamMessageReaction.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    TeamMessageReaction.__table__.drop(op.get_bind())
