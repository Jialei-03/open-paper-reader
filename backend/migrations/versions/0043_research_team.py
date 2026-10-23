"""Team members, channels, messages and durable deliveries."""

from alembic import op
from backend.models import TeamMember, TeamChannel, TeamMessage, TeamDelivery

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade():
    for model in (TeamMember, TeamChannel, TeamMessage, TeamDelivery):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    for model in (TeamDelivery, TeamMessage, TeamChannel, TeamMember):
        model.__table__.drop(op.get_bind())
