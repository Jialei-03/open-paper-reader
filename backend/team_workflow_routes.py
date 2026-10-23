# ruff: noqa: B008
"""One rule workflow API for customization and team settings."""
from copy import deepcopy

from fastapi import Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update

from . import team_rules, team_workflows as flows
from .models import ResearchWorkflow, ResearchWorkspace, now, uid


def install(app, settings, db, auth, allowed, owned):
    base = "/api/v1/research/workflows"

    def payload(body, identifier, *, builtin=False):
        try:
            if "steps" in body:
                # Backward-compatible import. The old step editor is gone.
                from .research_workflows import WorkflowInput

                legacy = WorkflowInput.model_validate(body).model_dump()
                return flows.pack(
                    {
                        **legacy,
                        "id": identifier,
                        "builtin": builtin,
                        "version": legacy.get("version") or 1,
                    }
                )
            body = {**body, "id": identifier, "builtin": builtin}
            return team_rules.validate_workflow(body)
        except (ValidationError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from None

    @app.get(base)
    def listing(workspace_id: str | None = None, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        workspace = (
            owned(d, ResearchWorkspace, workspace_id, a) if workspace_id else None
        )
        ids = list(team_rules.builtin_workflows()) + list(
            d.scalars(
                select(ResearchWorkflow.id)
                .where(ResearchWorkflow.owner == a["id"])
                .order_by(ResearchWorkflow.created_at)
            )
        )
        return [flows.definition(d, a["id"], id, workspace=workspace) for id in ids]

    @app.post(base)
    def create(body: dict, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        identifier = uid()
        body = dict(body)
        source_id = body.pop("copy_from", None)
        data = payload(body, identifier)
        if source_id:
            source = flows.definition(d, a["id"], source_id)
            initial = flows.seed(d, source)
            if flows.key(source) in initial.get("linear", {}):
                data["initial_state"] = {
                    "linear": {flows.key(data): initial["linear"][flows.key(source)]}
                }
            if source_id in team_rules.builtin_workflows():
                from .research_workflows import BUILTINS

                data["execution"] = deepcopy(BUILTINS[source_id])
            else:
                source_row = owned(d, ResearchWorkflow, source_id, a)
                data["execution"] = deepcopy(source_row.definition.get("execution", {}))
        row = ResearchWorkflow(
            id=identifier, owner=a["id"], name=data["name"], definition=data
        )
        d.add(row)
        d.commit()
        result = flows.definition(d, a["id"], identifier)
        if "steps" in body:
            result["steps"] = data["execution"]["steps"]
        return result

    @app.get(base + "/{id}")
    def read(id: str, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        data = flows.definition(d, a["id"], id)
        if id in team_rules.builtin_workflows():
            from .research_workflows import BUILTINS

            data = {**data, "steps": deepcopy(BUILTINS[id]["steps"])}
        d.commit()
        return data

    @app.put(base + "/{id}")
    def edit(id: str, body: dict, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        if id in team_rules.builtin_workflows():
            raise HTTPException(409, "内置工作流只读 / Built-in workflow is read-only")
        row = owned(d, ResearchWorkflow, id, a)
        data = payload(body, id)
        # Preserve output/checkpoint execution metadata when editing migrated rules.
        data = {**deepcopy(row.definition), **data}
        result = d.execute(
            update(ResearchWorkflow)
            .where(
                ResearchWorkflow.id == id,
                ResearchWorkflow.version == body.get("version"),
            )
            .values(
                name=data["name"],
                definition=data,
                version=ResearchWorkflow.version + 1,
                updated_at=now(),
            )
        )
        if not result.rowcount:
            raise HTTPException(409, "工作流已经更新 / Workflow changed")
        d.commit()
        return flows.definition(d, a["id"], id)

    @app.delete(base + "/{id}")
    def delete(id: str, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        if id in team_rules.builtin_workflows():
            raise HTTPException(409, "内置工作流只读 / Built-in workflow is read-only")
        row = owned(d, ResearchWorkflow, id, a)
        if any(
            w.workflow.get("id") == id
            for w in d.scalars(
                select(ResearchWorkspace).where(ResearchWorkspace.owner == a["id"])
            )
        ):
            raise HTTPException(409, "工作流正在使用 / Workflow is in use")
        d.delete(row)
        d.commit()
        return {"deleted": True}
