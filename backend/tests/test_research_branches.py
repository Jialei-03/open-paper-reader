"""A research fork is an exact historical boundary with no inherited execution."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from backend import research_branches as branches
from backend import research_map as rm
from backend import research_repo as rr
from backend import research_stages as stages
from backend import research_workspaces as rw
from backend.models import (
    AgentRun,
    AgentSession,
    AgentSessionEntry,
    ResearchEvent,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure

API = "/api/v1/research/projects"
pytestmark = pytest.mark.skipif(not rr.available(), reason="Git required")


@pytest.fixture
def env(cloud_env):  # noqa: F811
    cloud_env[3].mode = "local"
    return cloud_env


def sealed(env, *, evidence=False, finished=False):
    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = rw.create(d, owner, "Fork workspace")
        p = rm.create_project(
            d, owner, "Round-one question", "Original background", model
        )
        p.workspace_id = workspace.id
        p.stage = "experiments"
        p.plan = {"version": 2, "approved_at": "before", "goal": "old goal"}
        root = rm.root(d, p)
        h = rm.add_node(
            d,
            p,
            root.id,
            "hypothesis",
            "First hypothesis",
            kill_if="bad result",
            actor="human",
            reason="test",
        )
        stages.say(d, p, "human", "Only first-round guidance")
        rm.event(
            d,
            p,
            h,
            "advisor",
            "decision_requested",
            {"kind": "budget", "proposal": "continue", "reason": "historical only"},
        )
        run = AgentRun(
            owner=owner,
            session_id=p.session_id,
            model_config_id=model,
            model="test",
            prompt="first round",
            status="completed",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=p.id,
            number=1,
            run_id=run.id,
            status="ended",
            summary="first handoff",
        )
        d.add(sprint)
        d.flush()
        if evidence:
            from backend import research_sandbox

            job = ResearchJob(
                project_id=p.id,
                node_id=h.id,
                sprint_id=sprint.id,
                command="measure",
                status="succeeded",
                log_lines=1,
            )
            d.add(job)
            d.flush()
            (research_sandbox.logdir(settings, p.id) / f"{job.id}.log").write_text(
                "accuracy=0.982\n"
            )
            h.evidence_for = [
                {
                    "summary": "accuracy 0.982",
                    "sprint_id": sprint.id,
                    "evidence": [
                        {
                            "kind": "log",
                            "job_id": job.id,
                            "from_line": 1,
                            "to_line": 1,
                            "lines": ["accuracy=0.982"],
                        }
                    ],
                }
            ]
        if finished:
            root.status = "supported"
            p.status, p.stage = "finished", "done"
        work = rr.adopt(settings, workspace, p)
        (work / "train.py").write_text("print('round one')\n")
        assert branches.capture_round(settings, d, p, sprint)
        d.commit()
        return workspace.id, p.id, sprint.id, sprint.commit_sha, work


def request(sid, sha, **kw):
    return {
        "sprint_id": sid,
        "expected_commit": sha,
        "change": "Try another hypothesis",
        "client_id": str(uuid4()),
        **kw,
    }


def test_fork_is_exact_independent_paused_history_and_never_replays_approval(env):
    app, a, _, settings = env
    wid, pid, sid, sha, source_work = sealed(env)
    collection = a.post(
        "/api/v1/research/collections", json={"name": "Current classification"}
    ).json()
    organized = a.patch(
        f"{API}/{pid}/organization",
        json={
            "title": "Renamed source",
            "collection_id": collection["id"],
            "on_board": True,
            "pinned": True,
        },
    )
    assert organized.status_code == 200, organized.text
    # Move both map and source worktree past the selected historical boundary.
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        before = deepcopy(d.get(ResearchSprint, sid).snapshot)
        p.question, p.background = "Today's question", "Today's background"
        rm.root(d, p).title = "Today's root"
        rm.add_node(
            d,
            p,
            rm.root(d, p).id,
            "finding",
            "Too late for the fork",
            actor="executor",
            reason="later",
        )
        stages.say(d, p, "human", "A later message")
        d.add(
            AgentSessionEntry(
                session_id=p.session_id,
                seq=0,
                entry={"type": "message", "text": "source memory"},
            )
        )
        d.add(
            ResearchJob(
                project_id=pid,
                node_id=rm.root(d, p).id,
                sprint_id=sid,
                command="experiment",
                status="succeeded",
            )
        )
        d.commit()
    (source_work / "train.py").write_text("print('later code')\n")
    body = request(sid, sha)
    response = a.post(f"{API}/{pid}/forks", json=body)
    assert response.status_code == 200, response.text
    child = response.json()
    cid = child["id"]
    assert child["status"] == "paused" and child["stage"] == "scoping"
    assert child["title"] == "Renamed source · 分叉"
    assert child["collection_id"] == collection["id"]
    assert child["on_board"] is False
    assert [row["id"] for row in a.get("/api/v1/research/board").json()["cards"]] == [
        pid
    ]
    assert (
        child["question"] == "Round-one question"
        and child["background"] == "Original background"
    )
    assert child["parent_id"] == pid and child["forked_from"]["commit"] == sha
    assert child["forked_from"]["source_session_id"] != child["session_id"]
    assert child["spent"] == {"tokens": 0, "sprints": 0, "job_seconds": 0}
    assert child["plan"]["approved_at"] is None and child["plan"]["inherited"] is True
    assert child["budget"]["auto_decide"] is False
    assert a.get(f"{API}/{cid}/decisions").json() == []
    assert a.post(f"{API}/{cid}/plan/approve", json={"version": 2}).status_code == 409
    detail = a.get(f"{API}/{cid}").json()
    assert {n["title"] for n in detail["nodes"]} == {
        "Round-one question",
        "First hypothesis",
    }
    old_messages = [
        e["detail"].get("text")
        for e in detail["inherited_history"]["events"]
        if e["action"] == "message"
    ]
    assert old_messages == ["Only first-round guidance"]
    assert detail["inherited_history"]["sprints"][0]["summary"] == "first handoff"
    assert detail["sprints"] == [] and detail["jobs"] == []
    with app.state.maker() as d:
        p = d.get(ResearchProject, cid)
        session = d.get(AgentSession, p.session_id)
        assert session.kind == "research" and session.source_run_id
        assert session.title == child["title"] and session.pinned_at is None
        assert (
            d.scalar(
                select(func.count(AgentSessionEntry.id)).where(
                    AgentSessionEntry.session_id == session.id
                )
            )
            == 0
        )
        assert (
            d.scalar(
                select(func.count(AgentRun.id)).where(AgentRun.session_id == session.id)
            )
            == 0
        )
        assert stages.unanswered(d, p) == [body["change"]]
        assert any(
            e.detail.get("text") == "Only first-round guidance"
            for e in stages.conversation(d, p)
        )
        assert d.get(ResearchSprint, sid).snapshot == before
        assert d.get(ResearchProject, pid).question == "Today's question"
        assert (
            rr.thread_dir(settings, wid, cid) / "train.py"
        ).read_text() == "print('round one')\n"
        assert rr.head(rr.thread_dir(settings, wid, cid)) == sha
    assert (source_work / "train.py").read_text() == "print('later code')\n"
    row = next(
        r
        for r in a.get(f"/api/v1/research/workspaces/{wid}/sessions").json()["items"]
        if r["research_id"] == cid
    )
    assert row["kind"] == "research" and row["parent_id"] == pid


def test_options_validate_legacy_live_mismatched_and_exact_round(env):
    app, a, _, _ = env
    _, pid, sid, sha, _ = sealed(env)
    with app.state.maker() as d:
        legacy = ResearchSprint(
            project_id=pid, number=2, run_id="legacy", status="ended", commit_sha=sha
        )
        live = ResearchSprint(project_id=pid, number=3, run_id="live", status="running")
        d.add_all([legacy, live])
        d.commit()
        legacy_id, live_id = legacy.id, live.id
    page = a.get(f"{API}/{pid}/forks/options").json()
    assert page["can_fork"]
    rounds = {r["sprint_id"]: r for r in page["rounds"]}
    assert (
        rounds[sid]["available"]
        and not rounds[legacy_id]["available"]
        and not rounds[live_id]["available"]
    )
    assert a.post(f"{API}/{pid}/forks", json=request(legacy_id, sha)).status_code == 409
    assert a.post(f"{API}/{pid}/forks", json=request(live_id, sha)).status_code == 409
    assert a.post(f"{API}/{pid}/forks", json=request(sid, "0" * 40)).status_code == 409
    with app.state.maker() as d:
        d.get(ResearchSprint, sid).commit_sha = "0" * 40
        d.commit()
    page = a.get(f"{API}/{pid}/forks/options").json()
    assert not page["can_fork"]
    assert a.post(f"{API}/{pid}/forks", json=request(sid, sha)).status_code == 409


def test_owner_archive_and_sprint_scope_are_enforced(env):
    app, a, b, _ = env
    wid, pid, sid, sha, _ = sealed(env)
    assert b.get(f"{API}/{pid}/forks/options").status_code == 404
    assert b.post(f"{API}/{pid}/forks", json=request(sid, sha)).status_code == 404
    assert (
        a.post(f"{API}/{pid}/forks", json=request(str(uuid4()), sha)).status_code == 409
    )
    with app.state.maker() as d:
        d.get(ResearchWorkspace, wid).archived = True
        d.commit()
    assert not a.get(f"{API}/{pid}/forks/options").json()["can_fork"]
    assert a.post(f"{API}/{pid}/forks", json=request(sid, sha)).status_code == 409
    assert a.get(f"{API}/{pid}").status_code == 200
    with app.state.maker() as d:
        d.get(ResearchWorkspace, wid).archived = False
        p = d.get(ResearchProject, pid)
        d.get(AgentSession, p.session_id).archived_at = "archived"
        d.commit()
    assert a.post(f"{API}/{pid}/forks", json=request(sid, sha)).status_code == 409


def test_concurrent_retry_creates_one_child_and_rejects_key_reuse(env):
    app, a, _, _ = env
    _, pid, sid, sha, _ = sealed(env)
    body = request(sid, sha)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: a.post(f"{API}/{pid}/forks", json=body), range(2))
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert (
        a.post(
            f"{API}/{pid}/forks", json={**body, "change": "Different request"}
        ).status_code
        == 409
    )
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchProject.id))) == 2


def test_partial_git_failure_rolls_back_child_records_and_files(env, monkeypatch):
    app, a, _, settings = env
    wid, pid, sid, sha, source_work = sealed(env)
    real = rr.fork_thread
    attempted = []

    def fail(settings, workspace, source, child, commit):
        attempted.append(child.id)
        real(settings, workspace, source, child, commit)
        raise rr.GitError("injected after worktree creation")

    monkeypatch.setattr(rr, "fork_thread", fail)
    body = request(sid, sha)
    response = a.post(f"{API}/{pid}/forks", json=body)
    assert response.status_code == 409, response.text
    assert attempted and not rr.thread_dir(settings, wid, attempted[0]).exists()
    assert not rr.legacy_dir(settings, attempted[0]).is_symlink()
    assert (source_work / "train.py").read_text() == "print('round one')\n"
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchProject.id))) == 1
        assert (
            d.scalar(
                select(func.count(AgentSession.id)).where(
                    AgentSession.kind == "research"
                )
            )
            == 1
        )
        assert (
            d.scalar(
                select(func.count(ResearchEvent.id)).where(
                    ResearchEvent.action == "research_forked"
                )
            )
            == 0
        )
    monkeypatch.setattr(rr, "fork_thread", real)
    assert a.post(f"{API}/{pid}/forks", json=body).status_code == 200


def test_sealing_is_immutable_and_does_not_backfill_a_round_after_next_started(env):
    app, _, _, settings = env
    _, pid, sid, _, source_work = sealed(env)
    with app.state.maker() as d:
        p, sprint = d.get(ResearchProject, pid), d.get(ResearchSprint, sid)
        frozen = deepcopy(sprint.snapshot)
        (source_work / "train.py").write_text("newer\n")
        assert branches.capture_round(settings, d, p, sprint)
        assert sprint.snapshot == frozen
        old = ResearchSprint(project_id=pid, number=2, run_id="old", status="ended")
        d.add_all([old, ResearchSprint(project_id=pid, number=3, run_id="new")])
        d.flush()
        assert not branches.capture_round(settings, d, p, old)
        assert old.snapshot == {} and old.commit_sha == ""


def test_round_handoff_still_waits_for_terminal_run_before_fork(env):
    app, a, _, _ = env
    _, pid, sid, sha, _ = sealed(env)
    with app.state.maker() as d:
        sprint = d.get(ResearchSprint, sid)
        d.get(AgentRun, sprint.run_id).status = "running"
        d.commit()
    page = a.get(f"{API}/{pid}/forks/options").json()
    assert not page["can_fork"] and "收尾" in page["rounds"][0]["reason"]
    assert a.post(f"{API}/{pid}/forks", json=request(sid, sha)).status_code == 409


def test_fork_of_fork_keeps_first_evidence_source_and_read_only_lineage(env):
    app, a, b, settings = env
    _, original, sid, sha, _ = sealed(env, evidence=True)
    first = a.post(f"{API}/{original}/forks", json=request(sid, sha)).json()
    first_id = first["id"]
    first_detail = a.get(f"{API}/{first_id}").json()
    result = next(n for n in first_detail["nodes"] if n["kind"] == "hypothesis")[
        "evidence_for"
    ][0]
    assert result["source_research_id"] == original
    log = result["evidence"][0]
    assert log["source_research_id"] == original
    assert a.get(log["source_log_url"]).json()["lines"] == [
        {"n": 1, "text": "accuracy=0.982"}
    ]
    assert b.get(log["source_log_url"]).status_code == 404
    with app.state.maker() as d:
        p = d.get(ResearchProject, first_id)
        run = AgentRun(
            owner=p.owner,
            session_id=p.session_id,
            model_config_id=p.model_config_id,
            model="test",
            prompt="new scope",
            status="completed",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=p.id,
            number=1,
            role="scoping",
            run_id=run.id,
            status="ended",
            summary="child-only handoff",
        )
        d.add(sprint)
        d.flush()
        stages.say(d, p, "advisor", "Child scope reply", sprint.id)
        assert branches.capture_round(settings, d, p, sprint)
        d.commit()
        child_sid, child_sha = sprint.id, sprint.commit_sha
    second = a.post(
        f"{API}/{first_id}/forks", json=request(child_sid, child_sha)
    ).json()
    detail = a.get(f"{API}/{second['id']}").json()
    result = next(n for n in detail["nodes"] if n["kind"] == "hypothesis")[
        "evidence_for"
    ][0]
    assert result["source_research_id"] == original
    assert result["evidence"][0]["source_log_url"] == log["source_log_url"]
    assert second["parent_id"] == first_id
    assert {r["project_id"] for r in detail["inherited_history"]["sprints"]} == {
        original,
        first_id,
    }
    assert a.get(f"{API}/{second['id']}/decisions").json() == []


def test_finished_map_stays_faithful_until_human_approves_new_child_plan(env):
    app, a, _, settings = env
    _, original, sid, sha, _ = sealed(env, finished=True)
    response = a.post(f"{API}/{original}/forks", json=request(sid, sha))
    assert response.status_code == 200, response.text
    child_id = response.json()["id"]
    with app.state.maker() as d:
        child = d.get(ResearchProject, child_id)
        assert rm.root(d, child).status == "supported"
        child.plan = {
            "version": 3,
            "question": "New question",
            "approved_at": None,
            "hypotheses": [{"title": "New path", "kill_if": "no gain"}],
            "datasets": [],
            "compute_id": "local",
            "budget": {"max_sprints": 4, "max_job_hours": None},
        }
        stages.approve_plan(settings, d, child, 3)
        assert child.stage == "experiments" and child.status == "active"
        assert rm.root(d, child).status == "open"
        assert rm.root(d, d.get(ResearchProject, original)).status == "supported"
        assert any(
            n.title == "New path" and rm.is_live(d, n) for n in rm.nodes(d, child)
        )


def test_0037_migration_preserves_old_rounds_without_inventing_snapshots(tmp_path):
    import importlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, text

    url = "sqlite:///" + str(tmp_path / "fork-migration.db")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(
            text(
                "CREATE TABLE research_projects (id VARCHAR(36) PRIMARY KEY,question TEXT NOT NULL)"
            )
        )
        c.execute(
            text(
                "CREATE TABLE research_sprints (id VARCHAR(36) PRIMARY KEY,project_id VARCHAR(36),summary TEXT,commit_sha VARCHAR(64))"
            )
        )
        c.execute(text("INSERT INTO research_projects VALUES ('p','old question')"))
        c.execute(
            text(
                "INSERT INTO research_sprints VALUES ('r','p','old summary','old-sha')"
            )
        )
        migration = importlib.import_module(
            "backend.migrations.versions.0037_research_forks"
        )
        with Operations.context(MigrationContext.configure(c)):
            migration.upgrade()
            migration.upgrade()
    with engine.connect() as c:
        project = c.execute(
            text(
                "SELECT question,parent_id,forked_from,inherited_history,merged FROM research_projects"
            )
        ).one()
        sprint = c.execute(
            text("SELECT summary,commit_sha,snapshot FROM research_sprints")
        ).one()
        assert project == ("old question", None, "{}", "{}", "{}")
        assert sprint == ("old summary", "old-sha", "{}")
    engine.dispose()


def test_remote_code_is_imported_before_a_round_checkpoint(env, monkeypatch):
    from backend import research_remote, research_settings

    app, _, _, settings = env
    _, pid, _, _, work = sealed(env)
    calls = []

    def pull(_settings, _compute, project_id, *, small, timeout):
        calls.append((project_id, small, timeout))
        (work / "train.py").write_text("print('remote round two')\n")

    monkeypatch.setattr(research_settings, "compute", lambda *_: {"kind": "ssh"})
    monkeypatch.setattr(research_remote, "pull", pull)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        run = AgentRun(
            owner=p.owner,
            session_id=p.session_id,
            model_config_id=p.model_config_id,
            model="test",
            prompt="remote",
            status="completed",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(project_id=pid, number=2, run_id=run.id, status="ended")
        d.add(sprint)
        d.flush()
        assert branches.capture_round(settings, d, p, sprint)
        assert calls == [(pid, True, 60)]
        assert (
            rr.git(work, "show", f"{sprint.commit_sha}:train.py").stdout
            == "print('remote round two')\n"
        )
