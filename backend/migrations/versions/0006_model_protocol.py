"""Pin translation jobs to a saved model and wire protocol."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        row["name"] for row in sa.inspect(op.get_bind()).get_columns("translation_jobs")
    }
    if "model_config_id" not in columns:
        op.add_column(
            "translation_jobs",
            sa.Column(
                "model_config_id", sa.String(36), nullable=False, server_default=""
            ),
        )
    if "protocol" not in columns:
        op.add_column(
            "translation_jobs",
            sa.Column(
                "protocol", sa.String(20), nullable=False, server_default="openai"
            ),
        )


def downgrade():
    with op.batch_alter_table("translation_jobs") as batch:
        batch.drop_column("model_config_id")
        batch.drop_column("protocol")
