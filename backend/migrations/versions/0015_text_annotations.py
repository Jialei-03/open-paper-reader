"""Private text highlights and comments bound to PDF versions."""

from alembic import op

from backend.models import TextAnnotation

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    TextAnnotation.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("text_annotations")
