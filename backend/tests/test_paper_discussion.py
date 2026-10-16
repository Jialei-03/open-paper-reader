from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import NAMESPACE_URL, uuid5

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.main import create_app
from backend.models import AgentQuota, AgentRun, AgentSession
from backend.tests.test_acceptance import bearer, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure


def discussion(client, paper_id):
    response = client.post(f"/api/v1/papers/{paper_id}/discussion")
    assert response.status_code == 200, response.text
    return response.json()


def test_discussion_persists_across_app_restart_without_changing_existing_history(env):
    app, a, _, settings = env
    p = paper(a, "Paper title " * 20)
    generic = a.post("/api/v1/agent/sessions", json={"title": "Existing chat"}).json()
    saved = discussion(a, p["id"])
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    assert saved["title"] == p["title"][:100]
    assert saved["id"] != generic["id"]
    a.patch(f"/api/v1/agent/sessions/{saved['id']}", json={"title": "My discussion"})
    with app.state.maker() as d:
        for session_id in [saved["id"], generic["id"]]:
            d.add(
                AgentRun(
                    owner=owner,
                    session_id=session_id,
                    model_config_id="fixture",
                    model="fixture",
                    prompt="Question",
                    response="Saved answer",
                    status="completed",
                )
            )
        d.commit()

    restarted = create_app(settings)
    try:
        with TestClient(
            restarted, cookies=a.cookies, headers=dict(a.headers)
        ) as client:
            reopened = discussion(client, p["id"])
            assert reopened["id"] == saved["id"]
            assert reopened["title"] == "My discussion"
            for session_id in [saved["id"], generic["id"]]:
                runs = client.get(f"/api/v1/agent/sessions/{session_id}/runs").json()
                assert len(runs) == 1 and runs[0]["response"] == "Saved answer"
            assert len(client.get("/api/v1/agent/sessions").json()) == 2
    finally:
        restarted.state.engine.dispose()


def test_discussion_is_per_paper_and_owner_and_requires_human_csrf(env):
    app, a, b, _ = env
    first, second, foreign = paper(a), paper(a), paper(b)
    assert discussion(a, first["id"])["id"] != discussion(a, second["id"])["id"]
    assert discussion(b, foreign["id"])["id"] != discussion(a, first["id"])["id"]
    assert b.post(f"/api/v1/papers/{first['id']}/discussion").status_code == 404
    assert a.post("/api/v1/papers/missing/discussion").status_code == 404
    assert (
        a.post(
            f"/api/v1/papers/{first['id']}/discussion", headers={"X-CSRF-Token": ""}
        ).status_code
        == 403
    )
    agent, _ = bearer(app, a)
    try:
        assert agent.post(f"/api/v1/papers/{first['id']}/discussion").status_code == 403
    finally:
        agent.close()


def test_discussion_never_returns_session_owned_by_someone_else(env):
    app, a, b, _ = env
    p = paper(a)
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    foreign_owner = b.get("/api/v1/auth/me").json()["user"]["id"]
    session_id = str(uuid5(NAMESPACE_URL, f"paper-discussion:{owner}:{p['id']}"))
    with app.state.maker() as d:
        d.add(AgentSession(id=session_id, owner=foreign_owner, title="Private"))
        d.commit()
    response = a.post(f"/api/v1/papers/{p['id']}/discussion")
    assert response.status_code == 404 and "Private" not in response.text


def test_discussion_resolves_outside_recent_100_without_deleting_sessions(env):
    app, a, _, _ = env
    p = paper(a)
    original = discussion(a, p["id"])
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    with app.state.maker() as d:
        d.get(AgentSession, original["id"]).updated_at = "2000-01-01T00:00:00+00:00"
        d.add_all(AgentSession(owner=owner, title=f"Existing {i}") for i in range(100))
        d.commit()
    recent = a.get("/api/v1/agent/sessions").json()
    assert len(recent) == 100 and original["id"] not in {s["id"] for s in recent}
    assert discussion(a, p["id"])["id"] == original["id"]
    another = discussion(a, paper(a)["id"])
    assert another["id"] != original["id"]
    with app.state.maker() as d:
        assert d.scalar(select(func.count()).select_from(AgentSession)) == 102
    assert a.post("/api/v1/agent/sessions", json={}).status_code == 409


def test_concurrent_first_open_returns_one_discussion(env, monkeypatch):
    app, a, _, _ = env
    p = paper(a)
    barrier = Barrier(2)
    commit = Session.commit

    def synchronized_commit(session):
        if any(isinstance(row, AgentSession) for row in session.new):
            barrier.wait(timeout=10)
        return commit(session)

    monkeypatch.setattr(Session, "commit", synchronized_commit)

    def open_discussion(_):
        with TestClient(app, cookies=a.cookies, headers=dict(a.headers)) as client:
            return discussion(client, p["id"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        opened = list(pool.map(open_discussion, range(2)))
    assert opened[0]["id"] == opened[1]["id"]
    with app.state.maker() as d:
        assert d.scalar(select(func.count()).select_from(AgentSession)) == 1


def test_paper_discussions_do_not_consume_generic_session_quota(env):
    app, a, _, _ = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    discussion(a, paper(a)["id"])
    discussion(a, paper(a)["id"])
    with app.state.maker() as d:
        d.add_all(AgentSession(owner=owner) for _ in range(99))
        d.commit()
    assert a.post("/api/v1/agent/sessions", json={}).status_code == 200
    assert a.post("/api/v1/agent/sessions", json={}).status_code == 409


def test_paper_discussion_continues_after_50_rounds_but_keeps_execution_limits(env):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    settings.agent_active_limit = 1
    settings.agent_daily_runs = 100
    p = paper(a)
    canonical = discussion(a, p["id"])["id"]
    generic = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    with app.state.maker() as d:
        for session_id in [canonical, generic]:
            d.add_all(
                AgentRun(
                    owner=owner,
                    session_id=session_id,
                    model_config_id=model,
                    model="fixture",
                    prompt=f"Question {i}",
                    response=f"Answer {i}",
                    status="completed",
                )
                for i in range(50)
            )
        d.commit()
    body = {
        "prompt": "Continue",
        "model_config_id": model,
        "context": f"paper/{p['id']}",
    }
    # Supplying a real owned paper route must not bypass a generic session's cap.
    assert (
        a.post(f"/api/v1/agent/sessions/{generic}/runs", json=body).status_code == 409
    )
    accepted = a.post(f"/api/v1/agent/sessions/{canonical}/runs", json=body)
    assert accepted.status_code == 200, accepted.text
    history = a.get(f"/api/v1/agent/sessions/{canonical}/runs").json()
    assert len(history) == 51
    assert history[0]["response"] == "Answer 0"
    # Canonical identity survives navigation away from the reader too.
    body["context"] = "library"
    assert (
        a.post(f"/api/v1/agent/sessions/{canonical}/runs", json=body).status_code == 409
    )
    a.post(f"/api/v1/agent/runs/{accepted.json()['id']}/cancel")
    with app.state.maker() as d:
        quota = d.get(AgentQuota, owner)
        assert quota.runs == 1
        quota.runs = 100
        d.commit()
    assert (
        a.post(f"/api/v1/agent/sessions/{canonical}/runs", json=body).status_code == 429
    )


def test_manual_paper_sessions_are_scoped_and_do_not_change_default(env):
    _, a, b, _ = env
    first, second, foreign = paper(a), paper(a), paper(b)
    canonical = discussion(a, first["id"])
    extra = a.post(
        "/api/v1/agent/sessions",
        json={"paper_id": first["id"], "title": "Second topic"},
    )
    assert extra.status_code == 200
    extra = extra.json()
    assert discussion(a, first["id"])["id"] == canonical["id"]
    assert {
        s["id"] for s in a.get(f"/api/v1/agent/sessions?paper_id={first['id']}").json()
    } == {canonical["id"], extra["id"]}
    assert a.get(f"/api/v1/agent/sessions?paper_id={second['id']}").json() == []
    assert b.get(f"/api/v1/agent/sessions?paper_id={first['id']}").status_code == 404
    assert (
        a.post("/api/v1/agent/sessions", json={"paper_id": foreign["id"]}).status_code
        == 404
    )
    assert a.delete(f"/api/v1/agent/sessions/{extra['id']}").status_code == 200
    assert discussion(a, first["id"])["id"] == canonical["id"]


def test_legacy_canonical_session_remains_in_paper_scope(env):
    app, a, _, _ = env
    p = paper(a)
    original = discussion(a, p["id"])
    with app.state.maker() as d:
        d.get(AgentSession, original["id"]).paper_id = None
        d.commit()
    rows = a.get(f"/api/v1/agent/sessions?paper_id={p['id']}").json()
    assert [s["id"] for s in rows] == [original["id"]]
