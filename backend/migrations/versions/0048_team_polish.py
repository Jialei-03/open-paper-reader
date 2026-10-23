"""Start job notifications at upgrade; preserve user-controlled team limits."""

import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade():
    from backend.models import now

    bind = op.get_bind()
    workspaces = sa.Table("research_workspaces", sa.MetaData(), autoload_with=bind)
    boundary = now()
    for row in bind.execute(sa.select(workspaces)).mappings():
        state = dict(row["workflow_state"] or {})
        state.setdefault("job_notifications_after", boundary)
        state.setdefault(
            "budget",
            {
                "max_tokens": 0,
                "period_hours": 24,
                "max_concurrent": 0,
                "relay_limit": 12,
            },
        )
        bind.execute(
            workspaces.update()
            .where(workspaces.c.id == row["id"])
            .values(workflow_state=state)
        )


def downgrade():
    # Budgets already fit workflow_state; keep settings and member files intact.
    bind = op.get_bind()
    workspaces = sa.Table("research_workspaces", sa.MetaData(), autoload_with=bind)
    for row in bind.execute(sa.select(workspaces)).mappings():
        state = dict(row["workflow_state"] or {})
        state.pop("job_notifications_after", None)
        bind.execute(
            workspaces.update()
            .where(workspaces.c.id == row["id"])
            .values(workflow_state=state)
        )
