"""One active translation per paper and method, so the two can coexist (index only; no rows change)."""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

ACTIVE = sa.text("status IN ('queued', 'running')")


def _recreate(columns):
    bind = op.get_bind()
    names = {i["name"] for i in sa.inspect(bind).get_indexes("translation_jobs")}
    if "uq_active_translation" in names:
        op.drop_index("uq_active_translation", table_name="translation_jobs")
    op.create_index(
        "uq_active_translation",
        "translation_jobs",
        columns,
        unique=True,
        sqlite_where=ACTIVE,
        postgresql_where=ACTIVE,
    )


def upgrade():
    _recreate(["owner", "paper_id", "engine"])


def downgrade():
    _recreate(["owner", "paper_id"])
