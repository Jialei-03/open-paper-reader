"""Collapse queued into unread; retain historical snapshots as originally recorded."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE papers SET reading_status='unread', revision=revision+1 WHERE reading_status='queued'"
    )


def downgrade():
    pass  # Merging statuses is intentionally irreversible.
