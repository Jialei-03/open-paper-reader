"""User-created library collections, separate from notes and knowledge items."""

from alembic import op

from backend.library_collections import LibraryCollection

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    LibraryCollection.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("library_collections")
