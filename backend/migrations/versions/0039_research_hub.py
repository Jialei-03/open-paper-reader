"""Separate physical workspaces, project classifications, and research chats.

Legacy chats keep their session/run/Pi IDs. Their visible transcript is copied
into research events; no model work is queued by this migration.
"""

from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def _id(kind, value):
    return str(uuid5(NAMESPACE_URL, f"ora:research-hub:{kind}:{value}"))


def _text(message):
    if isinstance(message.get("text"), str):
        return message["text"]
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


def _messages(bind, runs, entries, session_id):
    # Pi is the authoritative durable transcript, including cancelled partial
    # replies and mid-turn messages. Never delete or rewrite the Pi entries.
    values = []
    for row in bind.execute(
        sa.select(entries)
        .where(entries.c.session_id == session_id)
        .order_by(entries.c.seq, entries.c.id)
    ).mappings():
        entry = row["entry"] or {}
        if not isinstance(entry, dict):
            continue
        message = entry.get("message", entry)
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role in ("user", "assistant") and _text(message).strip():
            values.append(
                (
                    role,
                    _text(message),
                    row["created_at"],
                    None,
                    entry.get("id") or row["id"],
                )
            )
    if values:
        return values
    for run in runs:
        runtime = run["runtime"] or {}
        messages = runtime.get("conversation_messages") or runtime.get("messages") or []
        messages = [
            m
            for m in messages
            if isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and _text(m).strip()
        ]
        if not messages:
            messages = [
                {"role": "user", "text": run["prompt"]},
                {"role": "assistant", "text": run["response"]},
            ]
        for index, message in enumerate(messages):
            if _text(message).strip():
                values.append(
                    (
                        message["role"],
                        _text(message),
                        run["created_at"],
                        _id("sprint", run["id"]),
                        message.get("id") or f"{run['id']}:{index}",
                    )
                )
    return values


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "research_collections" not in inspector.get_table_names():
        op.create_table(
            "research_collections",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "owner", sa.String(36), sa.ForeignKey("users.id"), nullable=False
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "archived", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
        )
        op.create_index(
            "ix_research_collections_owner", "research_collections", ["owner"]
        )
    columns = {c["name"] for c in sa.inspect(bind).get_columns("research_workspaces")}
    if "location" not in columns:
        op.add_column(
            "research_workspaces",
            sa.Column("location", sa.JSON(), nullable=False, server_default="{}"),
        )
    columns = {c["name"] for c in sa.inspect(bind).get_columns("research_projects")}
    for column in (
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("collection_id", sa.String(36), nullable=True),
        sa.Column("on_board", sa.Boolean(), nullable=False, server_default=sa.false()),
    ):
        if column.name not in columns:
            op.add_column("research_projects", column)
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("research_projects")}
    if "ix_research_projects_collection_id" not in indexes:
        op.create_index(
            "ix_research_projects_collection_id", "research_projects", ["collection_id"]
        )
    metadata = sa.MetaData()
    names = (
        "research_workspaces",
        "research_collections",
        "research_projects",
        "agent_sessions",
        "agent_runs",
        "agent_session_entries",
        "research_nodes",
        "research_events",
        "research_sprints",
    )
    tables = {name: sa.Table(name, metadata, autoload_with=bind) for name in names}
    (
        workspaces,
        collections,
        projects,
        sessions,
        runs,
        entries,
        nodes,
        events,
        sprints,
    ) = (tables[name] for name in names)
    for w in bind.execute(sa.select(workspaces)).mappings():
        cid = _id("collection", w["id"])
        legacy = (
            bind.execute(
                sa.select(sessions).where(
                    sessions.c.owner == w["owner"],
                    sa.or_(
                        sessions.c.id == w["session_id"],
                        sa.and_(
                            sessions.c.workspace_id == w["id"],
                            sessions.c.kind.in_(("project_lead", "project_chat")),
                        ),
                    ),
                    ~sa.exists(
                        sa.select(projects.c.id).where(
                            projects.c.session_id == sessions.c.id
                        )
                    ),
                )
            )
            .mappings()
            .all()
        )
        known = bind.scalar(sa.select(collections.c.id).where(collections.c.id == cid))
        # An existing deterministic category means this workspace was already
        # migrated. Do not undo a person's later choice to leave a research
        # unclassified. New hub workspaces have an explicit location and no
        # mentor/chat objects, so re-upgrading does not invent categories.
        if known is None and (not w["location"] or legacy):
            bind.execute(
                collections.insert().values(
                    id=cid,
                    owner=w["owner"],
                    name=w["name"],
                    description=w["description"],
                    archived=w["archived"],
                    created_at=w["created_at"],
                    updated_at=w["updated_at"],
                )
            )
            bind.execute(
                projects.update()
                .where(
                    projects.c.workspace_id == w["id"],
                    projects.c.owner == w["owner"],
                    projects.c.collection_id.is_(None),
                )
                .values(collection_id=cid)
            )
        for session in legacy:
            pid = _id("project", session["id"])
            historical = (
                bind.execute(
                    sa.select(runs)
                    .where(
                        runs.c.session_id == session["id"], runs.c.owner == w["owner"]
                    )
                    .order_by(runs.c.created_at, runs.c.id)
                )
                .mappings()
                .all()
            )
            title = session["title"] or "原项目对话"
            question = (
                (w["name"] + " · 原项目导师")
                if session["id"] == w["session_id"] and title == "项目导师"
                else title
            )
            bind.execute(
                projects.insert().values(
                    id=pid,
                    owner=w["owner"],
                    question=question,
                    title=title,
                    workspace_id=w["id"],
                    collection_id=cid,
                    on_board=False,
                    background="从原项目对话保留的研究；继续前请确认研究方向和计划。",
                    spawned_by="legacy_chat",
                    model_config_id=session["model_config_id"]
                    or w["model_config_id"]
                    or (historical[-1]["model_config_id"] if historical else "none"),
                    status="paused",
                    end_reason="",
                    budget={
                        "max_sprints": 30,
                        "max_tokens": 2000000,
                        "max_job_seconds": 36000,
                        "auto_decide": False,
                    },
                    spent={"sprints": 0, "tokens": 0, "job_seconds": 0},
                    session_id=session["id"],
                    stage="scoping",
                    compute_id=w["compute_id"] or "host",
                    environment={},
                    plan={},
                    conclusion={},
                    parent_id=None,
                    forked_from={},
                    fork_key=None,
                    inherited_history={"legacy_session_id": session["id"]},
                    merged={},
                    created_at=session["created_at"],
                    updated_at=session["updated_at"],
                )
            )
            bind.execute(
                sessions.update()
                .where(sessions.c.id == session["id"])
                .values(kind="research")
            )
            bind.execute(
                nodes.insert().values(
                    id=_id("root", pid),
                    project_id=pid,
                    parent_id=None,
                    kind="question",
                    title=question[:300],
                    status="open",
                    confidence=0.5,
                    kill_if="",
                    budget_tokens=0,
                    value="",
                    cost="",
                    evidence_for=[],
                    evidence_against=[],
                    doubts=[],
                    spent_tokens=0,
                    spent_job_seconds=0,
                    created_at=session["created_at"],
                    updated_at=session["updated_at"],
                )
            )
            for number, run in enumerate(historical, 1):
                terminal = run["status"] in ("completed", "failed", "cancelled")
                if not terminal:
                    bind.execute(
                        runs.update()
                        .where(runs.c.id == run["id"])
                        .values(
                            status="cancelled",
                            error="升级后保留原对话，研究已暂停；继续前请确认方向",
                        )
                    )
                bind.execute(
                    sprints.insert().values(
                        id=_id("sprint", run["id"]),
                        project_id=pid,
                        number=number,
                        role="scoping",
                        run_id=run["id"],
                        status="ended" if run["status"] == "completed" else "abnormal",
                        focus_node_id=None,
                        summary=run["response"] or run["error"] or "原对话已保留",
                        next_focus="",
                        waiting_on=[],
                        tokens=0,
                        commit_sha="",
                        snapshot={},
                        created_at=run["created_at"],
                        updated_at=run["updated_at"],
                    )
                )
            previous = datetime(1970, 1, 1, tzinfo=timezone.utc)
            seen = set()
            for role, text, stamp, sprint_id, message_id in _messages(
                bind, historical, entries, session["id"]
            ):
                if message_id in seen:
                    continue
                seen.add(message_id)
                try:
                    at = datetime.fromisoformat(stamp)
                    if at.tzinfo is None:
                        at = at.replace(tzinfo=timezone.utc)
                except (ValueError, TypeError):
                    at = previous
                at = max(at, previous + timedelta(microseconds=1))
                previous = at
                bind.execute(
                    events.insert().values(
                        id=_id("message", f"{pid}:{message_id}"),
                        project_id=pid,
                        node_id=None,
                        sprint_id=sprint_id,
                        actor="human" if role == "user" else "advisor",
                        action="message",
                        detail={"text": text, "legacy_session_id": session["id"]},
                        created_at=at.isoformat(),
                    )
                )
        bind.execute(
            workspaces.update()
            .where(workspaces.c.id == w["id"])
            .values(session_id=None)
        )


def downgrade():
    # Older mappers ignore these additive fields/tables. Keep physical locations,
    # classifications, names and the original session/run/Pi identities intact
    # so a temporary application downgrade can later be upgraded without loss.
    pass
