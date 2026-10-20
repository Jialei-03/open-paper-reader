import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select

import backend.agent_worker as worker
from backend import research_sandbox as rs
from backend import research_worker as rw
from backend.agent_worker import process
from backend.models import (
    AgentRun,
    ResearchJob,
    ResearchNode,
    ResearchProject,
    ResearchSprint,
)
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure

SKILL_FIRST_LINE = "# 研究执行者"


class ScriptedModel:
    """An OpenAI-compatible model that answers each request from a script.

    A script entry is ("tool", name, args), ("text", words), or a callable
    returning one of those (to use ids only known while the run goes on).
    """

    def __init__(self, script):
        self.script = list(script)
        self.requests = []
        model = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                model.requests.append(body)
                step = model.script.pop(0) if model.script else ("text", "done")
                if callable(step):
                    step = step()
                if step[0] == "tool":
                    delta = {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": f"call_{len(model.requests)}",
                                "type": "function",
                                "function": {
                                    "name": step[1],
                                    "arguments": json.dumps(step[2]),
                                },
                            }
                        ],
                    }
                    finish = "tool_calls"
                else:
                    delta, finish = {"role": "assistant", "content": step[1]}, "stop"
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for choice in [
                    {"delta": delta, "finish_reason": None},
                    {"delta": {}, "finish_reason": finish},
                ]:
                    frame = {
                        "id": "x",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": "MiniMax-M3",
                        "choices": [{"index": 0, **choice}],
                    }
                    self.wfile.write(("data: " + json.dumps(frame) + "\n\n").encode())
                usage = {
                    "id": "x",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "MiniMax-M3",
                    "choices": [],
                    "usage": {
                        "prompt_tokens": 100,
                        "completion_tokens": 20,
                        "total_tokens": 120,
                    },
                }
                self.wfile.write(("data: " + json.dumps(usage) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_port}/v1"


@pytest.fixture
def lab(env, monkeypatch):
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    project = a.post(
        "/api/v1/research/projects",
        json={"question": "Does L2 regularization help?", "model_config_id": model},
    ).json()
    holder = {}
    original = worker.read_config
    monkeypatch.setattr(
        worker,
        "read_config",
        lambda *args: {**original(*args), "base_url": holder["model"].url},
    )
    monkeypatch.setattr(worker, "validate_endpoint", lambda value: value)
    # The sandbox stands in for Docker: jobs finish when swept, with a fixed log.
    monkeypatch.setattr(rs, "docker_status", lambda: {"available": True, "reason": ""})
    monkeypatch.setattr(
        rs,
        "pi_call",
        lambda settings, pid, name, args: {"content": [{"type": "text", "text": "ok"}]},
    )

    def start_job(settings, d, project, node, sprint, command, timeout):
        job = ResearchJob(
            project_id=project.id, node_id=node.id, sprint_id=sprint.id, command=command
        )
        d.add(job)
        d.flush()
        return job

    def sweep(settings, maker):
        with maker() as d:
            for job in d.scalars(
                select(ResearchJob).where(ResearchJob.status == "running")
            ):
                text = job.command.removeprefix("echo ") + "\n"
                (rs.logdir(settings, job.project_id) / f"{job.id}.log").write_text(text)
                job.status, job.exit_code, job.log_lines = "succeeded", 0, 1
            d.commit()

    monkeypatch.setattr(rs, "start_job", start_job)
    monkeypatch.setattr(rs, "sweep", sweep)

    def run_sprint(script):
        holder["model"] = ScriptedModel(script)
        with app.state.maker() as d:
            sprint = d.scalars(
                select(ResearchSprint)
                .where(ResearchSprint.project_id == project["id"])
                .order_by(ResearchSprint.number.desc())
            ).first()
            run = d.get(AgentRun, sprint.run_id)
            run.status = "running"
            d.commit()
            run_id = run.id
        process(app, run_id)
        return holder["model"]

    yield app, project, run_sprint


def newest(app, project_id, kind):
    with app.state.maker() as d:
        return d.scalars(
            select(ResearchNode)
            .where(ResearchNode.project_id == project_id, ResearchNode.kind == kind)
            .order_by(ResearchNode.created_at.desc())
        ).first()


def sprints(app, project_id):
    with app.state.maker() as d:
        return list(
            d.scalars(
                select(ResearchSprint)
                .where(ResearchSprint.project_id == project_id)
                .order_by(ResearchSprint.number)
            )
        )


def test_tick_creates_first_sprint_with_brief(lab):
    app, project, _ = lab
    rw.tick(app)
    [sprint] = sprints(app, project["id"])
    with app.state.maker() as d:
        run = d.get(AgentRun, sprint.run_id)
        assert run.lane == "research" and run.status == "queued"
        assert run.runtime["research"] == {
            "project_id": project["id"],
            "sprint_id": sprint.id,
            "role": "executor",
        }
        assert "Does L2 regularization help?" in run.prompt
        assert "question/open" in run.prompt
        assert "end_sprint" in run.prompt
        assert d.get(ResearchProject, project["id"]).spent["sprints"] == 1
    rw.tick(app)
    assert len(sprints(app, project["id"])) == 1  # one sprint at a time


def test_research_run_has_no_history_and_custom_system_prompt(lab):
    app, project, run_sprint = lab
    rw.tick(app)
    model = run_sprint(
        [
            ("tool", "research_map_read", {}),
            ("tool", "end_sprint", {"summary": "read the map"}),
            ("text", "ok"),
        ]
    )
    first = model.requests[0]
    assert first["messages"][0]["role"] in {"system", "developer"}
    assert SKILL_FIRST_LINE in first["messages"][0]["content"]
    assert [m["role"] for m in first["messages"][1:]] == ["user"]
    names = {t["function"]["name"] for t in first["tools"]}
    assert {"focus", "record_result", "run_job", "bash", "search_papers"} <= names
    assert "workspace_write" not in names


def test_scripted_sprint_end_to_end(lab):
    app, project, run_sprint = lab
    root = newest(app, project["id"], "question")
    rw.tick(app)

    def hyp():
        return newest(app, project["id"], "hypothesis").id

    def job_id():
        with app.state.maker() as d:
            return d.scalars(select(ResearchJob)).one().id

    run_sprint(
        [
            ("tool", "research_map_read", {}),
            ("tool", "focus", {"node_id": root.id, "intent": "split the question"}),
            (
                "tool",
                "add_node",
                {
                    "parent_id": root.id,
                    "kind": "hypothesis",
                    "title": "Moderate L2 improves test accuracy",
                    "kill_if": "no gain over no-L2 on 3 seeds",
                    "reason": "first guess",
                },
            ),
            lambda: ("tool", "focus", {"node_id": hyp(), "intent": "run the sweep"}),
            ("tool", "run_job", {"command": "echo acc=0.91"}),
            lambda: (
                "tool",
                "end_sprint",
                {
                    "summary": "started the sweep",
                    "next_focus": "read results",
                    "waiting_on": [job_id()],
                },
            ),
            ("text", "waiting for the job"),
        ]
    )
    [first] = sprints(app, project["id"])
    assert first.status == "ended" and first.waiting_on == [job_id()]
    rw.tick(app)  # the job finishes, and the next sprint is planned
    second = sprints(app, project["id"])[-1]
    assert second.number == 2
    with app.state.maker() as d:
        brief = d.get(AgentRun, second.run_id).prompt
    assert job_id() in brief and "started the sweep" in brief
    run_sprint(
        [
            lambda: ("tool", "focus", {"node_id": hyp(), "intent": "record"}),
            lambda: (
                "tool",
                "record_result",
                {
                    "node_id": hyp(),
                    "summary": "acc=0.91 with moderate L2",
                    "evidence": [
                        {
                            "kind": "log",
                            "job_id": job_id(),
                            "from_line": 1,
                            "to_line": 1,
                        }
                    ],
                    "kill_triggered": "no",
                    "confidence": 0.7,
                },
            ),
            ("tool", "end_sprint", {"summary": "recorded"}),
            ("text", "done"),
        ]
    )
    with app.state.maker() as d:
        node = d.get(ResearchNode, hyp())
        assert node.evidence_for[0]["evidence"][0]["lines"] == ["acc=0.91"]
        assert node.confidence == 0.7
        # Tokens spent while the hypothesis was in focus are charged to it.
        assert node.spent_tokens > 0
        assert d.get(ResearchProject, project["id"]).spent["tokens"] > 0
    assert sprints(app, project["id"])[-1].tokens > 0


def test_abnormal_end_gets_fallback_summary(lab):
    app, project, run_sprint = lab
    rw.tick(app)
    run_sprint([("tool", "research_map_read", {}), ("text", "")])
    rw.tick(app)
    first, second = sprints(app, project["id"])
    assert first.status == "abnormal"
    assert "research_map_read" in first.summary
    assert second.number == 2
    with app.state.maker() as d:
        assert "未正常交接" in d.get(AgentRun, second.run_id).prompt


def test_budget_exhausted_finishes_an_evaluation_run(lab):
    app, project, _ = lab
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        # Nobody to ask in an evaluation run: the budget ends it.
        p.budget = {**p.budget, "max_sprints": 1, "auto_decide": True}
        p.spent = {**p.spent, "sprints": 1}
        d.commit()
    rw.tick(app)
    assert sprints(app, project["id"]) == []
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        assert p.status == "finished" and p.end_reason == "budget"


def test_paused_project_gets_no_sprint(lab):
    app, project, _ = lab
    with app.state.maker() as d:
        d.get(ResearchProject, project["id"]).status = "paused"
        d.commit()
    rw.tick(app)
    assert sprints(app, project["id"]) == []


def past_sprint(app, project_id, number, role="executor", events=(), waiting=()):
    """A sprint that already ran: its run completed and it handed over."""
    from backend.research_map import event

    with app.state.maker() as d:
        project = d.get(ResearchProject, project_id)
        run = AgentRun(
            owner=project.owner,
            session_id=project.session_id,
            model_config_id=project.model_config_id,
            model="MiniMax-M3",
            prompt="past",
            status="completed",
            lane="research",
        )
        d.add(run)
        d.flush()
        sprint = ResearchSprint(
            project_id=project_id,
            number=number,
            role=role,
            run_id=run.id,
            status="ended",
            summary=f"sprint {number} summary",
            waiting_on=list(waiting),
        )
        d.add(sprint)
        d.flush()
        for action, detail in events:
            event(d, project, None, role, action, detail, sprint.id)
        project.spent = {**project.spent, "sprints": number}
        d.commit()
        return sprint.id


def planned(app, project_id):
    latest = sprints(app, project_id)[-1]
    with app.state.maker() as d:
        return latest, d.get(AgentRun, latest.run_id)


PROGRESS = [("add_node", {"kind": "hypothesis"})]


def test_advisor_every_three_sprints(lab):
    app, project, _ = lab
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    sprint, run = planned(app, project["id"])
    assert sprint.role == "advisor" and sprint.number == 4
    assert run.runtime["research"]["role"] == "advisor"
    assert "advise" in run.prompt and "sprint 3 summary" in run.prompt


def test_advisor_is_told_when_this_is_its_last_review(lab):
    app, project, _ = lab
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.budget = {**p.budget, "max_sprints": 6}
        d.commit()
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    sprint, run = planned(app, project["id"])
    assert sprint.role == "advisor" and "最后一次评审" in run.prompt


def test_advisor_with_budget_left_is_not_hurried(lab):
    app, project, _ = lab
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    sprint, run = planned(app, project["id"])
    assert sprint.role == "advisor" and "最后一次评审" not in run.prompt


def test_advisor_reads_why_its_last_verdicts_did_not_apply(lab):
    app, project, _ = lab
    past_sprint(app, project["id"], 1, events=PROGRESS)
    past_sprint(
        app,
        project["id"],
        2,
        role="advisor",
        events=[
            (
                "advice_skipped",
                {
                    "verdict": "kill",
                    "note": "北极星问题本身不能放弃；用 conclude 结束项目",
                },
            )
        ],
    )
    for n in (3, 4, 5):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    sprint, run = planned(app, project["id"])
    assert sprint.role == "advisor"
    assert "上次没有生效" in run.prompt and "用 conclude 结束项目" in run.prompt


def test_no_advisor_twice_in_a_row(lab):
    app, project, _ = lab
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    past_sprint(app, project["id"], 4, role="advisor")
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "executor"


def test_kill_unsure_triggers_advisor(lab):
    app, project, _ = lab
    past_sprint(
        app, project["id"], 1, events=[("record_result", {"kill_triggered": "unsure"})]
    )
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "advisor"


def test_finding_triggers_advisor(lab):
    app, project, _ = lab
    past_sprint(app, project["id"], 1, events=[("add_node", {"kind": "finding"})])
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "advisor"


def test_stall_triggers_advisor(lab):
    app, project, _ = lab
    past_sprint(app, project["id"], 1)
    past_sprint(app, project["id"], 2)
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "advisor"


def test_needs_input_triggers_advisor_at_once(lab):
    app, project, _ = lab
    past_sprint(
        app,
        project["id"],
        1,
        events=PROGRESS + [("end_sprint", {"needs_input": "/work/data/second.csv"})],
    )
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "advisor"


def test_waiting_on_jobs_is_not_a_stall(lab):
    app, project, _ = lab
    past_sprint(app, project["id"], 1, waiting=["j1"])
    past_sprint(app, project["id"], 2)
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "executor"


def test_budget_half_triggers_advisor_once(lab):
    app, project, _ = lab
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.budget = {**p.budget, "max_sprints": 4}
        d.commit()
    past_sprint(app, project["id"], 1, events=PROGRESS)
    past_sprint(app, project["id"], 2, events=PROGRESS)
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "advisor"


def test_silent_advisor_does_not_block(lab):
    app, project, run_sprint = lab
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    run_sprint([("tool", "research_map_read", {}), ("text", "I have no opinion")])
    rw.tick(app)
    advisor, executor = sprints(app, project["id"])[-2:]
    assert advisor.role == "advisor" and advisor.status == "abnormal"
    assert executor.role == "executor"
    from backend.models import ResearchEvent

    with app.state.maker() as d:
        assert d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "advisor_silent")
        ).first()


def test_advisor_run_uses_advisor_skill_and_tools(lab):
    app, project, run_sprint = lab
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    root = newest(app, project["id"], "question")
    model = run_sprint(
        [
            (
                "tool",
                "advise",
                {
                    "verdicts": [
                        {"node_id": root.id, "verdict": "continue", "reason": "fine"}
                    ],
                    "assessment": "keep going on the sweep",
                },
            ),
            ("text", "done"),
        ]
    )
    first = model.requests[0]
    assert "# 研究导师" in first["messages"][0]["content"]
    names = {t["function"]["name"] for t in first["tools"]}
    assert "advise" in names and "bash" not in names and "run_job" not in names
    rw.tick(app)
    executor = sprints(app, project["id"])[-1]
    with app.state.maker() as d:
        brief = d.get(AgentRun, executor.run_id).prompt
    assert "导师意见" in brief and "keep going on the sweep" in brief


def failed_sprint(
    app,
    project_id,
    number,
    error="模型服务返回 HTTP 503：服务暂时出错，请稍后重试",
    steps=(),
):
    """A sprint whose run failed on the model service, before or after doing anything."""
    with app.state.maker() as d:
        project = d.get(ResearchProject, project_id)
        run = AgentRun(
            owner=project.owner,
            session_id=project.session_id,
            model_config_id=project.model_config_id,
            model="MiniMax-M3",
            prompt="x",
            status="failed",
            error=error,
            steps=list(steps),
            lane="research",
        )
        d.add(run)
        d.flush()
        d.add(ResearchSprint(project_id=project_id, number=number, run_id=run.id))
        project.spent = {**project.spent, "sprints": project.spent["sprints"] + 1}
        d.commit()


def test_model_outage_does_not_spend_the_budget(lab):
    app, project, _ = lab
    failed_sprint(app, project["id"], 1)
    rw.tick(app)
    first = sprints(app, project["id"])[0]
    assert first.status == "abnormal"
    with app.state.maker() as d:
        # The run did nothing: its sprint is given back.
        assert d.get(ResearchProject, project["id"]).spent["sprints"] == 0


def test_model_outage_backs_off(lab, monkeypatch):
    app, project, _ = lab
    failed_sprint(app, project["id"], 1)
    rw.tick(app)
    # The next try waits: no new sprint right after an outage.
    assert len(sprints(app, project["id"])) == 1
    monkeypatch.setattr(rw, "_now", lambda: rw._now_real() + 10**6)
    rw.tick(app)
    assert len(sprints(app, project["id"])) == 2


def test_repeated_outage_pauses_with_reason(lab, monkeypatch):
    app, project, _ = lab
    for n in range(1, rw.OUTAGE_LIMIT + 1):
        failed_sprint(app, project["id"], n)
    monkeypatch.setattr(rw, "_now", lambda: rw._now_real() + 10**6)
    rw.tick(app)
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        assert p.status == "paused"
    from backend.models import ResearchEvent

    with app.state.maker() as d:
        paused = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "paused")
        ).one()
        assert "模型" in paused.detail["reason"]


def finish(app, project_id):
    with app.state.maker() as d:
        p = d.get(ResearchProject, project_id)
        p.status, p.end_reason = "finished", "budget"
        d.commit()


def test_finished_project_gets_one_distiller(lab):
    app, project, run_sprint = lab
    past_sprint(app, project["id"], 1, events=PROGRESS)
    finish(app, project["id"])
    rw.tick(app)
    rw.tick(app)
    distillers = [s for s in sprints(app, project["id"]) if s.role == "distiller"]
    assert len(distillers) == 1
    with app.state.maker() as d:
        run = d.get(AgentRun, distillers[0].run_id)
        assert run.runtime["research"]["role"] == "distiller"
        # Distilling is not research: the project's budget is untouched.
        assert d.get(ResearchProject, project["id"]).spent["sprints"] == 1
        assert "研究手册" in run.prompt or "distill" in run.prompt


def test_distiller_run_updates_playbook(lab):
    from backend import research_playbook as pb

    app, project, run_sprint = lab
    past_sprint(app, project["id"], 1, events=PROGRESS)
    finish(app, project["id"])
    rw.tick(app)
    model = run_sprint(
        [
            (
                "tool",
                "distill",
                {
                    "ops": [
                        {
                            "op": "ADD",
                            "when": "the data a task names is missing from /work",
                            "do": "say so in doubts and stop; never synthesize data",
                            "why": "sprints 1-3 were blocked by an unmounted directory",
                        }
                    ]
                },
            ),
            ("text", "done"),
        ]
    )
    first = model.requests[0]
    assert "# 研究提炼者" in first["messages"][0]["content"]
    names = {t["function"]["name"] for t in first["tools"]}
    assert "distill" in names and "bash" not in names and "add_node" not in names
    book = pb.load(app.state.settings)
    assert book["version"] == 1 and book["rules"][0]["status"] == "pending"
    rw.tick(app)
    assert len([s for s in sprints(app, project["id"]) if s.role == "distiller"]) == 1


def test_brief_includes_active_rules(lab):
    from backend import research_playbook as pb

    app, project, _ = lab
    book = pb.load(app.state.settings)
    pb.apply_ops(
        book,
        [
            {
                "op": "ADD",
                "when": "a kill_if is nearly met",
                "do": "ask the advisor",
                "why": "x",
            }
        ],
        "p0",
        "distiller",
    )
    book["rules"][0]["status"] = "active"
    pb.save(app.state.settings, book)
    rw.tick(app)
    with app.state.maker() as d:
        sprint = sprints(app, project["id"])[-1]
        prompt = d.get(AgentRun, sprint.run_id).prompt
        assert "ask the advisor" in prompt
        from backend.models import ResearchEvent

        version = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "playbook_version")
        ).one()
        assert version.detail["version"] == 1


def test_playbook_off_and_no_distill(lab):
    from backend import research_playbook as pb

    app, project, _ = lab
    book = pb.load(app.state.settings)
    pb.apply_ops(
        book, [{"op": "ADD", "when": "w", "do": "secret rule", "why": "x"}], "p0", "d"
    )
    book["rules"][0]["status"] = "active"
    pb.save(app.state.settings, book)
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.budget = {**p.budget, "playbook": False, "distill": False}
        d.commit()
    rw.tick(app)
    with app.state.maker() as d:
        assert (
            "secret rule"
            not in d.get(AgentRun, sprints(app, project["id"])[-1].run_id).prompt
        )
    finish(app, project["id"])
    rw.tick(app)
    assert not [s for s in sprints(app, project["id"]) if s.role == "distiller"]


def test_resume_after_outage_pause_plans_again(lab, monkeypatch):
    """Review #1: a resumed project is not paused again by the same old outages."""
    app, project, _ = lab
    for n in range(1, rw.OUTAGE_LIMIT + 1):
        failed_sprint(app, project["id"], n)
    monkeypatch.setattr(rw, "_now", lambda: rw._now_real() + 10**6)
    rw.tick(app)
    with app.state.maker() as d:
        assert d.get(ResearchProject, project["id"]).status == "paused"
    from backend.research_map import event

    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.status = "active"
        event(d, p, None, "human", "active", {})
        d.commit()
    rw.tick(app)
    assert sprints(app, project["id"])[-1].number == rw.OUTAGE_LIMIT + 1


def test_sweep_failure_does_not_stop_planning(lab, monkeypatch):
    """Review #2: Docker trouble while sweeping must not stall every project."""
    app, project, _ = lab

    def broken(settings, maker):
        raise OSError("docker: command not found")

    monkeypatch.setattr(rs, "sweep", broken)
    rw.tick(app)
    assert len(sprints(app, project["id"])) == 1


def test_no_sprint_while_docker_unavailable(lab, monkeypatch):
    """Review #3: without Docker, executor sprints would only spend tokens."""
    app, project, _ = lab
    with app.state.maker() as d:
        d.get(ResearchProject, project["id"]).compute_id = "local"
        d.commit()
    monkeypatch.setattr(
        rs,
        "docker_status",
        lambda: {"available": False, "reason": "未安装或未启动 Docker"},
    )
    rw.tick(app)
    rw.tick(app)
    assert sprints(app, project["id"]) == []
    from backend.models import ResearchEvent

    with app.state.maker() as d:
        events = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "docker_unavailable")
        ).all()
        assert len(events) == 1


def test_budget_end_does_not_override_a_stop(lab):
    """Review #6: only an active project is moved by the scheduler."""
    app, project, _ = lab
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.budget = {**p.budget, "max_sprints": 1}
        p.spent = {**p.spent, "sprints": 1}
        d.commit()
        project_row = d.get(ResearchProject, project["id"])
        project_row.status = "paused"
        d.commit()
    rw.tick(app)
    with app.state.maker() as d:
        assert d.get(ResearchProject, project["id"]).status == "paused"


def test_reply_without_end_sprint_is_the_handoff(lab):
    """A sprint that answered in words (not end_sprint) handed over in those words."""
    app, project, run_sprint = lab
    rw.tick(app)
    run_sprint(
        [
            ("tool", "research_map_read", {}),
            ("text", "Scaling raised accuracy from 49% to 86%; next: test k."),
        ]
    )
    rw.tick(app)
    first = sprints(app, project["id"])[0]
    assert first.status == "ended"
    assert first.summary.startswith("Scaling raised accuracy")


def test_votes_only_count_for_rules_the_project_ran_with(lab):
    """A rule that was not active when the project started was not tried: no vote."""
    from backend import research_playbook as pb

    app, project, run_sprint = lab
    book = pb.load(app.state.settings)
    pb.apply_ops(
        book,
        [
            {"op": "ADD", "when": "w1", "do": "active rule", "why": "x"},
            {"op": "ADD", "when": "w2", "do": "pending rule", "why": "x"},
        ],
        "p0",
        "d",
    )
    book["rules"][0]["status"] = "active"
    pb.save(app.state.settings, book)
    active_id, pending_id = book["rules"][0]["id"], book["rules"][1]["id"]
    rw.tick(app)  # first sprint records the playbook in effect
    finish(app, project["id"])
    rw.tick(app)
    run_sprint(
        [
            (
                "tool",
                "distill",
                {
                    "votes": [
                        {"id": active_id, "helpful": True},
                        {"id": pending_id, "helpful": False},
                    ]
                },
            ),
            ("text", "done"),
        ]
    )
    book = pb.load(app.state.settings)
    rules = {r["id"]: r for r in book["rules"]}
    assert rules[active_id]["helpful"] == 1
    assert rules[pending_id]["harmful"] == 0


def test_brief_lists_workspace_data_files(lab):
    app, project, _ = lab
    folder = rs.workdir(app.state.settings, project["id"]) / "data"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "measurements.csv").write_text("a,b\n1,2\n")
    rw.tick(app)
    with app.state.maker() as d:
        prompt = d.get(AgentRun, sprints(app, project["id"])[-1].run_id).prompt
    assert "- data/measurements.csv" in prompt


def test_advisor_off_for_ablation(lab):
    app, project, _ = lab
    with app.state.maker() as d:
        p = d.get(ResearchProject, project["id"])
        p.budget = {**p.budget, "advisor": False}
        d.commit()
    for n in (1, 2, 3):
        past_sprint(app, project["id"], n, events=PROGRESS)
    rw.tick(app)
    assert planned(app, project["id"])[0].role == "executor"
