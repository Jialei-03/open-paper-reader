"""Persist conversation read receipts and shorten generated titles."""

import re

from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "read_at" not in {
        c["name"] for c in sa.inspect(bind).get_columns("agent_sessions")
    }:
        op.add_column(
            "agent_sessions", sa.Column("read_at", sa.String(40), nullable=True)
        )
    metadata = sa.MetaData()
    projects = sa.Table("research_projects", metadata, autoload_with=bind)
    sessions = sa.Table("agent_sessions", metadata, autoload_with=bind)
    events = sa.Table("research_events", metadata, autoload_with=bind)
    for row in bind.execute(sa.select(projects)).mappings():
        question = row["question"] or ""
        latest = bind.execute(
            sa.select(sa.func.max(events.c.created_at)).where(
                events.c.project_id == row["id"]
            )
        ).scalar()
        bind.execute(
            sessions.update()
            .where(sessions.c.id == row["session_id"], sessions.c.read_at.is_(None))
            .values(read_at=latest or row["created_at"])
        )
        legacy_lead = row["title"] == "项目导师"
        if not row["title"] or row["title"] == question[:300] or legacy_lead:
            text = question
            if legacy_lead:
                first = bind.execute(
                    sa.select(events.c.detail)
                    .where(
                        events.c.project_id == row["id"],
                        events.c.actor == "human",
                        events.c.action == "message",
                    )
                    .order_by(events.c.created_at, events.c.id)
                    .limit(1)
                ).scalar()
                text = (first or {}).get("text") or "项目讨论"
            text = re.sub(r"\s+", " ", text).strip().lstrip("# ")
            title = (
                re.split(r"[。！？\n]", text, maxsplit=1)[0][:16].rstrip("，,、:：;； ")
                or "新对话"
            )
            bind.execute(
                projects.update().where(projects.c.id == row["id"]).values(title=title)
            )
            bind.execute(
                sessions.update()
                .where(sessions.c.id == row["session_id"])
                .values(title=title)
            )


def downgrade():
    op.drop_column("agent_sessions", "read_at")
