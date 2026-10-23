"""File-backed member definitions. Old columns are a lossless migration archive."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    for table in ("member_library", "team_members"):
        if "file_path" not in {c["name"] for c in sa.inspect(bind).get_columns(table)}:
            op.add_column(
                table,
                sa.Column("file_path", sa.Text(), nullable=False, server_default=""),
            )
    # Alembic's environment supplies its selected data directory. Test/manual
    # connections without it export lazily on the first member read instead.
    settings = bind.info.get("ora_settings")
    if settings:
        from backend.agent_files import export_all

        with Session(bind=bind, info={"settings": settings}) as d:
            export_all(d)


def downgrade():
    for table in ("team_members", "member_library"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("file_path")
