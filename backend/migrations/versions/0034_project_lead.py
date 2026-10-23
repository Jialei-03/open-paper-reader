"""A project's main Pi conversation and research reports."""

from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def _report(action, detail, actor):
    if action == "plan_proposed":
        return "plan", (detail.get("plan") or {}).get("summary") or "计划待批准"
    if action == "decision_requested":
        return (
            "conclusion" if detail.get("kind") == "conclusion" else "decision"
        ), detail.get("reason") or "等待决定"
    if action == "input_needed":
        return "decision", detail.get("summary") or "等待回复"
    if action == "paused" and actor == "system":
        return "error", detail.get("reason") or "研究已暂停"
    if action == "docker_unavailable":
        return "error", detail.get("reason") or "研究环境不可用"
    if action == "sprint_abnormal":
        return (
            "error",
            detail.get("reason") or detail.get("run_status") or "本轮异常停止",
        )
    return None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    context_type = next(
        c["type"] for c in inspector.get_columns("agent_runs") if c["name"] == "context"
    )
    if not isinstance(context_type, sa.Text):
        with op.batch_alter_table("agent_runs") as batch:
            batch.alter_column("context", type_=sa.Text(), existing_type=context_type)
    if "session_id" not in {
        c["name"] for c in inspector.get_columns("research_workspaces")
    }:
        op.add_column(
            "research_workspaces", sa.Column("session_id", sa.String(36), nullable=True)
        )
        op.create_index(
            "ix_research_workspaces_session_id",
            "research_workspaces",
            ["session_id"],
            unique=True,
        )
    if "spawned_by" not in {
        c["name"] for c in inspector.get_columns("research_projects")
    }:
        op.add_column(
            "research_projects",
            sa.Column(
                "spawned_by", sa.String(16), nullable=False, server_default="human"
            ),
        )
    if "research_notes" not in inspector.get_table_names():
        op.create_table(
            "research_notes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("research_workspaces.id"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("research_projects.id"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey("research_events.id"),
                nullable=False,
                unique=True,
            ),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_research_notes_workspace_id", "research_notes", ["workspace_id"]
        )
        op.create_index(
            "ix_research_notes_project_id", "research_notes", ["project_id"]
        )
    metadata = sa.MetaData()
    workspaces = sa.Table("research_workspaces", metadata, autoload_with=bind)
    sessions = sa.Table("agent_sessions", metadata, autoload_with=bind)
    projects = sa.Table("research_projects", metadata, autoload_with=bind)
    events = sa.Table("research_events", metadata, autoload_with=bind)
    notes = sa.Table("research_notes", metadata, autoload_with=bind)
    for w in bind.execute(sa.select(workspaces)).mappings():
        if w["session_id"]:
            continue
        session_id = str(uuid5(NAMESPACE_URL, f"ora:project:{w['id']}:lead"))
        if (
            bind.scalar(sa.select(sessions.c.id).where(sessions.c.id == session_id))
            is None
        ):
            bind.execute(
                sessions.insert().values(
                    id=session_id,
                    owner=w["owner"],
                    title="项目导师",
                    workspace_id=w["id"],
                    model_config_id=w["model_config_id"],
                    created_at=w["created_at"],
                    updated_at=w["updated_at"],
                )
            )
        bind.execute(
            workspaces.update()
            .where(workspaces.c.id == w["id"])
            .values(session_id=session_id)
        )
    rows = bind.execute(
        sa.select(events, projects.c.workspace_id)
        .join(projects, events.c.project_id == projects.c.id)
        .join(workspaces, projects.c.workspace_id == workspaces.c.id)
        .where(
            projects.c.owner == workspaces.c.owner,
            events.c.id.not_in(sa.select(notes.c.event_id)),
        )
    ).mappings()
    for row in rows:
        item = _report(row["action"], row["detail"] or {}, row["actor"])
        if item:
            bind.execute(
                notes.insert().values(
                    id=row["id"],
                    workspace_id=row["workspace_id"],
                    project_id=row["project_id"],
                    event_id=row["id"],
                    kind=item[0],
                    text=str(item[1])[:4000],
                    created_at=row["created_at"],
                )
            )


def downgrade():
    # Keep expanded contexts so downgrading does not truncate conversations.
    op.drop_table("research_notes")
    with op.batch_alter_table("research_projects") as batch:
        batch.drop_column("spawned_by")
    indexes = sa.inspect(op.get_bind()).get_indexes("research_workspaces")
    if any(i["name"] == "ix_research_workspaces_session_id" for i in indexes):
        op.drop_index("ix_research_workspaces_session_id", "research_workspaces")
    with op.batch_alter_table("research_workspaces") as batch:
        batch.drop_column("session_id")
