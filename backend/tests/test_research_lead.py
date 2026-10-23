"""A project's lead keeps one conversation and delegates within its project."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from backend import research_chat as rc
from backend import research_map as rm
from backend import research_sandbox as rs
from backend import research_stages as st
from backend import research_workspaces as rw
from backend.agent_worker import process, research_tools
from backend.models import (
    AgentRun,
    AgentSession,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    ResearchWorkspace,
)
from backend.research_tools import _run, gate
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure
from backend.tests.test_pi_sessions import kept, model  # noqa: F401
from backend.tests.test_research_chats import _project_with_a_running_job
from backend.translation_settings import write_config

WS = "/api/v1/research/workspaces"
CHATS = "/api/v1/research/chats"


@pytest.fixture
def env(cloud_env, monkeypatch):  # noqa: F811
    """Seed the historical mentor domain explicitly; new workspaces have none."""
    cloud_env[3].mode = "local"
    original = rw.create

    def legacy_workspace(*args, **kwargs):
        workspace = original(*args, **kwargs)
        rc.main_session(args[0], workspace)
        return workspace

    monkeypatch.setattr(rw, "create", legacy_workspace)
    return cloud_env


def _workspace(a, name="CIFAR"):
    result = a.post(WS, json={"name": name})
    assert result.status_code == 200, result.text
    return result.json()


def _lead(app, workspace_id):
    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, workspace_id)
        session = d.get(AgentSession, workspace.session_id)
        return {
            "role": "lead",
            "workspace_id": workspace.id,
            "session_id": session.id,
            "model_config_id": session.model_config_id or workspace.model_config_id,
        }


def _last_run(app, session_id):
    with app.state.maker() as d:
        return d.scalars(
            select(AgentRun)
            .where(AgentRun.session_id == session_id)
            .order_by(AgentRun.created_at.desc())
        ).first()


def _finish(app, run):
    with app.state.maker() as d:
        d.get(AgentRun, run.id).status = "completed"
        d.commit()


def test_a_project_has_one_main_session_before_anyone_speaks(env):
    app, a, b, _settings = env
    workspace = _workspace(a)
    session_id = workspace["session_id"]
    assert session_id
    for _ in range(2):
        opened = a.get(f"{WS}/{workspace['id']}")
        assert opened.status_code == 200, opened.text
        assert opened.json()["session_id"] == session_id
        assert opened.json()["researches"] == []
    with app.state.maker() as d:
        session = d.get(AgentSession, session_id)
        assert session.workspace_id == workspace["id"]
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        assert d.scalar(select(func.count(ResearchProject.id))) == 0
        assert (
            d.scalar(
                select(func.count(AgentSession.id)).where(
                    AgentSession.workspace_id == workspace["id"],
                    AgentSession.kind != "team_member",
                )
            )
            == 1
        )
    assert b.get(f"{WS}/{workspace['id']}").status_code == 404
    assert b.get(f"{WS}/{workspace['id']}/notes").status_code == 404
    assert (
        b.post(
            f"{CHATS}/{session_id}/messages", json={"message": "别人的项目"}
        ).status_code
        == 404
    )


def test_opening_an_old_workspace_keeps_work_without_creating_a_new_mentor(env):
    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = ResearchWorkspace(owner=owner, name="旧项目")
        d.add(workspace)
        d.flush()
        old = AgentSession(owner=owner, workspace_id=workspace.id, title="以前的对话")
        d.add(old)
        d.flush()
        d.add(
            AgentRun(
                owner=owner,
                session_id=old.id,
                model_config_id=model_id,
                model="MiniMax-M3",
                prompt="以前的问题",
                response="以前的回答",
                status="completed",
                writable=False,
                runtime={"research": {"role": "chat", "workspace_id": workspace.id}},
            )
        )
        direct = rm.create_project(d, owner, "以前直接建的研究", "", model_id)
        direct.workspace_id = workspace.id
        idea = rw.add_card(d, workspace, "以前的想法")
        d.commit()
        wid, old_id, pid, idea_id = workspace.id, old.id, direct.id, idea.id
    main = a.get(f"{WS}/{wid}").json()
    assert main["session_id"] is None
    assert a.get(f"{WS}/{wid}").json()["session_id"] is None
    assert {p["id"] for p in main["researches"]} == {pid}
    assert old_id in {c["id"] for c in a.get(f"{WS}/{wid}/chats").json()}
    assert (
        a.get(f"/api/v1/agent/sessions/{old_id}/runs").json()[0]["response"]
        == "以前的回答"
    )
    board = a.get(f"{WS}/{wid}/board").json()["cards"]
    assert {pid, idea_id} <= {c["id"] for c in board}
    assert a.get(f"/api/v1/research/projects/{pid}").status_code == 200
    continued = a.post(f"{CHATS}/{old_id}/messages", json={"message": "继续以前的问题"})
    assert continued.status_code == 200, continued.text
    assert _last_run(app, old_id).runtime["research"]["role"] == "chat"
    assert _last_run(app, old_id).writable is False


def test_the_main_session_keeps_its_model_and_accepts_compact(env):
    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    session_id = workspace["session_id"]
    response = a.post(
        f"{CHATS}/{session_id}/messages",
        json={"message": "现在的进展？", "model_config_id": model_id},
    )
    assert response.status_code == 200, response.text
    first = _last_run(app, session_id)
    assert first.writable is True and first.lane == ""
    assert first.runtime["research"]["role"] == "lead"
    assert first.runtime["research"]["workspace_id"] == workspace["id"]
    assert first.runtime["research"]["session_id"] == session_id
    assert (
        a.post(
            f"{CHATS}/{session_id}/messages", json={"message": "重复发送"}
        ).status_code
        == 409
    )
    _finish(app, first)
    saved = write_config(
        settings,
        owner,
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3.1-Flash",
            "api_key": "test-private-key",
            "protocol": "openai",
        },
        create=True,
    )
    chosen = next(
        m["id"] for m in saved["models"] if m["model"] == "MiniMax-M3.1-Flash"
    )
    changed = a.post(
        f"{CHATS}/{session_id}/messages",
        json={"message": "换个模型问", "model_config_id": chosen},
    )
    assert changed.status_code == 200, changed.text
    assert _last_run(app, session_id).model_config_id == chosen
    _finish(app, _last_run(app, session_id))
    compacted = a.post(
        f"{CHATS}/{session_id}/messages",
        json={"message": "/compact 只留结论", "command": "compact"},
    )
    assert compacted.status_code == 200, compacted.text
    last = _last_run(app, session_id)
    assert last.model_config_id == chosen
    assert last.runtime["command"] == "compact"
    assert last.runtime["instructions"] == "只留结论"
    assert last.runtime["research"]["role"] == "lead"
    with app.state.maker() as d:
        assert d.scalar(select(func.count(ResearchProject.id))) == 0


def test_a_main_session_cannot_be_deleted_or_run_with_generic_agent_permissions(env):
    _app, a, _b, _settings = env
    workspace = _workspace(a)
    session_id = workspace["session_id"]
    assert a.delete(f"/api/v1/agent/sessions/{session_id}").status_code >= 400
    assert (
        a.post(
            f"/api/v1/agent/sessions/{session_id}/runs",
            json={"prompt": "写文件", "writable": True},
        ).status_code
        >= 400
    )
    assert a.get(f"{WS}/{workspace['id']}").json()["session_id"] == session_id


def test_two_simultaneous_main_messages_only_queue_one_answer(env, monkeypatch):
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    barrier = threading.Barrier(2)
    original = rc.ask

    def together(*args, **kwargs):
        barrier.wait(timeout=5)
        return original(*args, **kwargs)

    monkeypatch.setattr(rc, "ask", together)

    def send(number):
        return a.post(
            f"{CHATS}/{workspace['session_id']}/messages",
            json={"message": f"问题 {number}", "model_config_id": model_id},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(r.status_code for r in results) == [200, 409], [
        r.text for r in results
    ]
    with app.state.maker() as d:
        assert (
            d.scalar(
                select(func.count(AgentRun.id)).where(
                    AgentRun.session_id == workspace["session_id"]
                )
            )
            == 1
        )


def test_two_first_visits_do_not_create_a_hidden_main_session(env, monkeypatch):
    app, a, _b, settings = env
    owner, _model_id = configure(app, a, settings)
    with app.state.maker() as d:
        workspace = ResearchWorkspace(owner=owner, name="以前的项目")
        d.add(workspace)
        d.commit()
        wid = workspace.id

    def together(*args, **kwargs):
        pytest.fail("Opening a physical workspace must not create a mentor")

    monkeypatch.setattr(rc, "main_session", together)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: a.get(f"{WS}/{wid}"), range(2)))
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert results[0].json()["session_id"] == results[1].json()["session_id"]
    with app.state.maker() as d:
        assert (
            d.scalar(
                select(func.count(AgentSession.id)).where(
                    AgentSession.workspace_id == wid
                )
            )
            == 0
        )


def test_the_leads_tools_only_read_delegate_and_pass_messages(env):
    app, *_ = env
    lead = {"role": "lead", "workspace_id": "w"}
    names = {t["name"] for t in research_tools("lead")}
    assert {
        "project_overview",
        "research_read",
        "job_status",
        "job_logs",
        "search_papers",
        "read_paper",
        "start_research",
        "message_research",
    } <= names
    forbidden = {
        "run_job",
        "bash",
        "write",
        "edit",
        "stop_job",
        "add_node",
        "update_node",
        "focus",
        "advise",
        "propose_plan",
        "approve_plan",
        "accept_conclusion",
        "fork_research",
        "propose_merge",
    }
    assert not names & forbidden
    for name in names:
        gate(app, lead, name)
    for name in forbidden:
        with pytest.raises(ValueError):
            gate(app, lead, name)
        with pytest.raises(ValueError):
            _run(app, "owner", lead, name, {})


def test_the_lead_reads_its_researches_and_logs_but_cannot_cross_projects(env):
    app, a, b, settings = env
    owner, _model_id = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    other_wid, other_pid = _project_with_a_running_job(app, owner)
    outsider = b.get("/api/v1/auth/me").json()["user"]["id"]
    lead = _lead(app, wid)
    with app.state.maker() as d:
        job = d.scalars(select(ResearchJob).where(ResearchJob.project_id == pid)).one()
        other_job = d.scalars(
            select(ResearchJob).where(ResearchJob.project_id == other_pid)
        ).one()
        job_id, other_job_id = job.id, other_job.id
    (rs.logdir(settings, pid) / f"{job_id}.log").write_text("test_acc=0.704\n")
    overview = _run(app, owner, lead, "project_overview", {})["text"]
    assert "小 CNN 到 90%" in overview and "test_acc=0.704" in overview
    assert (
        "baseline-s0"
        in _run(app, owner, lead, "research_read", {"research_id": pid})["text"]
    )
    log = _run(app, owner, lead, "job_logs", {"job_id": job_id})
    assert "test_acc=0.704" in json.dumps(log)
    for name, args in (
        ("research_read", {"research_id": other_pid}),
        ("job_status", {"job_id": other_job_id}),
        ("job_logs", {"job_id": other_job_id}),
        ("message_research", {"research_id": other_pid, "text": "跨项目"}),
    ):
        with pytest.raises(ValueError):
            _run(app, owner, lead, name, args)
    for name, args in (
        ("project_overview", {}),
        ("research_read", {"research_id": pid}),
        ("job_logs", {"job_id": job_id}),
        ("start_research", {"question": "偷建研究"}),
        ("message_research", {"research_id": pid, "text": "越权"}),
    ):
        with pytest.raises(ValueError):
            _run(app, outsider, lead, name, args)
    forged = {**lead, "workspace_id": other_wid}
    with pytest.raises(ValueError):
        _run(app, owner, forged, "start_research", {"question": "伪造项目"})


def test_delegation_starts_at_scoping_with_the_project_defaults(env):
    from backend import research_settings as rset
    from backend import research_worker

    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    computes = rset.default()
    computes["computes"].append(
        {
            "id": "gpu",
            "name": "GPU",
            "kind": "ssh",
            "host": "gpu",
            "remote_dir": "/srv/research",
        }
    )
    rset.save(settings, computes)
    updated = a.patch(
        f"{WS}/{workspace['id']}",
        json={
            "instructions": "只研究小模型",
            "model_config_id": model_id,
            "compute_id": "gpu",
        },
    )
    assert updated.status_code == 200, updated.text
    lead = _lead(app, workspace["id"])
    delegated = _run(
        app,
        owner,
        lead,
        "start_research",
        {"question": "L2 正则化有帮助吗？", "background": "比较同一小模型"},
    )
    assert delegated["stage"] == "scoping"
    assert delegated["question"] == "L2 正则化有帮助吗？"
    assert "请在研究里批准计划" in delegated["hint"]
    assert delegated["research_id"] in delegated["url"]
    with app.state.maker() as d:
        project = d.get(ResearchProject, delegated["research_id"])
        assert project.workspace_id == workspace["id"] and project.owner == owner
        assert project.stage == "scoping" and not project.plan
        assert project.compute_id == "gpu" and project.model_config_id == model_id
        assert project.background == "比较同一小模型"
        assert project.spawned_by == "lead"
        assert d.scalar(select(func.count(ResearchJob.id))) == 0
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        research_worker._plan(app, d, project)
        d.flush()
        sprint = d.scalars(
            select(ResearchSprint).where(ResearchSprint.project_id == project.id)
        ).one()
        run = d.get(AgentRun, sprint.run_id)
        assert sprint.role == "scoping" and run.runtime["research"]["role"] == "scoping"
        assert "只研究小模型" in run.context
        assert not d.scalar(
            select(ResearchEvent.id).where(ResearchEvent.action == "human_decision")
        )
        d.commit()
    saved = write_config(
        settings,
        owner,
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3.1-Flash",
            "api_key": "test-private-key",
            "protocol": "openai",
        },
        create=True,
    )
    chosen = next(
        m["id"] for m in saved["models"] if m["model"] == "MiniMax-M3.1-Flash"
    )
    response = a.post(
        f"{CHATS}/{workspace['session_id']}/messages",
        json={"message": "再研究另一个问题", "model_config_id": chosen},
    )
    assert response.status_code == 200, response.text
    selected = _last_run(app, workspace["session_id"])
    _finish(app, selected)
    another = _run(
        app,
        owner,
        selected.runtime["research"],
        "start_research",
        {"question": "相同参数量下还成立吗？"},
    )
    with app.state.maker() as d:
        assert d.get(ResearchProject, another["research_id"]).model_config_id == chosen
        assert (
            d.get(ResearchProject, delegated["research_id"]).model_config_id == model_id
        )


def test_the_lead_can_read_old_rounds_and_failed_jobs_beyond_the_overview(env):
    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    with app.state.maker() as d:
        project = rm.create_project(d, owner, "重看早期失败实验", "", model_id)
        project.workspace_id, project.stage = workspace["id"], "experiments"
        root = rm.root(d, project)
        rounds = []
        for number in range(1, 7):
            sprint = ResearchSprint(
                project_id=project.id,
                number=number,
                run_id=f"run-{number}",
                status="ended",
                summary=f"history-round-{number}",
            )
            d.add(sprint)
            d.flush()
            rounds.append(sprint)
        jobs = []
        for number in range(1, 11):
            job = ResearchJob(
                project_id=project.id,
                node_id=root.id,
                sprint_id=rounds[min(number - 1, 5)].id,
                command=f"python historical_experiment_{number}.py",
                status="failed" if number == 1 else "succeeded",
                started_at=f"2026-01-{number:02}T00:00:00+00:00",
            )
            d.add(job)
            jobs.append(job)
        d.commit()
        pid, old_job_id, newest_job_id = project.id, jobs[0].id, jobs[-1].id
    lead = _lead(app, workspace["id"])
    overview = _run(app, owner, lead, "project_overview", {})["text"]
    assert "history-round-1" not in overview and old_job_id not in overview
    assert "history-round-6" in overview and newest_job_id in overview
    full = _run(app, owner, lead, "research_read", {"research_id": pid})["text"]
    assert "history-round-1" in full and "history-round-6" in full
    assert old_job_id in full and newest_job_id in full
    assert "historical_experiment_1.py" in full and "[failed]" in full


@pytest.mark.parametrize("status", ["active", "paused", "waiting"])
def test_passing_a_message_does_not_approve_or_restart_a_research(env, status):
    from backend.research_brief import advisor_brief

    app, a, _b, settings = env
    owner, _model_id = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    with app.state.maker() as d:
        project = d.get(ResearchProject, pid)
        project.status = status
        project.plan = {"version": 1, "approved_at": None}
        d.commit()
    text = "先比较相同参数量，别加大模型"
    _run(
        app,
        owner,
        _lead(app, wid),
        "message_research",
        {"research_id": pid, "text": text},
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, pid)
        assert project.status == status and project.plan["approved_at"] is None
        assert project.stage == "experiments"
        message = d.scalars(
            select(ResearchEvent).where(
                ResearchEvent.project_id == pid, ResearchEvent.action == "message"
            )
        ).one()
        assert message.actor == "lead" and message.detail["text"] == text
        assert text in st.unanswered(d, project)
        assert text in advisor_brief(d, project, 4, settings)
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        assert d.scalar(select(func.count(ResearchJob.id))) == 1


@pytest.mark.parametrize("role", ["scoping", "advisor"])
def test_a_message_arriving_during_a_round_reaches_the_next_round(env, role):
    from backend import research_advice, research_worker

    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    child = _run(
        app,
        owner,
        _lead(app, workspace["id"]),
        "start_research",
        {"question": "比较小模型的基线"},
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, child["research_id"])
        if role == "advisor":
            project.stage = "experiments"
        research_worker._start(app, d, project, None, role, {"model": "MiniMax-M3"})
        d.commit()
    text = "这轮开始后才发来的要求：保持参数量相同"
    _run(
        app,
        owner,
        _lead(app, workspace["id"]),
        "message_research",
        {"research_id": child["research_id"], "text": text},
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, child["research_id"])
        first = d.scalars(
            select(ResearchSprint).where(ResearchSprint.project_id == project.id)
        ).one()
        run = d.get(AgentRun, first.run_id)
        run.status, run.response = "completed", "这一轮只回答了原来的问题"
        if role == "scoping":
            assert research_worker._settle(d, project, first)
        else:
            research_advice.apply(d, project, first, {"message": run.response})
        d.flush()
        assert st.unanswered(d, project) == [text]
        research_worker._plan(app, d, project)
        d.flush()
        next_sprint = d.scalars(
            select(ResearchSprint).where(
                ResearchSprint.project_id == project.id, ResearchSprint.number == 2
            )
        ).one()
        next_run = d.get(AgentRun, next_sprint.run_id)
        assert next_sprint.role == role
        assert text in next_run.prompt
        assert next_run.model_config_id == model_id
        d.commit()


def test_research_notes_are_visible_once_and_refresh_the_next_answer_without_a_run(env):
    from backend import research_notes
    from backend.models import ResearchNote

    app, a, b, settings = env
    owner, model_id = configure(app, a, settings)
    wid, pid = _project_with_a_running_job(app, owner)
    other_wid, other_pid = _project_with_a_running_job(app, owner)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        events = [
            rm.event(
                d,
                p,
                None,
                "advisor",
                "plan_proposed",
                {"plan": {"summary": "计划：先比基线"}},
            ),
            rm.event(
                d,
                p,
                None,
                "advisor",
                "decision_requested",
                {"kind": "budget", "reason": "需要增加预算"},
            ),
            rm.event(
                d,
                p,
                None,
                "advisor",
                "decision_requested",
                {"kind": "conclusion", "reason": "L2 优于基线"},
            ),
            rm.event(
                d, p, None, "system", "input_needed", {"summary": "需要第二份数据"}
            ),
            rm.event(d, p, None, "system", "paused", {"reason": "数据下载失败"}),
            rm.event(
                d, p, None, "system", "sprint_abnormal", {"reason": "进程异常退出"}
            ),
        ]
        rm.event(d, p, None, "human", "paused", {"reason": "我手动暂停"})
        other = d.get(ResearchProject, other_pid)
        rm.event(
            d,
            other,
            None,
            "advisor",
            "decision_requested",
            {"reason": "别的项目的决定"},
        )
        d.commit()
        event_ids = {e.id for e in events}
        for event in events:
            research_notes.record(d, p, event)
        d.commit()
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        assert d.scalar(
            select(func.count(ResearchNote.id)).where(ResearchNote.workspace_id == wid)
        ) == len(events)
        assert (
            set(
                d.scalars(
                    select(ResearchNote.event_id).where(
                        ResearchNote.workspace_id == wid
                    )
                )
            )
            == event_ids
        )
    first = a.get(f"{WS}/{wid}/notes")
    assert first.status_code == 200, first.text
    notes = first.json()
    assert len(notes) == len(event_ids) == len({n["id"] for n in notes})
    assert {n["kind"] for n in notes} == {"plan", "decision", "conclusion", "error"}
    assert all(
        n["workspace_id"] == wid and n["project_id"] == pid and n["text"] for n in notes
    )
    assert a.get(f"{WS}/{wid}/notes").json() == notes
    assert "别的项目的决定" not in json.dumps(notes, ensure_ascii=False)
    assert b.get(f"{WS}/{wid}/notes").status_code == 404
    assert a.get(f"{WS}/{other_wid}/notes").status_code == 200
    with app.state.maker() as d:
        context = rc.context(d, d.get(ResearchWorkspace, wid), settings)
        assert "需要增加预算" in context and "L2 优于基线" in context
        assert "别的项目的决定" not in context
        assert d.scalar(select(func.count(AgentRun.id))) == 0
        session_id = d.get(ResearchWorkspace, wid).session_id
    result = a.post(
        f"{CHATS}/{session_id}/messages",
        json={"message": "现在有哪些事？", "model_config_id": model_id},
    )
    assert result.status_code == 200, result.text
    run = _last_run(app, session_id)
    assert "需要增加预算" in run.context
    _finish(app, run)
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        rm.event(
            d,
            p,
            None,
            "advisor",
            "decision_requested",
            {"reason": "刚刚需要决定的新问题"},
        )
        d.commit()
    result = a.post(f"{CHATS}/{session_id}/messages", json={"message": "刚才呢？"})
    assert result.status_code == 200, result.text
    assert "刚刚需要决定的新问题" in _last_run(app, session_id).context


def test_a_failed_scoping_round_reports_to_the_main_session_without_another_run(env):
    from backend import research_worker
    from backend.models import ResearchNote

    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    child = _run(
        app,
        owner,
        _lead(app, workspace["id"]),
        "start_research",
        {"question": "能否复现基线？"},
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, child["research_id"])
        run = AgentRun(
            owner=owner,
            session_id=project.session_id,
            model_config_id=model_id,
            model="MiniMax-M3",
            prompt="定题",
            status="failed",
            error="本地假模型连接断开",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=project.id, number=1, run_id=run.id, role="scoping"
        )
        d.add(sprint)
        d.flush()
        assert research_worker._settle(d, project, sprint)
        d.commit()
        assert sprint.status == "abnormal"
        note = d.scalars(
            select(ResearchNote).where(ResearchNote.workspace_id == workspace["id"])
        ).one()
        assert note.kind == "error" and "连接断开" in note.text
        assert d.scalar(select(func.count(AgentRun.id))) == 1
    notes = a.get(f"{WS}/{workspace['id']}/notes").json()
    assert len(notes) == 1 and notes[0]["project_id"] == child["research_id"]


def test_the_main_conversation_reuses_pi_history_and_compacts(
    env, model, monkeypatch
):  # noqa: F811
    from backend import agent_limits

    monkeypatch.setattr(agent_limits, "COMPACTION", {"keepRecentTokens": 1})
    app, a, _b, settings = env
    _owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    session_id = workspace["session_id"]

    def ask(text, **extra):
        response = a.post(
            f"{CHATS}/{session_id}/messages",
            json={"message": text, "model_config_id": model_id, **extra},
        )
        assert response.status_code == 200, response.text
        run = _last_run(app, session_id)
        with app.state.maker() as d:
            d.get(AgentRun, run.id).status = "running"
            d.commit()
        process(app, run.id)
        done = _last_run(app, session_id)
        assert done.status == "completed", done.error
        return done

    assert ask("第一个项目问题").response == "第 1 次回答"
    assert ask("第二个项目问题").response == "第 2 次回答"
    sent = json.dumps(model[1]["messages"], ensure_ascii=False)
    assert "第一个项目问题" in sent and "第 1 次回答" in sent
    compacted = ask("/compact 保留项目结论", command="compact")
    assert compacted.runtime["compaction"]["reason"] == "manual"
    assert any(e["type"] == "compaction" for e in kept(app, session_id))
    ask("继续项目问题")
    with app.state.maker() as d:
        assert d.get(ResearchWorkspace, workspace["id"]).session_id == session_id
        assert d.scalar(select(func.count(ResearchProject.id))) == 0


def test_the_main_session_migration_preserves_existing_projects(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import String, Text, inspect, text

    from backend.config import Settings, database
    from backend.models import Base, ResearchNote, User

    url = "sqlite:///" + str(tmp_path / "main-session-migration.db")
    monkeypatch.setenv("DATABASE_URL", url)
    settings = Settings(database_url=url, storage=str(tmp_path / "files"), testing=True)
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker() as d:
        user = User(username="researcher", password="x")
        d.add(user)
        d.flush()
        workspace = ResearchWorkspace(owner=user.id, name="以前的项目")
        d.add(workspace)
        d.flush()
        project = rm.create_project(d, user.id, "以前的研究", "", "m")
        project.workspace_id = workspace.id
        event = rm.event(
            d,
            project,
            None,
            "advisor",
            "decision_requested",
            {"reason": "以前待决定的事"},
        )
        d.commit()
        wid, pid, event_id = workspace.id, project.id, event.id
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        connection.execute(text("DROP TABLE research_notes"))
        operations = Operations(MigrationContext.configure(connection))
        with operations.batch_alter_table("research_workspaces") as batch:
            batch.drop_column("session_id")
        with operations.batch_alter_table("research_projects") as batch:
            batch.drop_column("spawned_by")
        with operations.batch_alter_table("agent_runs") as batch:
            batch.alter_column("context", existing_type=Text(), type_=String(200))
        connection.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        connection.execute(text("INSERT INTO alembic_version VALUES ('0033')"))
        connection.commit()
    command.upgrade(Config(toml_file="pyproject.toml"), "0034")
    with maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        project = d.get(ResearchProject, pid)
        assert workspace.name == "以前的项目"
        session = d.get(AgentSession, workspace.session_id)
        assert session.workspace_id == wid and session.owner == user.id
        assert project.workspace_id == wid and project.question == "以前的研究"
        assert project.spawned_by == "human"
        note = d.scalars(select(ResearchNote)).one()
        assert note.event_id == event_id and note.text == "以前待决定的事"
    assert "session_id" in {
        c["name"] for c in inspect(engine).get_columns("research_workspaces")
    }
    context_column = next(
        c for c in inspect(engine).get_columns("agent_runs") if c["name"] == "context"
    )
    assert isinstance(context_column["type"], Text)
    engine.dispose()


def test_delegated_question_keeps_the_researchers_message_language(env):
    from backend.research_tools import _chat

    app, a, _b, settings = env
    owner, model_id = configure(app, a, settings)
    workspace = _workspace(a)
    with app.state.maker() as d:
        d.get(AgentSession, workspace["session_id"]).model_config_id = model_id
        d.add(
            AgentRun(
                owner=owner,
                session_id=workspace["session_id"],
                model_config_id=model_id,
                model="MiniMax-M3",
                prompt="比较两种优化器。Use MNIST.",
            )
        )
        d.commit()
    child = _chat(
        app,
        owner,
        {
            "role": "lead",
            "workspace_id": workspace["id"],
            "session_id": workspace["session_id"],
            "model_config_id": model_id,
        },
        "start_research",
        {"question": "Compare AdamW and SGD on MNIST"},
    )
    with app.state.maker() as d:
        project = d.get(ResearchProject, child["research_id"])
        assert rm.language(d, project) == "zh"
