"""Conversation navigation and checkpoints, without model or SSH calls."""

from sqlalchemy import select

from backend import (
    research_branches,
    research_changes,
    research_map,
    research_repo as rr,
)
from backend.models import (
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.research_tools import _chat, gate
from backend.tests.test_research_hub import (
    cloud_env,
    env,
    workspace,
    create,
)  # noqa: F401

BASE = "/api/v1/research"


def test_short_titles_read_receipts_and_old_sessions_stay_addressable(env):
    app, a, b, _ = env
    w = workspace(a)
    p = create(
        env,
        w["id"],
        message="研究一个非常长的问题，包含具体实验方案和成功标准。下一句话",
    )
    assert len(p["title"]) <= 16
    with app.state.maker() as d:
        project = d.get(ResearchProject, p["id"])
        research_map.event(d, project, None, "advisor", "message", {"text": "答复"})
        d.commit()
    assert a.get(BASE + "/navigation").json()["workspaces"][0]["researches"][0][
        "unread"
    ]
    assert b.post(f"{BASE}/projects/{p['id']}/read", json={}).status_code == 404
    assert a.post(f"{BASE}/projects/{p['id']}/read", json={}).status_code == 200
    assert not a.get(BASE + "/navigation").json()["workspaces"][0]["researches"][0][
        "unread"
    ]
    assert a.get(f"/api/v1/agent/sessions/{p['session_id']}").status_code == 200


def test_project_conversations_can_delegate_with_ownership_and_plan_boundary(env):
    app, a, _, _ = env
    w = workspace(a)
    p = create(env, w["id"])
    with app.state.maker() as d:
        sprint = ResearchSprint(project_id=p["id"], number=1, role="scoping", run_id="")
        d.add(sprint)
        d.commit()
        runtime = {
            "role": "scoping",
            "project_id": p["id"],
            "sprint_id": sprint.id,
            "workspace_id": w["id"],
        }
        owner = d.get(ResearchProject, p["id"]).owner
    gate(app, runtime, "start_research")
    child = _chat(
        app, owner, runtime, "start_research", {"question": "Check another hypothesis"}
    )
    with app.state.maker() as d:
        result = d.get(ResearchProject, child["research_id"])
        assert result.parent_id == p["id"] and result.stage == "scoping"
        assert not result.plan and not d.scalar(
            select(AgentRun.id).where(AgentRun.session_id == result.session_id)
        )
    import pytest

    with pytest.raises(ValueError):
        _chat(app, "another-owner", runtime, "start_research", {"question": "forged"})
    with pytest.raises(ValueError):
        gate(app, runtime, "run_job")


def sealed(env, actual=None):
    app, a, _, settings = env
    w = workspace(
        a, **({"location": {"kind": "local", "path": str(actual)}} if actual else {})
    )
    p = create(env, w["id"], defer_start=True)
    with app.state.maker() as d:
        project = d.get(ResearchProject, p["id"])
        path = rr.thread_dir(settings, w["id"], p["id"])
        ((actual or path) / "train.py").write_text("score=1\n")
        run = AgentRun(
            owner=project.owner,
            session_id=project.session_id,
            model_config_id=project.model_config_id,
            model="fake",
            prompt="",
            status="completed",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=project.id,
            number=1,
            role="executor",
            run_id=run.id,
            status="ended",
        )
        d.add(sprint)
        d.flush()
        assert research_branches.capture_round(settings, d, project, sprint)
        d.commit()
        return p, sprint.id, path


def test_checkpoint_diff_undo_keeps_history_and_refuses_stale_edits(env):
    app, a, b, _ = env
    p, sid, path = sealed(env)
    url = f"{BASE}/projects/{p['id']}/rounds/{sid}"
    value = a.get(url + "/changes").json()
    assert value["added"] == 1 and value["removed"] == 0
    assert value["files"][0]["path"] == "train.py" and value["can_undo"]
    body = {"expected_commit": value["commit_sha"]}
    assert b.get(url + "/changes").status_code == 404
    (path / "train.py").write_text("score=2\n")
    assert a.post(url + "/undo", json=body).status_code == 409
    (path / "train.py").write_text("score=1\n")
    result = a.post(url + "/undo", json=body)
    assert result.status_code == 200, result.text
    assert not (path / "train.py").exists()
    assert (
        rr.git(
            path, "merge-base", "--is-ancestor", value["commit_sha"], "HEAD"
        ).returncode
        == 0
    )
    assert a.post(url + "/undo", json=body).status_code == 409
    with app.state.maker() as d:
        assert d.get(ResearchSprint, sid).commit_sha == value["commit_sha"]
        assert d.scalar(
            select(ResearchEvent.id).where(
                ResearchEvent.action == "checkpoint_reverted"
            )
        )


def test_deferred_first_message_is_paused_until_attachments_are_uploaded(env):
    app, a, _, _ = env
    w = workspace(a)
    p = create(env, w["id"], defer_start=True)
    assert p["status"] == "paused" and p["stage"] == "scoping"
    response = a.post(
        f"{BASE}/projects/{p['id']}/workspace/upload",
        files={"file": ("source.txt", b"source material")},
        data={"path": "", "conflict": "error"},
    )
    assert response.status_code == 200, response.text
    with app.state.maker() as d:
        assert not d.scalar(select(AgentRun.id))


def test_external_undo_checks_physical_preimage_and_preserves_unrelated_files(
    env, tmp_path
):
    _, a, _, _ = env
    actual = tmp_path / "workspace"
    actual.mkdir()
    p, sid, private = sealed(env, actual)
    url = f"{BASE}/projects/{p['id']}/rounds/{sid}"
    changes = a.get(url + "/changes").json()
    body = {"expected_commit": changes["commit_sha"]}
    (actual / "train.py").write_text("later edit\n")
    assert a.post(url + "/undo", json=body).status_code == 409
    assert (actual / "train.py").read_text() == "later edit\n"
    (actual / "train.py").write_text("score=1\n")
    (actual / "unrelated.txt").write_text("keep")
    response = a.post(url + "/undo", json=body)
    assert response.status_code == 200, response.text
    assert not (actual / "train.py").exists()
    assert (actual / "unrelated.txt").read_text() == "keep"


def test_read_receipt_migration_preserves_renamed_titles_and_transcripts(env):
    import importlib
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    app, a, _, _ = env
    w = workspace(a)
    p = create(env, w["id"])
    with app.state.maker() as d:
        project = d.get(ResearchProject, p["id"])
        project.title = "项目导师"
        original_question = project.question
        engine = d.get_bind()
        d.commit()
    migration = importlib.import_module(
        "backend.migrations.versions.0040_conversation_read"
    )
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
    with app.state.maker() as d:
        project = d.get(ResearchProject, p["id"])
        assert project.question == original_question and len(project.title) <= 16
        assert project.title != "项目导师"
        assert d.get(AgentSession, project.session_id).read_at
        project.title = "My renamed conversation"
        d.commit()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
    with app.state.maker() as d:
        assert d.get(ResearchProject, p["id"]).title == "My renamed conversation"


def test_delegation_keeps_the_physical_project_machine(env, tmp_path):
    app, a, _, _ = env
    actual = tmp_path / "source"
    actual.mkdir()
    w = workspace(a, location={"kind": "local", "path": str(actual)})
    p = create(env, w["id"])
    with app.state.maker() as d:
        source = d.get(ResearchProject, p["id"])
        sprint = ResearchSprint(
            project_id=source.id, number=1, role="scoping", run_id=""
        )
        d.add(sprint)
        d.commit()
        owner = source.owner
        runtime = {
            "role": "scoping",
            "project_id": source.id,
            "sprint_id": sprint.id,
            "workspace_id": w["id"],
        }
    child = _chat(
        app, owner, runtime, "start_research", {"question": "Independent comparison"}
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, child["research_id"])
        assert project.compute_id == "host"
        assert d.get(AgentSession, project.session_id).workspace_id == w["id"]
