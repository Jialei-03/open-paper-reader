"""Research nodes: estimated value and cost of working on them (two new columns)."""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("research_nodes")
    }
    for name in ("value", "cost"):
        if name not in columns:
            op.add_column(
                "research_nodes",
                sa.Column(name, sa.String(8), nullable=False, server_default=""),
            )


def downgrade():
    with op.batch_alter_table("research_nodes") as batch:
        batch.drop_column("cost")
        batch.drop_column("value")
