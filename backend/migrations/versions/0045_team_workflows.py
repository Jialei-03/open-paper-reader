"""Adopt contract rule workflows; retain linear output/checkpoint metadata."""

from copy import deepcopy

import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade():
    from backend.team_rules import (
        builtin_workflows,
        convert_linear_workflow,
        initial_state,
    )

    bind = op.get_bind()
    for table, column in (
        ("research_workspaces", "workflow"),
        ("research_workspaces", "workflow_state"),
        ("team_deliveries", "action"),
    ):
        if column not in {c["name"] for c in sa.inspect(bind).get_columns(table)}:
            op.add_column(
                table, sa.Column(column, sa.JSON(), nullable=False, server_default="{}")
            )
    meta = sa.MetaData()
    workflows = sa.Table("research_workflows", meta, autoload_with=bind)
    projects = sa.Table("research_projects", meta, autoload_with=bind)
    for row in bind.execute(sa.select(workflows)).mappings():
        source = row["definition"] or {}
        if "rules" in source:
            continue
        original = {
            **source,
            "id": row["id"],
            "name": row["name"],
            "version": row["version"],
            "builtin": False,
        }
        flow, state = convert_linear_workflow(original)
        bind.execute(
            workflows.update()
            .where(workflows.c.id == row["id"])
            .values(definition={**flow, "initial_state": state, "execution": original})
        )
    for row in bind.execute(sa.select(projects)).mappings():
        original = row["workflow"] or {}
        if not original or "rules" in original:
            continue
        if original.get("legacy"):
            flow = builtin_workflows()["research"]
            state = initial_state(flow)
        else:
            flow, state = convert_linear_workflow(original)
        bind.execute(
            projects.update()
            .where(projects.c.id == row["id"])
            .values(
                workflow=flow,
                workflow_state={
                    **(row["workflow_state"] or {}),
                    "execution": deepcopy(original),
                    "rule_state": state,
                },
            )
        )
    # Workspace adoption binds the research channel after Step 1's lazy member
    # creation. Existing schedules are adopted into that same rule set there.


def downgrade():
    bind = op.get_bind()
    meta = sa.MetaData()
    for name, definition_column, state_column in (
        ("research_workflows", "definition", None),
        ("research_projects", "workflow", "workflow_state"),
    ):
        table = sa.Table(name, meta, autoload_with=bind)
        for row in bind.execute(sa.select(table)).mappings():
            source = row[definition_column] or {}
            execution = (
                (row[state_column] or {}).get("execution")
                if state_column
                else source.get("execution")
            )
            if execution:
                values = {definition_column: execution}
                if state_column:
                    values[state_column] = {
                        k: v
                        for k, v in row[state_column].items()
                        if k
                        not in {
                            "execution",
                            "rule_state",
                            "pending_actions",
                            "routed_source",
                        }
                    }
                bind.execute(
                    table.update().where(table.c.id == row["id"]).values(**values)
                )
    for table, column in (
        ("team_deliveries", "action"),
        ("research_workspaces", "workflow_state"),
        ("research_workspaces", "workflow"),
    ):
        op.drop_column(table, column)
