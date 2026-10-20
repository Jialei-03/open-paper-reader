import pytest
from sqlalchemy import select

from backend.models import AgentRun, ResearchProject, ResearchSprint
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_agents import configure


@pytest.fixture
def env(cloud_env):  # noqa: F811
    """Research is the local edition's: its tests run as that edition."""
    cloud_env[3].mode = "local"
    return cloud_env

BASE = "/api/v1/research/projects"


def create(c, model, **extra):
    body = {"question": "Does L2 regularization help?", "model_config_id": model}
    body.update(extra)
    return c.post(BASE, json=body)


def test_create_and_get_project(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    r = create(a, model, background="tabular data", budget={"max_sprints": 5})
    assert r.status_code == 200, r.text
    project = r.json()
    assert project["status"] == "active"
    assert project["spent"]["sprints"] == 0
    assert project["budget"]["max_sprints"] == 5
    assert project["budget"]["max_tokens"] == 2000000
    detail = a.get(f"{BASE}/{project['id']}").json()
    root = [n for n in detail["nodes"] if n["parent_id"] is None]
    assert len(root) == 1 and root[0]["title"] == "Does L2 regularization help?"
    assert detail["sprints"] == [] and detail["jobs"] == []
    assert set(detail["docker"]) == {"available", "reason"}
    assert [p["id"] for p in a.get(BASE).json()] == [project["id"]]
    events = a.get(f"{BASE}/{project['id']}/events").json()
    assert events[0]["action"] == "create_project"


def test_create_rejects_unknown_model_and_empty_question(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    assert create(a, "00000000-0000-0000-0000-000000000000").status_code == 409
    assert create(a, model, question="  ").status_code == 422


def test_other_user_cannot_read(env):
    app, a, b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    project = create(a, model).json()
    assert b.get(f"{BASE}/{project['id']}").status_code == 404
    assert b.post(f"{BASE}/{project['id']}/stop", json={}).status_code == 404
    assert b.get(BASE).json() == []


def test_stop_cancels_running_sprint(env):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    project = create(a, model).json()
    with app.state.maker() as d:
        run = AgentRun(
            owner=owner,
            session_id=project["session_id"],
            model_config_id=model,
            model="MiniMax-M3",
            prompt="sprint",
            status="running",
            lane="research",
        )
        d.add(run)
        d.flush()
        d.add(ResearchSprint(project_id=project["id"], number=1, run_id=run.id))
        d.commit()
        run_id = run.id
    assert a.post(f"{BASE}/{project['id']}/pause", json={}).json()["status"] == "paused"
    assert (
        a.post(f"{BASE}/{project['id']}/resume", json={}).json()["status"] == "active"
    )
    stopped = a.post(f"{BASE}/{project['id']}/stop", json={}).json()
    assert stopped["status"] == "finished" and stopped["end_reason"] == "stopped"
    with app.state.maker() as d:
        assert d.get(AgentRun, run_id).status == "cancelled"
    # A finished project is not started again.
    assert a.post(f"{BASE}/{project['id']}/resume", json={}).status_code == 409


def test_the_hosted_site_offers_no_research_even_to_admins(env):
    _app, a, b, settings = env
    settings.mode = "cloud"
    for client in (a, b):  # alice is an admin, bob is not
        r = client.get(BASE)
        assert r.status_code == 403
        assert "本机版" in r.json()["detail"]
    assert a.get("/api/v1/research/workspaces").status_code == 403


def waiting_project(app, a, settings):
    from backend import research_map as rm
    from backend.models import ResearchProject, ResearchSprint
    from backend.research_advice import apply

    _, model = configure(app, a, settings)
    project = create(a, model).json()
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        root = rm.root(d, p)
        hyp = rm.add_node(
            d, p, root.id, "hypothesis", "H", kill_if="k", actor="executor"
        )
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="advisor")
        d.add(sprint)
        d.flush()
        apply(
            d,
            p,
            sprint,
            {
                "verdicts": [
                    {
                        "node_id": hyp.id,
                        "verdict": "ask_human",
                        "reason": "is this interesting?",
                        "proposal": "kill",
                    }
                ]
            },
        )
        d.commit()
        return project, hyp.id


def test_decide_approve_applies_and_resumes(env):
    app, a, _b, settings = env
    project, hyp = waiting_project(app, a, settings)
    assert a.get(f"{BASE}/{project['id']}").json()["project"]["status"] == "waiting"
    [decision] = a.get(f"{BASE}/{project['id']}/decisions").json()
    assert decision["detail"]["proposal"] == "kill" and decision["open"] is True
    r = a.post(
        f"{BASE}/{project['id']}/decisions/{decision['id']}",
        json={"approve": True, "note": "agreed"},
    )
    assert r.status_code == 200, r.text
    detail = a.get(f"{BASE}/{project['id']}").json()
    assert detail["project"]["status"] == "active"
    assert next(n for n in detail["nodes"] if n["id"] == hyp)["status"] == "abandoned"
    assert a.get(f"{BASE}/{project['id']}/decisions").json()[0]["open"] is False
    again = a.post(
        f"{BASE}/{project['id']}/decisions/{decision['id']}",
        json={"approve": True},
    )
    assert again.status_code == 409


def test_decide_reject_keeps_node(env):
    app, a, _b, settings = env
    project, hyp = waiting_project(app, a, settings)
    [decision] = a.get(f"{BASE}/{project['id']}/decisions").json()
    a.post(
        f"{BASE}/{project['id']}/decisions/{decision['id']}",
        json={"approve": False, "note": "keep it, it matters"},
    )
    detail = a.get(f"{BASE}/{project['id']}").json()
    assert detail["project"]["status"] == "active"
    assert next(n for n in detail["nodes"] if n["id"] == hyp)["status"] == "open"


def test_evaluation_switches_accepted(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    project = create(
        a,
        model,
        budget={
            "max_sprints": 3,
            "auto_decide": True,
            "playbook": False,
            "distill": False,
        },
    ).json()
    assert project["budget"]["auto_decide"] is True
    assert project["budget"]["playbook"] is False
    assert project["budget"]["distill"] is False


def test_waiting_project_cannot_be_resumed(env):
    """Review #4: an open decision is answered, not skipped by resume."""
    app, a, _b, settings = env
    project, _ = waiting_project(app, a, settings)
    assert a.post(f"{BASE}/{project['id']}/resume", json={}).status_code == 409
    assert a.post(f"{BASE}/{project['id']}/pause", json={}).status_code == 409


def test_decide_is_applied_once(env):
    """Review #5: the same decision posted twice acts once."""
    app, a, _b, settings = env
    project, _ = waiting_project(app, a, settings)
    [decision] = a.get(f"{BASE}/{project['id']}/decisions").json()
    url = f"{BASE}/{project['id']}/decisions/{decision['id']}"
    first = a.post(url, json={"approve": True})
    second = a.post(url, json={"approve": True})
    assert first.status_code == 200 and second.status_code == 409
    from backend.models import ResearchEvent

    with app.state.maker() as d:
        assert len(d.query(ResearchEvent).filter_by(action="human_decision").all()) == 1


def test_playbook_list_and_review(env):
    from backend import research_playbook as pb

    app, a, b, settings = env
    book = pb.load(settings)
    pb.apply_ops(
        book,
        [
            {"op": "ADD", "when": "w1", "do": "d1", "why": "y1"},
            {"op": "ADD", "when": "w2", "do": "d2", "why": "y2"},
        ],
        "p1",
        "distiller",
    )
    pb.save(settings, book)
    first, second = (r["id"] for r in book["rules"])
    listed = a.get("/api/v1/research/playbook").json()
    assert listed["version"] == 1 and len(listed["rules"]) == 2
    assert listed["history"][-1]["added"] == 2
    r = a.post(f"/api/v1/research/playbook/rules/{first}", json={"approve": True})
    assert r.status_code == 200
    a.post(f"/api/v1/research/playbook/rules/{second}", json={"approve": False})
    rules = {x["id"]: x for x in a.get("/api/v1/research/playbook").json()["rules"]}
    assert rules[first]["status"] == "active" and rules[second]["status"] == "retired"
    assert (
        a.post(
            "/api/v1/research/playbook/rules/nope", json={"approve": True}
        ).status_code
        == 404
    )
    settings.mode = "cloud"
    assert a.get("/api/v1/research/playbook").status_code == 403


def test_upload_and_list_workspace_files(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    project = create(a, model).json()
    url = f"{BASE}/{project['id']}/files"
    r = a.post(url, files={"file": ("data.csv", b"f0,y\n1,0\n2,1\n", "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "data/data.csv"
    from backend.research_sandbox import workdir

    assert (
        (workdir(settings, project["id"]) / "data" / "data.csv")
        .read_bytes()
        .startswith(b"f0,y")
    )
    listed = a.get(url).json()
    assert [f["path"] for f in listed] == ["data/data.csv"] and listed[0]["size"] == 13
    # Names cannot leave the data folder.
    bad = a.post(url, files={"file": ("../escape.csv", b"x", "text/csv")})
    assert bad.status_code == 200 and bad.json()["path"] == "data/escape.csv"
    hidden = a.post(url, files={"file": (".ora-visible", b"x", "text/plain")})
    assert hidden.status_code == 422


def test_input_needed_project_resumes_after_input(env):
    from backend import research_map as rm
    from backend.models import ResearchProject, ResearchSprint
    from backend.research_advice import apply

    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    project = create(a, model).json()
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        root = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="advisor")
        d.add(sprint)
        d.flush()
        apply(
            d,
            p,
            sprint,
            {
                "verdicts": [
                    {"node_id": root.id, "verdict": "continue", "reason": "x"}
                ],
                "conclude": {"status": "blocked", "summary": "need second.csv"},
            },
        )
        d.commit()
    detail = a.get(f"{BASE}/{project['id']}").json()
    assert detail["project"]["status"] == "waiting"
    assert detail["input_needed"] == "need second.csv"
    assert (
        a.post(f"{BASE}/{project['id']}/resume", json={}).json()["status"] == "active"
    )


def test_report_downloads_as_markdown(env):
    app, a, b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    project = create(a, model).json()
    r = a.get(f"{BASE}/{project['id']}/report?lang=en")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "attachment" in r.headers["content-disposition"]
    assert r.text.startswith("# Does L2 regularization help?")
    assert b.get(f"{BASE}/{project['id']}/report").status_code == 404


def test_list_shows_how_each_finished_project_was_answered(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    project = create(a, model).json()
    from backend import research_map
    from backend.models import ResearchProject

    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        research_map.event(
            d,
            p,
            None,
            "advisor",
            "concluded",
            {"status": "refuted", "summary": "No: L2 hurts."},
        )
        p.status, p.end_reason = "finished", "refuted"
        d.commit()
    listed = a.get(BASE).json()
    assert listed[0]["conclusion"] == "No: L2 hurts."


def test_a_project_starts_from_a_message(env):
    app, a, _b, settings = env
    _, model = configure(app, a, settings)
    r = a.post(
        BASE, json={"message": "想提升手写数字识别准确率", "model_config_id": model}
    )
    assert r.status_code == 200, r.text
    project = r.json()
    assert project["stage"] == "scoping" and project["compute_id"] == "host"
    pid = project["id"]
    assert (
        a.post(f"{BASE}/{pid}/messages", json={"text": "基线 99.2%"}).status_code == 200
    )
    said = [
        (e["actor"], e["detail"]["text"])
        for e in a.get(f"{BASE}/{pid}/events").json()
        if e["action"] == "message"
    ]
    assert said == [("human", "想提升手写数字识别准确率"), ("human", "基线 99.2%")]
    # No plan yet: nothing to approve.
    assert a.post(f"{BASE}/{pid}/plan/approve", json={"version": 1}).status_code == 409
    assert a.post(BASE, json={"model_config_id": model}).status_code == 422


def test_research_settings_never_show_the_key(env):
    app, a, _b, settings = env
    settings.mode = "local"
    r = a.put(
        "/api/v1/research/settings",
        json={"tracker": {"kind": "wandb", "project": "p", "api_key": "secret"}},
    )
    assert r.status_code == 200, r.text
    shown = a.get("/api/v1/research/settings").json()
    assert "secret" not in str(shown) and shown["tracker"]["has_key"]
    assert {d["name"] for d in shown["datasets"]} >= {"mnist"}
    bad = {"computes": [{"id": "x", "kind": "ssh", "host": "a;b"}]}
    assert a.put("/api/v1/research/settings", json=bad).status_code == 422


def test_a_project_can_move_to_another_compute(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(BASE, json={"message": "MNIST", "model_config_id": model}).json()["id"]
    url = f"{BASE}/{pid}/compute"
    assert a.post(url, json={"compute_id": "nowhere"}).status_code == 422
    a.put(
        "/api/v1/research/settings",
        json={"computes": [{"id": "wsl", "kind": "ssh", "host": "wsl-box"}]},
    )
    moved = a.post(url, json={"compute_id": "wsl"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["compute_id"] == "wsl"
    events = a.get(f"{BASE}/{pid}/events").json()
    assert events[-1]["action"] == "compute_changed"
    assert events[-1]["detail"] == {"from": "host", "to": "wsl"}


def test_an_environment_is_prepared_by_an_agent_run(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    base = "/api/v1/research/environments"
    assert a.post(f"{base}/local/prepare", json={}).status_code == 409
    a.put(
        "/api/v1/research/settings",
        json={"computes": [{"id": "wsl", "kind": "ssh", "host": "research-wsl"}]},
    )
    started = a.post(f"{base}/wsl/prepare", json={"model_config_id": model})
    assert started.status_code == 200, started.text
    assert started.json()["state"]["status"] == "preparing"
    progress = a.get(f"{base}/wsl/progress").json()
    assert progress["run"]["status"] == "queued" and progress["steps"] == []
    shown = a.get("/api/v1/research/settings").json()
    assert shown["states"]["wsl"]["status"] == "preparing"


def test_a_research_run_can_be_watched_by_its_owner_only(env):
    app, a, b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    a.put(
        "/api/v1/research/settings",
        json={"computes": [{"id": "wsl", "kind": "ssh", "host": "research-wsl"}]},
    )
    run_id = a.post(
        "/api/v1/research/environments/wsl/prepare", json={"model_config_id": model}
    ).json()["run_id"]
    with app.state.maker() as d:
        run = d.get(AgentRun, run_id)
        run.steps = [{"name": "bash", "status": "completed", "said": "先看看显卡"}]
        d.commit()
    shown = a.get(f"/api/v1/research/runs/{run_id}").json()
    assert shown["status"] == "queued" and shown["role"] == "envsetup"
    assert shown["steps"][0]["said"] == "先看看显卡"
    assert "prompt" not in shown
    assert b.get(f"/api/v1/research/runs/{run_id}").status_code == 404


def test_the_runs_of_a_project_come_with_their_steps(env):
    app, a, b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(BASE, json={"message": "MNIST", "model_config_id": model}).json()["id"]
    with app.state.maker() as d:
        run = AgentRun(
            owner=d.get(ResearchProject, pid).owner,
            session_id=d.get(ResearchProject, pid).session_id,
            model_config_id=model,
            model="m",
            prompt="secret brief",
            lane="research",
            response="好的",
            steps=[
                {
                    "name": "bash",
                    "status": "completed",
                    "said": "先看看",
                    "result": {"summary": "x" * 9000},
                }
            ],
        )
        d.add(run)
        d.flush()
        d.add(ResearchSprint(project_id=pid, number=1, role="scoping", run_id=run.id))
        d.commit()
    runs = a.get(f"{BASE}/{pid}/runs").json()
    assert len(runs) == 1
    one = runs[0]
    assert one["sprint_number"] == 1 and one["role"] == "scoping"
    assert one["steps"][0]["said"] == "先看看" and "prompt" not in one
    assert len(one["steps"][0]["result"]["summary"]) <= 4000
    assert b.get(f"{BASE}/{pid}/runs").status_code == 404


def test_the_researcher_can_restate_the_question(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(
        BASE, json={"message": "CPU only MNIST", "model_config_id": model}
    ).json()["id"]
    r = a.post(
        f"{BASE}/{pid}/question", json={"question": "GPU MNIST", "note": "不再限制 CPU"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["question"] == "GPU MNIST"
    detail = a.get(f"{BASE}/{pid}").json()
    root = [n for n in detail["nodes"] if n["parent_id"] is None][0]
    assert root["title"] == "GPU MNIST"
    last = a.get(f"{BASE}/{pid}/events").json()[-1]
    assert last["action"] == "question_changed" and last["actor"] == "human"
    assert (
        last["detail"]["from"] == "CPU only MNIST"
        and last["detail"]["note"] == "不再限制 CPU"
    )
    assert a.post(f"{BASE}/{pid}/question", json={"question": "  "}).status_code == 422


def test_limits_are_lifted_and_a_running_retrospective_stops(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(BASE, json={"message": "MNIST", "model_config_id": model}).json()["id"]
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.status, p.end_reason, p.stage = "finished", "budget", "retrospective"
        run = AgentRun(
            owner=p.owner,
            session_id=p.session_id,
            model_config_id=model,
            model="m",
            prompt="x",
            lane="research",
            status="running",
        )
        d.add(run)
        d.flush()
        d.add(ResearchSprint(project_id=pid, number=9, role="distiller", run_id=run.id))
        d.commit()
        run_id = run.id
    r = a.post(f"{BASE}/{pid}/limits", json={"note": "先不设置上限"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "active" and out["stage"] == "experiments"
    assert out["budget"]["max_sprints"] is None
    with app.state.maker() as d:
        assert d.get(AgentRun, run_id).status == "cancelled"


WS = "/api/v1/research/workspaces"


def test_projects_hold_researches_and_a_board(env):
    app, a, b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    w = a.post(WS, json={"name": "MNIST", "description": "手写数字"}).json()
    assert w["name"] == "MNIST"
    r = a.post(
        BASE,
        json={
            "message": "想提高准确率",
            "model_config_id": model,
            "workspace_id": w["id"],
        },
    )
    assert r.status_code == 200 and r.json()["workspace_id"] == w["id"]
    card = a.post(f"{WS}/{w['id']}/cards", json={"title": "试试 EMA"}).json()
    assert (
        a.patch(
            f"/api/v1/research/cards/{card['id']}", json={"status": "todo"}
        ).status_code
        == 200
    )
    started = a.post(
        f"/api/v1/research/cards/{card['id']}/start", json={"model_config_id": model}
    )
    assert started.status_code == 200, started.text
    board = a.get(f"{WS}/{w['id']}/board").json()
    kinds = sorted(c["kind"] for c in board["cards"])
    assert kinds == ["research", "research"]
    detail = a.get(f"{WS}/{w['id']}").json()
    assert len(detail["researches"]) == 2
    listed = {x["id"]: x for x in a.get(WS).json()}
    assert listed[w["id"]]["researches"] == 2
    patched = a.patch(f"{WS}/{w['id']}", json={"instructions": "只用公开数据"}).json()
    assert patched["instructions"] == "只用公开数据"
    assert b.get(f"{WS}/{w['id']}").status_code == 404


def test_a_research_without_a_project_goes_to_the_default_one(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    r = a.post(BASE, json={"message": "Q", "model_config_id": model}).json()
    assert r["workspace_id"]
    names = [w["name"] for w in a.get(WS).json()]
    assert names == ["我的研究"]


def test_leaving_an_unreachable_machine_that_ran_nothing_is_allowed(env, monkeypatch):
    from backend import research_remote

    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(BASE, json={"message": "MNIST", "model_config_id": model}).json()["id"]
    a.put(
        "/api/v1/research/settings",
        json={"computes": [{"id": "wsl", "kind": "ssh", "host": "wsl-box"}]},
    )
    a.post(f"{BASE}/{pid}/compute", json={"compute_id": "wsl"})

    def offline(*_a, **_k):
        raise ValueError("连不上 wsl-box")

    monkeypatch.setattr(research_remote, "pull", offline)
    moved = a.post(f"{BASE}/{pid}/compute", json={"compute_id": "host"})
    assert moved.status_code == 200, moved.text
    with app.state.maker() as d:
        from backend.models import ResearchJob

        p = d.get(ResearchProject, pid)
        p.stage = "experiments"
        p.compute_id = "wsl"
        d.add(
            ResearchJob(
                project_id=pid,
                node_id="n",
                sprint_id="s",
                command="x",
                status="succeeded",
                compute_id="wsl",
            )
        )
        d.commit()
    assert (
        a.post(f"{BASE}/{pid}/compute", json={"compute_id": "host"}).status_code == 409
    )


def test_moving_the_environment_also_moves_the_pending_plan(env):
    app, a, _b, settings = env
    settings.mode = "local"
    _, model = configure(app, a, settings)
    pid = a.post(BASE, json={"message": "MNIST", "model_config_id": model}).json()["id"]
    with app.state.maker() as d:
        p = d.get(ResearchProject, pid)
        p.plan = {"version": 1, "compute_id": "host", "approved_at": None}
        d.commit()
    assert (
        a.post(f"{BASE}/{pid}/compute", json={"compute_id": "local"}).status_code == 200
    )
    with app.state.maker() as d:
        assert d.get(ResearchProject, pid).plan["compute_id"] == "local"


def test_pausing_stops_the_round_and_the_jobs_but_can_resume(env, monkeypatch):
    from backend import research_sandbox

    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    project = create(a, model).json()
    stopped = []
    monkeypatch.setattr(
        research_sandbox,
        "stop_jobs",
        lambda s, d, pid, note=None: stopped.append((pid, note)),
    )
    with app.state.maker() as d:
        run = AgentRun(
            owner=owner,
            session_id=project["session_id"],
            model_config_id=model,
            model="m",
            prompt="sprint",
            status="running",
            lane="research",
        )
        d.add(run)
        d.flush()
        d.add(
            ResearchSprint(
                project_id=project["id"], number=1, run_id=run.id, status="running"
            )
        )
        d.commit()
        run_id = run.id
    paused = a.post(f"{BASE}/{project['id']}/pause", json={})
    assert paused.json()["status"] == "paused"
    with app.state.maker() as d:
        assert d.get(AgentRun, run_id).status == "cancelled"
        # The page must not keep showing an agent at work.
        sprint = d.scalars(
            select(ResearchSprint).where(ResearchSprint.run_id == run_id)
        ).one()
        assert sprint.status != "running"
    assert stopped == [(project["id"], research_sandbox.PAUSED_NOTE)]
    assert (
        a.post(f"{BASE}/{project['id']}/resume", json={}).json()["status"] == "active"
    )
