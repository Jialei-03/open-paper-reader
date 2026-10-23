"""Project thread organization never changes a research's execution permissions."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from backend import research_chat, research_map, research_workspaces
from backend.models import (
    AgentRun,
    AgentSession,
    AgentSessionEntry,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure

WS = "/api/v1/research/workspaces"
SESSIONS = "/api/v1/agent/sessions"


@pytest.fixture
def env(cloud_env, monkeypatch):  # noqa: F811
    """Exercise existing mentor/chat data, created only by this legacy fixture."""
    cloud_env[3].mode = "local"
    original = research_workspaces.create

    def legacy_workspace(*args, **kwargs):
        workspace = original(*args, **kwargs)
        research_chat.main_session(args[0], workspace)
        return workspace

    monkeypatch.setattr(research_workspaces, "create", legacy_workspace)
    return cloud_env


def project(client):
    response = client.post(WS, json={"name": "模型压缩"})
    assert response.status_code == 200, response.text
    return response.json()


def new_chat(client, wid, title="新对话"):
    # Ordinary project chats are legacy objects; the new UI creates research.
    owner = client.get("/api/v1/auth/me").json()["user"]["id"]
    with client.app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        session = research_chat.new_session(d, owner, workspace, title)
        d.commit()
        sid = session.id
    return client.get(f"{SESSIONS}/{sid}").json()


def test_empty_chat_and_visible_metadata_have_no_model_cost(env):
    app, a, b, _settings = env
    w = project(a)
    page = a.get(f"{WS}/{w['id']}/sessions").json()
    [main] = page["items"]
    assert main["kind"] == "project_lead" and main["pinned_at"]
    assert main["capabilities"]["coordinate"] is True
    assert main["capabilities"]["archive"] is False
    chat = new_chat(a, w["id"])
    assert chat["kind"] == "project_chat" and chat["active_run_id"] is None
    assert chat["capabilities"]["send"] and not chat["capabilities"]["coordinate"]
    named = a.patch(f"{SESSIONS}/{chat['id']}", json={"title": "量化讨论"})
    assert named.status_code == 200 and named.json()["title"] == "量化讨论"
    assert a.get(f"{SESSIONS}/{chat['id']}").json()["title"] == "量化讨论"
    assert (
        a.patch(f"{SESSIONS}/{main['id']}", json={"title": "压缩导师"}).json()["title"]
        == "压缩导师"
    )
    assert b.get(f"{WS}/{w['id']}/sessions").status_code == 404
    assert b.post(f"{WS}/{w['id']}/sessions", json={}).status_code == 404
    assert b.get(f"{SESSIONS}/{chat['id']}").status_code == 404
    assert b.patch(f"{SESSIONS}/{chat['id']}", json={"pinned": True}).status_code == 404
    assert (
        a.patch(f"{SESSIONS}/{chat['id']}", json={"kind": "project_lead"}).status_code
        == 422
    )
    with app.state.maker() as d:
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        assert d.scalar(select(func.count(ResearchProject.id))) == 0


def test_project_threads_can_be_pinned_searched_and_paged(env):
    _app, a, _b, _settings = env
    w = project(a)
    chats = [
        new_chat(a, w["id"], title) for title in ("量化", "蒸馏", "剪枝", "100% 基线")
    ]
    chosen = chats[0]["id"]
    assert a.patch(f"{SESSIONS}/{chosen}", json={"pinned": True}).status_code == 200
    first = a.get(f"{WS}/{w['id']}/sessions", params={"limit": 2}).json()
    assert first["items"][0]["id"] == chosen and first["next_cursor"]
    ids = [r["id"] for r in first["items"]]
    cursor = first["next_cursor"]
    while cursor:
        page = a.get(
            f"{WS}/{w['id']}/sessions", params={"limit": 2, "cursor": cursor}
        ).json()
        ids.extend(r["id"] for r in page["items"])
        cursor = page["next_cursor"]
    assert len(ids) == len(set(ids)) == 5
    assert set(ids) == {w["session_id"], *(c["id"] for c in chats)}
    found = a.get(f"{WS}/{w['id']}/sessions", params={"search": "%"}).json()
    assert [r["title"] for r in found["items"]] == ["100% 基线"]
    a.patch(f"{SESSIONS}/{chosen}", json={"pinned": False})
    assert a.get(f"{WS}/{w['id']}/sessions").json()["items"][0]["id"] == w["session_id"]
    assert (
        a.get(f"{WS}/{w['id']}/sessions", params={"cursor": "bad"}).status_code == 422
    )


def test_archive_is_reversible_and_main_follows_its_project(env):
    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    w = project(a)
    chat = new_chat(a, w["id"], "候选方法")
    response = a.patch(f"{SESSIONS}/{chat['id']}", json={"archived": True})
    assert response.status_code == 200 and response.json()["archived_at"]
    assert not response.json()["capabilities"]["send"]
    assert chat["id"] not in {
        r["id"] for r in a.get(f"{WS}/{w['id']}/sessions").json()["items"]
    }
    archived = a.get(f"{WS}/{w['id']}/sessions", params={"archived": True}).json()[
        "items"
    ]
    assert [r["id"] for r in archived] == [chat["id"]]
    blocked = a.post(
        f"/api/v1/research/chats/{chat['id']}/messages",
        json={"message": "继续", "model_config_id": model},
    )
    assert blocked.status_code == 409
    restored = a.patch(f"{SESSIONS}/{chat['id']}", json={"archived": False}).json()
    assert restored["archived_at"] is None and restored["capabilities"]["send"]
    assert (
        a.patch(f"{SESSIONS}/{w['session_id']}", json={"archived": True}).status_code
        == 409
    )
    assert a.patch(f"{WS}/{w['id']}", json={"archived": True}).status_code == 200
    main = a.get(f"{SESSIONS}/{w['session_id']}").json()
    assert main["archived_at"] and not main["capabilities"]["coordinate"]
    assert a.post(f"{WS}/{w['id']}/sessions", json={}).status_code == 410
    assert a.patch(f"{WS}/{w['id']}", json={"archived": False}).status_code == 200
    assert a.get(f"{SESSIONS}/{w['session_id']}").json()["archived_at"] is None
    with app.state.maker() as d:
        assert d.get(AgentSession, chat["id"]) is not None


def test_busy_chat_archive_refuses_until_the_answer_stops(env):
    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    w = project(a)
    chat = new_chat(a, w["id"])
    response = a.post(
        f"/api/v1/research/chats/{chat['id']}/messages",
        json={"message": "分析量化", "model_config_id": model},
    )
    assert response.status_code == 200, response.text
    run_id = response.json()["active_run_id"]
    assert run_id
    assert (
        a.patch(f"{SESSIONS}/{chat['id']}", json={"archived": True}).status_code == 409
    )
    with app.state.maker() as d:
        assert d.get(AgentRun, run_id).status == "queued"
        assert d.get(AgentSession, chat["id"]).archived_at is None
    assert a.post(f"/api/v1/agent/runs/{run_id}/cancel", json={}).status_code == 200
    assert (
        a.patch(f"{SESSIONS}/{chat['id']}", json={"archived": True}).status_code == 200
    )
    assert a.delete(f"{SESSIONS}/{chat['id']}").status_code == 200


def test_main_clone_has_history_and_explicit_read_only_project_identity(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    w = project(a)
    with app.state.maker() as d:
        run = AgentRun(
            owner=owner,
            session_id=w["session_id"],
            model_config_id=model,
            model="MiniMax-M3",
            prompt="项目问题",
            response="项目答案",
            status="completed",
        )
        d.add(run)
        d.flush()
        d.add(
            AgentSessionEntry(
                session_id=w["session_id"],
                seq=1,
                entry={
                    "type": "message",
                    "id": "first",
                    "parentId": None,
                    "message": {"role": "user", "content": "项目问题", "timestamp": 0},
                },
            )
        )
        d.commit()
        source_run_id = run.id
    response = a.post(f"/api/v1/research/chats/{w['session_id']}/clone", json={})
    assert response.status_code == 200, response.text
    clone = response.json()
    assert clone["kind"] == "project_chat" and not clone["capabilities"]["coordinate"]
    assert (
        clone["source_session_id"] == w["session_id"]
        and clone["source_run_id"] == source_run_id
    )
    assert clone["pinned_at"] is None and clone["archived_at"] is None
    with app.state.maker() as d:
        assert (
            d.scalar(
                select(AgentSessionEntry.entry).where(
                    AgentSessionEntry.session_id == clone["id"]
                )
            )["id"]
            == "first"
        )
    sent = a.post(
        f"/api/v1/research/chats/{clone['id']}/messages",
        json={"message": "继续", "model_config_id": model},
    )
    assert sent.status_code == 200, sent.text
    with app.state.maker() as d:
        last = d.scalars(
            select(AgentRun)
            .where(AgentRun.session_id == clone["id"])
            .order_by(AgentRun.created_at.desc())
        ).first()
        assert last.runtime["research"]["role"] == "chat" and last.writable is False


@pytest.mark.parametrize(
    "statuses", [["completed", "cancelled"], ["cancelled"], ["failed"]]
)
def test_clone_preserves_all_terminal_turns_and_pi_memory(env, statuses):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    w = project(a)
    source = new_chat(a, w["id"], "原讨论")
    original_entries = []
    with app.state.maker() as d:
        runs = []
        for index, status in enumerate(statuses):
            messages = [
                {"id": f"user-{index}", "role": "user", "text": f"问题 {index}"},
                {
                    "id": f"assistant-{index}",
                    "role": "assistant",
                    "text": f"部分回答 {index}",
                },
            ]
            run = AgentRun(
                owner=owner,
                session_id=source["id"],
                model_config_id=model,
                model="MiniMax-M3",
                prompt=f"问题 {index}",
                response=f"部分回答 {index}",
                status=status,
                error="服务暂时失败" if status == "failed" else "",
                created_at=f"2026-01-01T00:00:0{index}+00:00",
                runtime={
                    "conversation_messages": messages,
                    "messages": messages,
                    "phase": "stopping",
                    "since": "2026-01-01T00:00:00+00:00",
                    "stop_requested_at": "2026-01-01T00:00:00+00:00",
                    "settled": True,
                    "abort_confirmed": True,
                    "stop_forced": False,
                },
            )
            d.add(run)
            d.flush()
            runs.append(run)
            for message in messages:
                entry = {
                    "type": "message",
                    "id": message["id"],
                    "parentId": (
                        original_entries[-1]["id"] if original_entries else None
                    ),
                    "message": {
                        "role": message["role"],
                        "content": message["text"],
                        "timestamp": 0,
                    },
                }
                original_entries.append(entry)
                d.add(
                    AgentSessionEntry(
                        session_id=source["id"], seq=len(original_entries), entry=entry
                    )
                )
        d.commit()
        last_id = runs[-1].id
    response = a.post(f"/api/v1/research/chats/{source['id']}/clone", json={})
    assert response.status_code == 200, response.text
    clone = response.json()
    assert (
        clone["source_session_id"] == source["id"] and clone["source_run_id"] == last_id
    )
    assert clone["last_run_status"] == statuses[-1] and clone["status"] == "idle"
    copied = a.get(f"{SESSIONS}/{clone['id']}/runs").json()
    assert [run["status"] for run in copied] == statuses
    assert [run["prompt"] for run in copied] == [
        f"问题 {i}" for i in range(len(statuses))
    ]
    for index, run in enumerate(copied):
        assert run["runtime"]["conversation_messages"][1]["text"] == f"部分回答 {index}"
        assert run["runtime"]["messages"] == run["runtime"]["conversation_messages"]
        assert (
            not {
                "since",
                "stop_requested_at",
                "abort_confirmed",
                "stop_forced",
                "settled",
            }
            & run["runtime"].keys()
        )
        assert run["runtime"]["phase"] == statuses[index]
    with app.state.maker() as d:
        entries = list(
            d.scalars(
                select(AgentSessionEntry.entry)
                .where(AgentSessionEntry.session_id == clone["id"])
                .order_by(AgentSessionEntry.seq)
            )
        )
        assert entries == original_entries
        assert d.get(AgentRun, last_id).runtime["phase"] == "stopping"


@pytest.mark.parametrize(
    "blocker", ["run", "active", "waiting", "job", "retrospective"]
)
def test_archiving_a_project_refuses_all_background_work(env, blocker):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    w = project(a)
    with app.state.maker() as d:
        if blocker == "run":
            d.add(
                AgentRun(
                    owner=owner,
                    session_id=w["session_id"],
                    model_config_id=model,
                    model="MiniMax-M3",
                    prompt="正在回答",
                    status="running",
                )
            )
        else:
            research = research_map.create_project(d, owner, "后台研究", "", model)
            research.workspace_id = w["id"]
            research.status = blocker if blocker in {"active", "waiting"} else "paused"
            if blocker == "retrospective":
                research.status, research.stage = "finished", "retrospective"
            if blocker == "job":
                sprint = ResearchSprint(
                    project_id=research.id, number=1, run_id="old", status="ended"
                )
                d.add(sprint)
                d.flush()
                d.add(
                    ResearchJob(
                        project_id=research.id,
                        sprint_id=sprint.id,
                        node_id=research_map.root(d, research).id,
                        command="python train.py",
                        status="running",
                    )
                )
        d.commit()
        before = d.scalar(select(func.count(AgentRun.id)))
    refused = a.patch(f"{WS}/{w['id']}", json={"archived": True})
    assert refused.status_code == 409, refused.text
    with app.state.maker() as d:
        assert d.get(ResearchWorkspace, w["id"]).archived is False
        assert d.scalar(select(func.count(AgentRun.id))) == before


def test_archived_project_is_readable_but_cannot_be_reactivated(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    w = project(a)
    chat = new_chat(a, w["id"])
    with app.state.maker() as d:
        research = research_map.create_project(d, owner, "暂停的研究", "", model)
        research.workspace_id, research.status = w["id"], "paused"
        d.commit()
        pid = research.id
    assert a.patch(f"{WS}/{w['id']}", json={"archived": True}).status_code == 200
    for suffix in ("", "/events", "/runs", "/decisions"):
        assert a.get(f"/api/v1/research/projects/{pid}{suffix}").status_code == 200
    for suffix, body in (
        ("/resume", {}),
        ("/messages", {"text": "继续研究"}),
        ("/limits", {}),
        ("/question", {"question": "新问题"}),
        ("/model", {"model_config_id": model}),
        ("/compute", {"compute_id": "local"}),
        ("/plan/approve", {"version": 1}),
        ("/decisions/missing", {"approve": True}),
    ):
        result = a.post(f"/api/v1/research/projects/{pid}{suffix}", json=body)
        assert result.status_code == 409, (suffix, result.text)
    for session_id in (w["session_id"], chat["id"]):
        result = a.post(
            f"/api/v1/research/chats/{session_id}/messages",
            json={"message": "继续", "model_config_id": model},
        )
        assert result.status_code == 409, result.text
    result = a.post(
        "/api/v1/research/projects",
        json={
            "question": "偷建研究",
            "model_config_id": model,
            "workspace_id": w["id"],
        },
    )
    assert result.status_code == 409, result.text
    with app.state.maker() as d:
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        assert d.scalar(select(func.count(ResearchProject.id))) == 1
    assert a.patch(f"{WS}/{w['id']}", json={"archived": False}).status_code == 200
    assert a.post(f"/api/v1/research/projects/{pid}/resume", json={}).status_code == 200


def test_project_archive_and_a_new_main_turn_cannot_both_succeed(env):
    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    w = project(a)
    barrier = threading.Barrier(2)

    def ask():
        barrier.wait()
        return a.post(
            f"/api/v1/research/chats/{w['session_id']}/messages",
            json={"message": "分析项目", "model_config_id": model},
        )

    def archive():
        barrier.wait()
        return a.patch(f"{WS}/{w['id']}", json={"archived": True})

    with ThreadPoolExecutor(max_workers=2) as pool:
        answer, archived = pool.submit(ask), pool.submit(archive)
        answer, archived = answer.result(), archived.result()
    assert sorted([answer.status_code, archived.status_code]) == [200, 409], (
        answer.text,
        archived.text,
    )
    with app.state.maker() as d:
        saved = d.get(ResearchWorkspace, w["id"])
        runs = d.scalar(select(func.count(AgentRun.id)))
        assert (saved.archived, runs) == (
            (True, 0) if archived.status_code == 200 else (False, 1)
        )


def test_research_threads_are_listed_but_keep_their_own_lifecycle(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    w = project(a)
    other = project(a)
    with app.state.maker() as d:
        research = research_map.create_project(
            d, owner, "相同精度下量化能快多少", "", model
        )
        research.workspace_id = w["id"]
        foreign = research_map.create_project(d, owner, "别的项目问题", "", model)
        foreign.workspace_id = other["id"]
        d.commit()
        pid, sid, foreign_sid = research.id, research.session_id, foreign.session_id
    rows = a.get(f"{WS}/{w['id']}/sessions", params={"search": "相同精度"}).json()[
        "items"
    ]
    [item] = rows
    assert (
        item["id"] == sid and item["research_id"] == pid and item["kind"] == "research"
    )
    assert not item["capabilities"]["send"] and not item["capabilities"]["compact"]
    assert a.patch(f"{SESSIONS}/{sid}", json={"title": "偷偷改问题"}).status_code == 409
    assert a.patch(f"{SESSIONS}/{sid}", json={"archived": True}).status_code == 409
    assert a.delete(f"{SESSIONS}/{sid}").status_code == 409
    assert (
        a.post(
            f"{SESSIONS}/{sid}/runs",
            json={"prompt": "绕过研究", "model_config_id": model},
        ).status_code
        == 409
    )
    assert foreign_sid not in {
        r["id"] for r in a.get(f"{WS}/{w['id']}/sessions").json()["items"]
    }
    assert sid not in {r["id"] for r in a.get(SESSIONS).json()}
    with app.state.maker() as d:
        d.get(ResearchProject, pid).status = "paused"
        d.commit()
    assert a.patch(f"{SESSIONS}/{sid}", json={"archived": True}).status_code == 409
    with app.state.maker() as d:
        research = d.get(ResearchProject, pid)
        research.status, research.stage = "finished", "retrospective"
        d.commit()
    assert a.patch(f"{SESSIONS}/{sid}", json={"archived": True}).status_code == 409
    with app.state.maker() as d:
        research = d.get(ResearchProject, pid)
        research.stage = "done"
        sprint = ResearchSprint(project_id=pid, number=1, run_id="old", status="ended")
        d.add(sprint)
        d.flush()
        job = ResearchJob(
            project_id=pid,
            sprint_id=sprint.id,
            node_id=research_map.root(d, research).id,
            command="python train.py",
            status="running",
        )
        d.add(job)
        d.commit()
        job_id = job.id
    assert a.patch(f"{SESSIONS}/{sid}", json={"archived": True}).status_code == 409
    with app.state.maker() as d:
        d.get(ResearchJob, job_id).status = "succeeded"
        d.commit()
    archived = a.patch(f"{SESSIONS}/{sid}", json={"archived": True})
    assert archived.status_code == 200 and archived.json()["status"] == "finished"
    with app.state.maker() as d:
        assert d.get(ResearchProject, pid).status == "finished"


def test_global_search_finds_projects_and_threads_without_crossing_visibility(env):
    app, a, b, settings = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    w = project(a)
    visible = new_chat(a, w["id"], "量化方法")
    archived_chat = new_chat(a, w["id"], "量化旧讨论")
    a.patch(f"{SESSIONS}/{archived_chat['id']}", json={"archived": True})
    hidden_project = project(a)
    hidden_chat = new_chat(a, hidden_project["id"], "量化隐藏讨论")
    a.patch(f"{WS}/{hidden_project['id']}", json={"archived": True})
    outsider = project(b)
    with app.state.maker() as d:
        research = research_map.create_project(d, owner, "低比特的吞吐量", "", "m")
        research.workspace_id = w["id"]
        artifact = AgentSession(
            owner=owner, workspace_id=w["id"], kind="artifact", title="量化导读"
        )
        d.add(artifact)
        d.commit()
        research_id, artifact_id = research.id, artifact.id
    assert (
        a.patch(f"{SESSIONS}/{artifact_id}", json={"archived": True}).status_code == 409
    )
    assert (
        a.post(
            f"{SESSIONS}/{artifact_id}/runs",
            json={"prompt": "手动接管", "model_config_id": "m"},
        ).status_code
        == 409
    )
    found = a.get("/api/v1/research/sessions", params={"search": "低比特"}).json()
    assert len(found["items"]) == 1
    assert found["items"][0]["research_id"] == research_id
    assert found["items"][0]["workspace_name"] == w["name"]
    assert found["items"][0]["workspace_id"] == w["id"]
    project_hits = a.get(
        "/api/v1/research/sessions", params={"search": w["name"]}
    ).json()["items"]
    assert w["session_id"] in {r["id"] for r in project_hits}
    page = a.get("/api/v1/research/sessions", params={"limit": 2}).json()
    rows = page["items"]
    while page["next_cursor"]:
        page = a.get(
            "/api/v1/research/sessions",
            params={"limit": 2, "cursor": page["next_cursor"]},
        ).json()
        rows.extend(page["items"])
    ids = {r["id"] for r in rows}
    assert len(ids) == len(rows) == 3
    assert visible["id"] in ids and w["session_id"] in ids
    assert not ids & {
        archived_chat["id"],
        hidden_chat["id"],
        hidden_project["session_id"],
        outsider["session_id"],
        artifact_id,
    }
    assert (
        b.get("/api/v1/research/sessions", params={"search": "低比特"}).json()["items"]
        == []
    )
    assert (
        a.get("/api/v1/research/sessions", params={"cursor": "bad"}).status_code == 422
    )
    with app.state.maker() as d:
        assert d.scalar(select(func.count(AgentRun.id))) == 0
    settings.mode = "cloud"
    assert a.get("/api/v1/research/sessions").status_code == 403


def test_session_metadata_migration_preserves_existing_history(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    from backend.config import Settings, database
    from backend.models import Base, User

    url = "sqlite:///" + str(tmp_path / "sessions.db")
    monkeypatch.setenv("DATABASE_URL", url)
    engine, maker = database(
        Settings(database_url=url, storage=str(tmp_path / "files"), testing=True)
    )
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="old", password="x")
        d.add(user)
        d.flush()
        workspace = research_workspaces.create(d, user.id, "旧项目")
        research_chat.main_session(d, workspace)
        chat = AgentSession(owner=user.id, workspace_id=workspace.id, title="旧讨论")
        d.add(chat)
        research = research_map.create_project(d, user.id, "旧研究", "", "m")
        research.workspace_id = workspace.id
        d.flush()
        d.add(
            AgentSessionEntry(
                session_id=chat.id, seq=1, entry={"type": "message", "id": "kept"}
            )
        )
        d.commit()
        wid, cid, rid = workspace.id, chat.id, research.session_id
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        connection.execute(text("DROP TABLE agent_controls"))
        operations = Operations(MigrationContext.configure(connection))
        with operations.batch_alter_table("agent_sessions") as batch:
            for name in (
                "kind",
                "source_session_id",
                "source_run_id",
                "pinned_at",
                "archived_at",
            ):
                batch.drop_column(name)
        connection.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        connection.execute(text("INSERT INTO alembic_version VALUES ('0034')"))
        connection.commit()
    command.upgrade(Config(toml_file="pyproject.toml"), "0035")
    with maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        assert d.get(AgentSession, workspace.session_id).kind == "project_lead"
        assert d.get(AgentSession, workspace.session_id).pinned_at
        assert d.get(AgentSession, cid).kind == "project_chat"
        assert d.get(AgentSession, rid).kind == "research"
        assert (
            d.scalar(
                select(AgentSessionEntry.entry).where(
                    AgentSessionEntry.session_id == cid
                )
            )["id"]
            == "kept"
        )
    engine.dispose()
