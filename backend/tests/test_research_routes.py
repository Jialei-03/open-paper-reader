from backend.models import AgentRun, ResearchSprint
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure

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


def test_cloud_non_admin_forbidden(env):
    _app, a, b, _settings = env
    r = b.get(BASE)
    assert r.status_code == 403
    assert "本机版" in r.json()["detail"]
    assert a.get(BASE).status_code == 200


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
    assert b.get("/api/v1/research/playbook").status_code == 403


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
