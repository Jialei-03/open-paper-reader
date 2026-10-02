"""Durable owner-scoped agent sessions and bounded runs."""

from alembic import op

from backend.models import AgentQuota, AgentRun, AgentSession

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    AgentQuota.__table__.create(op.get_bind(), checkfirst=True)
    AgentSession.__table__.create(op.get_bind(), checkfirst=True)
    AgentRun.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    AgentQuota.__table__.drop(op.get_bind())
    AgentRun.__table__.drop(op.get_bind())
    AgentSession.__table__.drop(op.get_bind())
