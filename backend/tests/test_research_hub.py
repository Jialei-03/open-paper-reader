"""Physical folders, optional classifications and opt-in research cards."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import importlib

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select

from backend import research_chat, research_map, research_workspaces, research_worker
from backend.models import (
    AgentRun,
    AgentSession,
    AgentSessionEntry,
    ResearchCollection,
    ResearchEvent,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure

BASE = "/api/v1/research"


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


def workspace(a, **extra):
    response = a.post(
        BASE + "/workspaces",
        json={"name": "Physical workspace", "location": {"kind": "managed"}, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def create(env, wid, **extra):
    app, a, _, settings = env
    _, model = configure(app, a, settings)
    response = a.post(
        BASE + "/projects",
        json={
            "workspace_id": wid,
            "message": "Can we compare these hypotheses?",
            "model_config_id": model,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_new_workspaces_have_no_hidden_lead_and_new_research_scopes_real_pi(env):
    app, a, _, _ = env
    w = workspace(a)
    assert not w["session_id"]
    assert a.get(f"{BASE}/workspaces/{w['id']}").json()["session_id"] is None
    assert a.get(f"{BASE}/workspaces/{w['id']}/sessions").json()["items"] == []
    assert (
        a.post(
            f"{BASE}/workspaces/{w['id']}/sessions", json={"title": "old chat"}
        ).status_code
        == 410
    )
    with app.state.maker() as d:
        assert d.scalar(select(func.count(AgentSession.id))) == 0
    p = create(env, w["id"])
    assert p["collection_id"] is None and p["on_board"] is False
    assert p["stage"] == "scoping" and p["status"] == "active"
    with app.state.maker() as d:
        project = d.get(ResearchProject, p["id"])
        research_worker._plan(app, d, project)
        d.commit()
        run = d.scalar(
            select(AgentRun).where(AgentRun.session_id == project.session_id)
        )
        assert run and run.runtime["research"]["role"] == "scoping"
        assert run.runtime["research"]["project_id"] == project.id
        assert d.get(AgentSession, project.session_id).kind == "research"
        assert d.get(ResearchWorkspace, w["id"]).session_id is None


def test_organization_only_changes_metadata_and_board_is_explicit(env):
    app, a, b, _ = env
    w = workspace(a)
    p = create(env, w["id"])
    group = a.post(
        BASE + "/collections",
        json={"name": "Vision", "description": "Classification only"},
    ).json()
    with app.state.maker() as d:
        before = d.get(ResearchProject, p["id"])
        source = (
            before.workspace_id,
            before.compute_id,
            before.question,
            before.status,
            before.stage,
            deepcopy(before.plan),
        )
        root_title = research_map.root(d, before).title
        research_map.add_node(
            d,
            before,
            research_map.root(d, before).id,
            "hypothesis",
            "Node does not become a board card",
            actor="human",
            kill_if="no evidence",
        )
        d.commit()
    assert a.get(BASE + "/board").json()["cards"] == []
    response = a.patch(
        f"{BASE}/projects/{p['id']}/organization",
        json={
            "collection_id": group["id"],
            "on_board": True,
            "pinned": True,
            "title": "A renamed thread",
        },
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["title"] == "A renamed thread" and response.json()["pinned_at"]
    )
    with app.state.maker() as d:
        after = d.get(ResearchProject, p["id"])
        assert (
            after.workspace_id,
            after.compute_id,
            after.question,
            after.status,
            after.stage,
            after.plan,
        ) == source
        assert research_map.root(d, after).title == root_title
    nav = a.get(BASE + "/navigation").json()
    row = nav["workspaces"][0]["researches"][0]
    assert row["collection_id"] == group["id"] and row["on_board"] is True
    assert row["session_id"] == p["session_id"] and row["workspace_id"] == w["id"]
    assert row["title"] == "A renamed thread"
    assert nav["collections"][0]["research_ids"] == [p["id"]]
    assert (
        a.patch(
            f"{BASE}/projects/{p['id']}/organization",
            json={"compute_id": "another-machine"},
        ).status_code
        == 422
    )
    assert (
        a.patch(
            f"{BASE}/collections/{group['id']}",
            json={"location": {"kind": "ssh", "path": "/elsewhere"}},
        ).status_code
        == 422
    )
    cards = a.get(BASE + "/board").json()["cards"]
    assert (
        len(cards) == 1 and cards[0]["id"] == p["id"] and cards[0]["type"] == "research"
    )
    assert b.get(BASE + "/navigation").json() == {"workspaces": [], "collections": []}
    assert (
        b.patch(
            f"{BASE}/projects/{p['id']}/organization", json={"on_board": False}
        ).status_code
        == 404
    )
    assert (
        b.patch(
            f"{BASE}/collections/{group['id']}", json={"name": "stolen"}
        ).status_code
        == 404
    )
    assert (
        a.patch(
            f"{BASE}/projects/{p['id']}/organization",
            json={"collection_id": None, "on_board": False, "pinned": False},
        ).status_code
        == 200
    )
    assert a.get(BASE + "/board").json()["cards"] == []


def test_collection_owner_archival_and_location_validation(env, tmp_path):
    app, a, b, _ = env
    invalid = a.post(
        BASE + "/workspaces",
        json={
            "name": "Bad",
            "location": {"kind": "local", "path": str(tmp_path / "missing")},
        },
    )
    assert invalid.status_code == 422
    folder = tmp_path / "existing"
    folder.mkdir()
    w = workspace(a, location={"kind": "local", "path": str(folder)})
    p = create(env, w["id"])
    assert p["compute_id"] == "host"
    group = b.post(BASE + "/collections", json={"name": "Other owner"}).json()
    assert (
        a.patch(
            f"{BASE}/projects/{p['id']}/organization",
            json={"collection_id": group["id"]},
        ).status_code
        == 404
    )
    group = a.post(BASE + "/collections", json={"name": "Closed"}).json()
    assert (
        a.patch(
            f"{BASE}/collections/{group['id']}", json={"archived": True}
        ).status_code
        == 200
    )
    assert (
        a.patch(
            f"{BASE}/projects/{p['id']}/organization",
            json={"collection_id": group["id"]},
        ).status_code
        == 409
    )
    nav = a.get(BASE + "/navigation").json()
    assert nav["workspaces"][0]["location"]["path"] == str(folder.resolve())
    assert not (folder / "PROJECT.md").exists()


def test_legacy_migration_retains_research_ids_and_pi_history_without_starting_chat(
    env,
):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        w = research_workspaces.create(d, owner, "Legacy classification")
        w.location = {}
        main = research_chat.main_session(d, w)
        chat = research_chat.new_session(d, owner, w, "Old ordinary chat")
        original = research_map.create_project(
            d, owner, "Existing research ID", "background", model
        )
        original.workspace_id, original.stage, original.status = (
            w.id,
            "experiments",
            "paused",
        )
        run = AgentRun(
            owner=owner,
            session_id=chat.id,
            model_config_id=model,
            model="test",
            prompt="old question",
            response="partial answer",
            status="running",
        )
        d.add(run)
        d.add(
            AgentSessionEntry(
                session_id=chat.id,
                seq=1,
                entry={
                    "type": "message",
                    "id": "old-u",
                    "message": {
                        "role": "user",
                        "content": [{"type": "text", "text": "old question"}],
                    },
                },
            )
        )
        d.add(
            AgentSessionEntry(
                session_id=chat.id,
                seq=2,
                entry={
                    "type": "message",
                    "id": "old-a",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "partial answer"}],
                    },
                },
            )
        )
        d.commit()
        wid, sid, mid, pid, rid = w.id, chat.id, main.id, original.id, run.id
    migration = importlib.import_module("backend.migrations.versions.0039_research_hub")
    with app.state.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
    with app.state.maker() as d:
        assert d.get(ResearchProject, pid).id == pid
        assert d.get(ResearchProject, pid).stage == "experiments"
        assert d.get(ResearchWorkspace, wid).session_id is None
        assert d.get(ResearchWorkspace, wid).location == {}
        assert d.scalar(select(func.count(ResearchCollection.id))) == 1
        converted = d.scalar(
            select(ResearchProject).where(ResearchProject.session_id == sid)
        )
        mentor = d.scalar(
            select(ResearchProject).where(ResearchProject.session_id == mid)
        )
        assert converted and mentor and converted.status == mentor.status == "paused"
        assert converted.stage == "scoping" and converted.on_board is False
        assert d.get(AgentSession, sid).kind == "research"
        assert d.get(AgentRun, rid).status == "cancelled"
        assert (
            d.scalar(
                select(func.count(AgentSessionEntry.id)).where(
                    AgentSessionEntry.session_id == sid
                )
            )
            == 2
        )
        assert (
            d.scalar(
                select(ResearchSprint.run_id).where(
                    ResearchSprint.project_id == converted.id
                )
            )
            == rid
        )
        transcript = list(
            d.scalars(
                select(ResearchEvent)
                .where(ResearchEvent.project_id == converted.id)
                .order_by(ResearchEvent.created_at)
            )
        )
        assert [(e.actor, e.detail["text"]) for e in transcript] == [
            ("human", "old question"),
            ("advisor", "partial answer"),
        ]
        assert d.scalar(select(func.count(AgentRun.id))) == 1


def test_real_0038_to_0039_upgrade_adds_columns_and_preserves_legacy_rows(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect, text
    from backend.config import Settings, database
    from backend.models import User

    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "old.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    monkeypatch.setattr(Settings, "env", classmethod(lambda cls: settings))
    command.upgrade(Config("alembic.ini"), "0038")
    engine, maker = database(settings)
    # Use current ORM factories to seed the historical data, then remove all
    # future fields before testing the real upgrade below.
    with engine.begin() as c:
        if "location" not in {
            col["name"] for col in inspect(c).get_columns("research_workspaces")
        }:
            c.execute(
                text(
                    "ALTER TABLE research_workspaces ADD COLUMN location JSON NOT NULL DEFAULT '{}'"
                )
            )
    with maker() as d:
        user = User(username="old", password="x")
        d.add(user)
        d.flush()
        w = research_workspaces.create(d, user.id, "Old folder")
        mentor = research_chat.main_session(d, w)
        p = research_map.create_project(d, user.id, "Old research", "", "m")
        p.workspace_id, p.status = w.id, "paused"
        historic = AgentRun(
            owner=user.id,
            session_id=mentor.id,
            model_config_id="m",
            model="m",
            prompt="Legacy question",
            response="Legacy answer",
            status="completed",
        )
        d.add(historic)
        d.add(
            AgentSessionEntry(
                session_id=mentor.id,
                seq=1,
                entry={
                    "type": "message",
                    "message": {"role": "user", "content": "Legacy question"},
                },
            )
        )
        d.add(
            AgentSessionEntry(
                session_id=mentor.id,
                seq=2,
                entry={
                    "type": "message",
                    "message": {"role": "assistant", "content": "Legacy answer"},
                },
            )
        )
        d.commit()
        wid, pid, sid, rid = w.id, p.id, mentor.id, historic.id
    # Old research migrations import current model tables. Remove future fields
    # so the test exercises the actual previously installed 0038 column shape.
    with engine.begin() as c:
        if "ix_research_projects_collection_id" in {
            i["name"] for i in inspect(c).get_indexes("research_projects")
        }:
            c.execute(text("DROP INDEX ix_research_projects_collection_id"))
        for name in ("title", "collection_id", "on_board"):
            c.execute(text(f"ALTER TABLE research_projects DROP COLUMN {name}"))
        c.execute(text("ALTER TABLE research_workspaces DROP COLUMN location"))
    command.upgrade(Config("alembic.ini"), "0039")
    with maker() as d:
        assert d.get(ResearchProject, pid).id == pid
        assert d.get(ResearchProject, pid).on_board is False
        assert d.get(ResearchProject, pid).collection_id
        assert d.get(ResearchWorkspace, wid).location == {}
        assert d.get(ResearchWorkspace, wid).session_id is None
        old = d.scalar(select(ResearchProject).where(ResearchProject.session_id == sid))
        assert old.status == "paused" and old.stage == "scoping"
        assert d.scalar(select(func.count(AgentRun.id))) == 1
        legacy_pid, legacy_collection = old.id, old.collection_id
        # Organization/location changes made after the initial upgrade must
        # survive a temporary downgrade, including explicitly unclassified work.
        physical = tmp_path / "physical"
        physical.mkdir()
        location = {"kind": "local", "path": str(physical), "connection_id": ""}
        d.get(ResearchWorkspace, wid).location = location
        custom = ResearchCollection(
            owner=old.owner, name="User classification", description="Keep this"
        )
        d.add(custom)
        d.flush()
        d.get(ResearchProject, pid).collection_id = custom.id
        d.get(ResearchProject, pid).title = "User display name"
        d.get(ResearchProject, pid).on_board = True
        old.collection_id = None
        new_w = research_workspaces.create(
            d,
            old.owner,
            "New unclassified folder",
            location={
                "kind": "ssh",
                "path": "/srv/research",
                "connection_id": "server",
            },
        )
        loose = research_map.create_project(
            d, old.owner, "New unclassified research", "", "m"
        )
        loose.workspace_id, loose.status = new_w.id, "paused"
        d.commit()
        custom_id, loose_id, new_wid = custom.id, loose.id, new_w.id
        event_ids = set(
            d.scalars(
                select(ResearchEvent.id).where(ResearchEvent.project_id == legacy_pid)
            )
        )
        sprint_ids = set(
            d.scalars(
                select(ResearchSprint.id).where(ResearchSprint.project_id == legacy_pid)
            )
        )
    command.downgrade(Config("alembic.ini"), "0038")
    assert "research_collections" in inspect(engine).get_table_names()
    command.upgrade(Config("alembic.ini"), "0039")
    with maker() as d:
        assert d.get(ResearchWorkspace, wid).location == location
        assert d.get(ResearchWorkspace, new_wid).location["kind"] == "ssh"
        assert d.get(ResearchProject, pid).collection_id == custom_id
        assert d.get(ResearchProject, pid).title == "User display name"
        assert d.get(ResearchProject, pid).on_board is True
        assert d.get(ResearchProject, legacy_pid).collection_id is None
        assert d.get(ResearchProject, loose_id).collection_id is None
        assert d.get(ResearchCollection, custom_id).description == "Keep this"
        assert d.get(ResearchCollection, legacy_collection)
        assert d.scalar(select(func.count(ResearchCollection.id))) == 2
        assert (
            d.scalar(
                select(ResearchProject.id).where(ResearchProject.session_id == sid)
            )
            == legacy_pid
        )
        assert (
            set(
                d.scalars(
                    select(ResearchEvent.id).where(
                        ResearchEvent.project_id == legacy_pid
                    )
                )
            )
            == event_ids
        )
        assert (
            set(
                d.scalars(
                    select(ResearchSprint.id).where(
                        ResearchSprint.project_id == legacy_pid
                    )
                )
            )
            == sprint_ids
        )
        assert (
            d.scalar(
                select(func.count(AgentSessionEntry.id)).where(
                    AgentSessionEntry.session_id == sid
                )
            )
            == 2
        )
        assert d.get(AgentRun, rid).response == "Legacy answer"
        assert (
            d.get(ResearchProject, legacy_pid).inherited_history["legacy_session_id"]
            == sid
        )
        assert d.scalar(select(func.count(AgentRun.id))) == 1
    engine.dispose()


def test_old_mapper_inserts_use_server_defaults_when_hub_schema_is_retained(env):
    from sqlalchemy import text
    from uuid import uuid4

    app, a, _, _ = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    wid, cid = str(uuid4()), str(uuid4())
    with app.state.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO research_workspaces (id,owner,name,description,instructions,kind,compute_id,model_config_id,archived,created_at,updated_at) VALUES (:id,:owner,'old mapper','','','research','','',false,'then','then')"
            ),
            {"id": wid, "owner": owner},
        )
        connection.execute(
            text(
                "INSERT INTO research_collections (id,owner,name,created_at,updated_at) VALUES (:id,:owner,'minimal','then','then')"
            ),
            {"id": cid, "owner": owner},
        )
    with app.state.maker() as d:
        assert d.get(ResearchWorkspace, wid).location == {}
        assert d.get(ResearchCollection, cid).description == ""
        assert d.get(ResearchCollection, cid).archived is False


@pytest.mark.parametrize("kind", ["local", "ssh"])
def test_bound_folder_locks_plan_and_compute_without_switching_execution(
    env, tmp_path, monkeypatch, kind
):
    from backend import (
        research_locations,
        research_remote,
        research_settings,
        research_stages,
    )

    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    expected = "host" if kind == "local" else "remote"
    location = {
        "kind": kind,
        "path": str(tmp_path),
        "connection_id": "remote" if kind == "ssh" else "",
    }
    monkeypatch.setattr(research_locations, "compute_for", lambda *_: expected)
    monkeypatch.setattr(
        research_settings,
        "compute",
        lambda _settings, cid: {
            "id": cid,
            "kind": "ssh" if cid == "remote" else "host",
        },
    )
    monkeypatch.setattr(
        research_remote,
        "pull",
        lambda *args, **kw: pytest.fail("A bound folder must not be moved"),
    )
    with app.state.maker() as d:
        w = research_workspaces.create(d, owner, "Bound folder", location=location)
        p = research_map.create_project(d, owner, "A bound question", "", model)
        p.workspace_id, p.stage, p.compute_id = w.id, "scoping", expected
        sprint = ResearchSprint(
            project_id=p.id, number=1, role="scoping", run_id="scope"
        )
        d.add(sprint)
        d.flush()
        args = {
            "question": p.question,
            "hypotheses": [{"title": "hypothesis", "kill_if": "no gain"}],
            "datasets": [],
            "metric": "accuracy",
            "summary": "plan",
            "compute_id": "other-machine",
            "budget": {"max_sprints": 3},
        }
        research_stages.propose_plan(settings, d, p, sprint, args)
        assert p.plan["compute_id"] == expected
        p.plan = {**p.plan, "compute_id": "other-machine"}
        with pytest.raises(ValueError, match="工作区目录"):
            research_stages.approve_plan(settings, d, p, 1)
        assert p.stage == "scoping" and len(research_map.nodes(d, p)) == 1
        research_stages.propose_plan(settings, d, p, sprint, args)
        research_stages.approve_plan(settings, d, p, 2)
        assert p.compute_id == expected
        pid = p.id
        d.commit()
    assert (
        a.post(
            f"{BASE}/projects/{pid}/compute", json={"compute_id": "other-machine"}
        ).status_code
        == 409
    )
    accepted = a.post(f"{BASE}/projects/{pid}/compute", json={"compute_id": expected})
    assert accepted.status_code == 200 and accepted.json()["compute_id"] == expected


def test_one_physical_folder_has_one_workspace_even_with_concurrent_requests(
    env, tmp_path
):
    app, a, _, _ = env
    folder = tmp_path / "shared-folder"
    folder.mkdir()
    body = {
        "name": "Same physical folder",
        "location": {"kind": "local", "path": str(folder)},
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: a.post(BASE + "/workspaces", json=body), range(2))
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchWorkspace.id))) == 1
