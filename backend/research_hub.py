"""Navigation and human organization, separate from research execution."""

from fastapi import Depends, HTTPException
from pydantic import Field
from sqlalchemy import select, update

from . import research_workspaces
from .models import (
    AgentSession,
    ResearchCollection,
    ResearchProject,
    ResearchWorkspace,
    ResearchEvent,
    now,
)
from .schemas import Strict

BASE = "/api/v1/research"


class ReadInput(Strict):
    event_id: str = Field(default="", max_length=36)


class CollectionInput(Strict):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)


class CollectionPatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    archived: bool | None = None


class OrganizationInput(Strict):
    collection_id: str | None = Field(default=None, max_length=36)
    on_board: bool | None = None
    pinned: bool | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)


def collection_out(item, research_ids=None):
    return {
        key: getattr(item, key)
        for key in (
            "id",
            "name",
            "description",
            "archived",
            "created_at",
            "updated_at",
        )
    } | {"research_ids": research_ids or []}


def collection_of(d, owner, id, *, writable=False):
    if not id:
        return None
    item = d.get(ResearchCollection, id)
    if item is None or item.owner != owner:
        raise HTTPException(404, "Not found")
    if writable:
        d.execute(
            update(ResearchCollection)
            .where(ResearchCollection.id == id)
            .values(updated_at=ResearchCollection.updated_at)
        )
        d.refresh(item)
        if item.archived:
            raise HTTPException(409, "请先恢复这个项目分类")
    return item


def research_out(d, project):
    session = d.get(AgentSession, project.session_id)
    return research_workspaces.summary(d, project) | {
        "archived_at": session.archived_at if session else None,
        "unread": bool(
            session
            and d.scalar(
                select(ResearchEvent.id)
                .where(
                    ResearchEvent.project_id == project.id,
                    ResearchEvent.actor != "human",
                    ResearchEvent.created_at > (session.read_at or project.created_at),
                    ResearchEvent.action.in_(
                        (
                            "message",
                            "decision_requested",
                            "plan_proposed",
                            "concluded",
                            "paused",
                        )
                    ),
                )
                .limit(1)
            )
        ),
        "title": project.title or project.question,
        "session_id": project.session_id,
        "workspace_id": project.workspace_id,
        "collection_id": project.collection_id,
        "on_board": project.on_board,
        "pinned_at": session.pinned_at if session else None,
    }


def navigation(settings, d, owner):
    from .research_locations import location_for

    workspaces = list(
        d.scalars(
            select(ResearchWorkspace)
            .where(ResearchWorkspace.owner == owner)
            .order_by(ResearchWorkspace.created_at, ResearchWorkspace.id)
        )
    )
    projects = list(
        d.scalars(
            select(ResearchProject)
            .where(ResearchProject.owner == owner)
            .order_by(ResearchProject.updated_at.desc(), ResearchProject.id)
        )
    )
    rows = {p.id: research_out(d, p) for p in projects}
    workspace_ids = {w.id for w in workspaces if not w.archived}
    grouped = []
    for workspace in workspaces:
        grouped.append(
            research_workspaces.workspace_out(workspace)
            | {
                "location": location_for(settings, workspace),
                "researches": sorted(
                    [rows[p.id] for p in projects if p.workspace_id == workspace.id],
                    key=lambda r: (r["pinned_at"] or "", r["updated_at"], r["id"]),
                    reverse=True,
                ),
            }
        )
    collections = [
        collection_out(
            item,
            [
                p.id
                for p in projects
                if p.collection_id == item.id
                and p.workspace_id in workspace_ids
                and not rows[p.id]["archived_at"]
            ],
        )
        for item in d.scalars(
            select(ResearchCollection)
            .where(ResearchCollection.owner == owner)
            .order_by(ResearchCollection.name, ResearchCollection.id)
        )
    ]
    return {"workspaces": grouped, "collections": collections}


def board(d, owner):
    rows = []
    for project in d.scalars(
        select(ResearchProject)
        .join(ResearchWorkspace, ResearchWorkspace.id == ResearchProject.workspace_id)
        .join(AgentSession, AgentSession.id == ResearchProject.session_id)
        .where(
            ResearchProject.owner == owner,
            ResearchWorkspace.owner == owner,
            ResearchWorkspace.archived.is_(False),
            AgentSession.archived_at.is_(None),
            ResearchProject.on_board.is_(True),
        )
        .order_by(ResearchProject.updated_at.desc(), ResearchProject.id)
    ):
        rows.append(
            research_out(d, project) | {"type": "research", "project_id": project.id}
        )
    return {"columns": list(research_workspaces.COLUMNS), "cards": rows}


def install_hub_routes(app, settings, db, auth, human, owned, project_of, project_out):
    def allowed(a):
        human(a)
        if settings.mode != "local":
            raise HTTPException(403, "研究功能只在本机版提供")

    @app.get(BASE + "/navigation")
    def get_navigation(a=Depends(auth), d=Depends(db)):
        allowed(a)
        return navigation(settings, d, a["id"])

    @app.post(BASE + "/projects/{id}/read")
    def mark_read(id: str, body: ReadInput, a=Depends(auth), d=Depends(db)):
        allowed(a)
        project = project_of(d, id, a)
        session = owned(d, AgentSession, project.session_id, a)
        event = (
            d.get(ResearchEvent, body.event_id)
            if body.event_id
            else d.scalar(
                select(ResearchEvent)
                .where(ResearchEvent.project_id == project.id)
                .order_by(ResearchEvent.created_at.desc())
                .limit(1)
            )
        )
        if body.event_id and (event is None or event.project_id != project.id):
            raise HTTPException(404, "Not found")
        through = event.created_at if event else project.created_at
        session.read_at = max(session.read_at or "", through)
        d.commit()
        return {"read_at": session.read_at}

    @app.get(BASE + "/board")
    def get_board(a=Depends(auth), d=Depends(db)):
        allowed(a)
        return board(d, a["id"])

    @app.post(BASE + "/collections")
    def create_collection(body: CollectionInput, a=Depends(auth), d=Depends(db)):
        allowed(a)
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "项目分类名称不能为空")
        item = ResearchCollection(
            owner=a["id"], name=name, description=body.description.strip()
        )
        d.add(item)
        d.commit()
        return collection_out(item)

    @app.patch(BASE + "/collections/{id}")
    def edit_collection(id: str, body: CollectionPatch, a=Depends(auth), d=Depends(db)):
        allowed(a)
        item = owned(d, ResearchCollection, id, a)
        d.execute(
            update(ResearchCollection)
            .where(ResearchCollection.id == id)
            .values(updated_at=ResearchCollection.updated_at)
        )
        d.refresh(item)
        for key, value in body.model_dump(exclude_unset=True).items():
            if value is None:
                continue
            if isinstance(value, str):
                value = value.strip()
            if key == "name" and not value:
                raise HTTPException(422, "项目分类名称不能为空")
            setattr(item, key, value)
        item.updated_at = now()
        d.commit()
        return collection_out(
            item,
            list(
                d.scalars(
                    select(ResearchProject.id).where(
                        ResearchProject.collection_id == id,
                        ResearchProject.owner == a["id"],
                    )
                )
            ),
        )

    @app.patch(BASE + "/projects/{id}/organization")
    def organize(id: str, body: OrganizationInput, a=Depends(auth), d=Depends(db)):
        allowed(a)
        project = project_of(d, id, a, writable=True)
        values = body.model_dump(exclude_unset=True)
        if "collection_id" in values:
            collection_of(d, a["id"], body.collection_id, writable=True)
            project.collection_id = body.collection_id
        if body.on_board is not None:
            project.on_board = body.on_board
        session = owned(d, AgentSession, project.session_id, a)
        if body.pinned is not None:
            session.pinned_at = now() if body.pinned else None
        if body.title is not None:
            if not body.title.strip():
                raise HTTPException(422, "研究名称不能为空")
            project.title = body.title.strip()
            session.title = project.title[:100]
        project.updated_at = now()
        d.commit()
        return research_out(d, project)
