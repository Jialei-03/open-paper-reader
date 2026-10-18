"""Public bibliographic record kept per paper (venue, year, DOI, citation counts)."""

from alembic import op
from backend.paper_metadata import PaperMetadata

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    PaperMetadata.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    PaperMetadata.__table__.drop(op.get_bind(), checkfirst=True)
