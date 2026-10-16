"""Private citation cards attached to a paper."""

from alembic import op

from backend.citations import SavedCitation

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    SavedCitation.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("saved_citations")
