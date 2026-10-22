"""Talking the plan through, and the records an experiment leaves behind."""

import io
import json
import time
import subprocess
import sys
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend import research_datasets as rd
from backend import research_map as rm
from backend import research_remote as rr
from backend import research_sandbox as rs
from backend import research_settings as rset
from backend import research_stages as st
from backend import research_tracker as rt
from backend import research_worker as rw
from backend.config import Settings, database
from backend.models import (
    AgentRun,
    Base,
    ResearchDataset,
    ResearchEvent,
    ResearchJob,
    ResearchProject,
    ResearchSprint,
    User,
)
from backend.tests.test_research_sandbox import FakeDocker

PLAN = {
    "question": "MNIST 上测试准确率能否稳定超过 99.5%？",
    "metric": "官方测试集准确率，3 个种子平均",
    "baseline": "两层 CNN 约 99.2%",
    "hypotheses": [
        {"title": "数据增强能提升 0.2 个点以上", "kill_if": "3 个种子平均提升 < 0.1"},
        {"title": "更深的网络更好", "kill_if": "提升 < 0.1 或过拟合"},
    ],
    "datasets": ["mnist"],
    "budget": {"max_sprints": 12, "max_job_hours": 2},
    "summary": "先复现基线再改。",
}


@pytest.fixture
def world(tmp_path, monkeypatch):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "r.db"),
        storage=str(tmp_path / "files"),
        testing=True,
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    docker = FakeDocker()
    monkeypatch.setattr(rs, "run", docker)
    monkeypatch.setattr(rs, "_status_cache", {})
    monkeypatch.setattr(rw, "read_config", lambda *a: {"model": "m"})
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, maker=maker))
    with maker() as d:
        user = User(username="r", password="x")
        d.add(user)
        d.flush()
        p = rm.create_project(d, user.id, "想把手写数字识别准确率再提一提", "", "m")
        p.stage = "scoping"
        st.say(d, p, "human", "想把手写数字识别准确率再提一提")
        d.commit()
        pid = p.id
    yield SimpleNamespace(
        app=app, maker=maker, settings=settings, docker=docker, pid=pid
    )
    engine.dispose()


def _finish_run(w, response):
    with w.maker() as d:
        sprint = d.scalars(
            select(ResearchSprint).order_by(ResearchSprint.number.desc())
        ).first()
        run = d.get(AgentRun, sprint.run_id)
        run.status, run.response = "completed", response
        d.commit()
        return sprint.id


def test_scoping_is_a_conversation_and_spends_no_sprint(world):
    with world.maker() as d:
        rw._plan(world.app, d, d.get(ResearchProject, world.pid))
        d.commit()
        sprint = d.scalars(select(ResearchSprint)).one()
        assert sprint.role == "scoping"
        run = d.get(AgentRun, sprint.run_id)
        assert "想把手写数字识别准确率再提一提" in run.prompt
        assert "mnist" in run.context  # context is refreshed without repeating it in Pi's user history
        assert d.get(ResearchProject, world.pid).spent["sprints"] == 0
    _finish_run(world, "基线现在多少？")
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        rw._plan(world.app, d, p)
        d.commit()
        # Answered: nothing more starts until the person speaks again.
        assert st.unanswered(d, p) == []
        rw._plan(world.app, d, p)
        assert len(list(d.scalars(select(ResearchSprint)))) == 1
        said = [
            (e.actor, e.detail["text"])
            for e in d.scalars(
                select(ResearchEvent).where(ResearchEvent.action == "message")
            )
        ]
        assert said[-1] == ("advisor", "基线现在多少？")
        st.say(d, p, "human", "大概 99.2%")
        rw._plan(world.app, d, p)
        assert len(list(d.scalars(select(ResearchSprint)))) == 2


def test_a_plan_is_approved_onto_the_map(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        sprint = ResearchSprint(project_id=p.id, number=1, role="scoping", run_id="r")
        d.add(sprint)
        d.flush()
        assert st.propose_plan(world.settings, d, p, sprint, PLAN) == {"version": 1}
        st.propose_plan(world.settings, d, p, sprint, PLAN)
        with pytest.raises(ValueError, match="最新"):
            st.approve_plan(world.settings, d, p, 1)
        st.approve_plan(world.settings, d, p, 2, "先别用太大的网络")
        assert p.stage == "experiments" and p.status == "active"
        assert p.question == PLAN["question"]
        hyps = [n for n in rm.nodes(d, p) if n.kind == "hypothesis"]
        assert [h.kill_if for h in hyps] == [h["kill_if"] for h in PLAN["hypotheses"]]
        assert p.budget["max_job_seconds"] == 7200
        row = d.scalars(select(ResearchDataset)).one()
        assert (row.name, row.status, row.path) == ("mnist", "pending", "/data/mnist")
        assert "先别用太大的网络" in st.human_notes(d, p)


def test_a_plan_needs_kill_conditions_and_known_data(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        sprint = ResearchSprint(project_id=p.id, number=1, role="scoping", run_id="r")
        bad = {**PLAN, "hypotheses": [{"title": "x", "kill_if": ""}]}
        with pytest.raises(ValueError, match="止损"):
            st.propose_plan(world.settings, d, p, sprint, bad)
        with pytest.raises(ValueError, match="数据集"):
            st.propose_plan(
                world.settings, d, p, sprint, {**PLAN, "datasets": ["imagenet"]}
            )


def test_experiments_wait_for_their_datasets(world, monkeypatch):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        rd.request(d, p, ["mnist"])
        rw._plan(world.app, d, p)
        assert list(d.scalars(select(ResearchSprint))) == []


def test_dataset_files_are_checked_against_their_published_hash(world, monkeypatch):
    monkeypatch.setattr(rd, "urlopen", lambda url, timeout: io.BytesIO(b"not mnist"))
    with world.maker() as d:
        rd.request(d, d.get(ResearchProject, world.pid), ["mnist"])
        d.commit()
    rd.fetch_pending(world.settings, world.maker)
    with world.maker() as d:
        row = d.scalars(select(ResearchDataset)).one()
        assert row.status == "failed" and "校验不符" in row.note


def test_the_brief_gives_the_checksums_a_dataset_was_verified_against(world):
    # An executor once "checked" MNIST against md5s it remembered and wrongly
    # concluded the labels had been recompressed: it is told what was checked.
    from backend.research_brief import _datasets

    files = [
        {"name": name, "md5": md5, "bytes": 1, "sha256": "s"}
        for name, _url, md5 in rd.REGISTRY["mnist"]["files"]
    ]
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        d.add(
            ResearchDataset(
                project_id=p.id,
                name="mnist",
                source="registry",
                path="/data/mnist",
                status="ready",
                files=files,
                note="ossci-datasets.s3.amazonaws.com",
            )
        )
        d.flush()
        text = _datasets(d, p)
    assert "发布方 md5" in text and "ossci-datasets.s3.amazonaws.com" in text
    assert "train-labels-idx1-ubyte.gz md5 d53e105ee54ea40749a09fcbcd1e9432" in text
    assert "t10k-labels-idx1-ubyte.gz md5 ec29112dd5afa0611ce80d1b7f02629c" in text
    assert "以这里的值为准" in text


def test_a_slow_download_does_not_hold_up_the_scheduler(world, monkeypatch):
    import threading

    gate = threading.Event()

    class Slow(io.BytesIO):
        def read(self, n=-1):
            gate.wait(5)
            return super().read(n)

    monkeypatch.setattr(rd, "urlopen", lambda url, timeout: Slow(b"x" * 10))
    with world.maker() as d:
        rd.request(d, d.get(ResearchProject, world.pid), ["mnist"])
        d.commit()
    started = time.monotonic()
    thread = rd.start_fetching(world.settings, world.maker)
    assert time.monotonic() - started < 1
    assert rd.start_fetching(world.settings, world.maker) is None  # one at a time
    with world.maker() as d:
        assert d.scalars(select(ResearchDataset)).one().status == "pending"
    gate.set()
    thread.join(10)
    with world.maker() as d:
        assert d.scalars(select(ResearchDataset)).one().status == "failed"


def test_settings_keep_the_key_server_side(world):
    data = rset.update(
        world.settings,
        {
            "computes": [
                {
                    "id": "lab",
                    "name": "实验室",
                    "kind": "ssh",
                    "host": "gpu-box",
                    "gpus": "0,1",
                }
            ],
            "default_compute": "lab",
            "tracker": {"kind": "swanlab", "project": "mnist", "api_key": "secret"},
        },
    )
    assert [c["id"] for c in data["computes"]] == ["host", "lab"]
    shown = rset.public(rset.load(world.settings))
    assert "api_key" not in shown["tracker"] and shown["tracker"]["has_key"]
    # Saving again without a key keeps the stored one.
    rset.update(world.settings, {"tracker": {"kind": "swanlab"}})
    assert rset.load(world.settings)["tracker"]["api_key"] == "secret"
    for host in ("a b", "x;rm -rf ~", "-oProxyCommand=x"):
        with pytest.raises(ValueError, match="SSH"):
            rset.check_compute({"id": "x", "kind": "ssh", "host": host})


def test_a_job_reports_through_ora_into_its_own_folder(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        job = rs.start_job(world.settings, d, p, node, sprint, "python train.py", 600)
        d.commit()
        args = world.docker.calls[-1]
        mounts = [args[i + 1] for i, a in enumerate(args) if a == "--mount"]
        assert any(m.endswith("target=/ora-run") for m in mounts)
        assert any(m.endswith("target=/opt/ora,readonly") for m in mounts)
        assert "ORA_RUN_DIR=/ora-run" in args and "PYTHONPATH=/opt/ora" in args
        assert p.environment["local"]["python"] == "3.11.9"
        folder = rs.rundir(world.settings, p.id, job.id)
        (folder / "config.json").write_text(json.dumps({"lr": 0.001}))
        (folder / "metrics.jsonl").write_text(
            '{"step": 0, "t": 1, "test_acc": 0.98}\n{"step": 1, "t": 2, "test_acc": 0.99}\n'
        )
        (folder / "summary.json").write_text(json.dumps({"test_acc": 0.991}))
        world.docker.containers[job.container]["running"] = False
        rs._sweep_one(world.settings, d, job)
        assert job.status == "succeeded"
        assert job.config == {"lr": 0.001}
        assert job.metrics == {"step": 1, "test_acc": 0.991}
        assert job.points == 2


def test_run_job_is_refused_while_scoping(world):
    from backend.research_tools import _run

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="executor")
        d.add(sprint)
        d.commit()
        research = {"project_id": p.id, "sprint_id": sprint.id, "role": "executor"}
    with pytest.raises(ValueError, match="实验阶段"):
        _run(world.app, p.owner, research, "run_job", {"command": "ls"})


def test_the_ora_module_prints_what_it_records(tmp_path, monkeypatch, capsys):
    import importlib.util

    monkeypatch.setenv("ORA_RUN_DIR", str(tmp_path))
    spec = importlib.util.spec_from_file_location("ora", rs.ORA_DIR / "ora.py")
    ora = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ora)
    ora.config({"lr": 0.001})
    ora.log({"test_acc": 0.98765}, step=3)
    ora.summary({"test_acc": float("nan")})
    out = capsys.readouterr().out
    assert "ORA_METRIC step=3 test_acc=0.98765" in out
    assert json.loads((tmp_path / "summary.json").read_text()) == {"test_acc": "nan"}


class FakeSSH:
    def __init__(self):
        self.calls = []
        self.state = "running"

    def __call__(self, args, **kw):
        self.calls.append(args)
        if args[0] == "rsync":
            return subprocess.CompletedProcess(args, 0, "", "")
        script = args[-1]
        if "echo $!" in script:
            return subprocess.CompletedProcess(args, 0, "4242\n", "")
        if "kill -0" in script:
            return subprocess.CompletedProcess(args, 0, self.state + "\n", "")
        return subprocess.CompletedProcess(args, 0, "", "")


def test_a_remote_job_runs_detached_and_reports_its_exit(world, monkeypatch):
    fake = FakeSSH()
    monkeypatch.setattr(rs, "run", fake)
    item = rset.check_compute(
        {
            "id": "lab",
            "kind": "ssh",
            "host": "gpu-box",
            "remote_dir": "~/ora",
            "gpus": "1",
        }
    )
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        job = ResearchJob(
            id="j1", project_id=p.id, node_id="n", sprint_id="s", command="python t.py"
        )
        rr.start(world.settings, d, item, p, job)
        assert job.remote == {"host": "gpu-box", "base": f"~/ora/{p.id}", "pid": 4242}
        launch = fake.calls[-1][-1]
        # The executor picks GPUs per command; the setting no longer hides any.
        assert "CUDA_VISIBLE_DEVICES" not in launch
        assert "'(\nset -o pipefail; python t.py\n)\necho $?" in launch
        assert rr.state(job) == {"Running": True}
        fake.state = "0"
        assert rr.state(job) == {"Running": False, "ExitCode": 0}
        fake.state = "gone"
        assert rr.state(job) is rs.GONE


def test_no_tracker_means_nothing_is_uploaded(world):
    with world.maker() as d:
        job = ResearchJob(
            project_id=world.pid,
            node_id="n",
            sprint_id="s",
            command="x",
            status="succeeded",
        )
        d.add(job)
        d.commit()
    rt.sync_pending(world.settings, world.maker)
    with world.maker() as d:
        assert d.scalars(select(ResearchJob)).one().tracker_url == "none"


def test_the_tracker_gets_the_key_in_its_own_process(world, monkeypatch):
    rset.update(world.settings, {"tracker": {"kind": "swanlab", "api_key": "k"}})
    seen = {}

    def fake(args, input, env, **kw):
        seen["env"], seen["payload"] = env, json.loads(input)
        return subprocess.CompletedProcess(
            args, 0, '{"url": "https://swanlab.cn/x"}\n', ""
        )

    monkeypatch.setattr(rt.subprocess, "run", fake)
    with world.maker() as d:
        node = rm.root(d, d.get(ResearchProject, world.pid))
        job = ResearchJob(
            project_id=world.pid,
            node_id=node.id,
            sprint_id="s",
            command="x",
            status="succeeded",
            metrics={"test_acc": 0.99},
        )
        d.add(job)
        d.flush()
        rt.sync_one(world.settings, d, job)
        assert job.tracker_url == "https://swanlab.cn/x"
    assert seen["env"]["SWANLAB_API_KEY"] == "k"
    assert seen["payload"]["summary"] == {"test_acc": 0.99}
    assert "api_key" not in json.dumps(seen["payload"])


def test_an_answered_message_turns_the_next_sprint_into_the_advisor(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        s1 = ResearchSprint(project_id=p.id, number=1, run_id="a", status="ended")
        d.add(s1)
        d.flush()
        st.say(d, p, "human", "H2 先别做")
        assert rw.next_role(d, p, [s1]) == "advisor"


def test_scoping_may_read_literature_but_not_run_anything(world):
    from backend.research_tools import gate

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="scoping")
        d.add(sprint)
        d.commit()
        research = {"project_id": p.id, "sprint_id": sprint.id, "role": "scoping"}
    for name in (
        "search_papers",
        "read_paper",
        "web_read",
        "propose_plan",
        "project_overview",
        "job_logs",
    ):
        gate(world.app, research, name)
    for name in ("run_job", "bash", "advise", "add_node"):
        with pytest.raises(ValueError, match="实验开始前"):
            gate(world.app, research, name)


def test_scoping_turns_do_not_count_as_rounds_before_a_review(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        talk = [
            ResearchSprint(
                project_id=p.id, number=n, run_id="r", role="scoping", status="ended"
            )
            for n in (1, 2, 3)
        ]
        d.add_all(talk)
        d.flush()
        st.say(d, p, "advisor", "计划已生效")
        assert rw.next_role(d, p, talk) == "executor"


def _tools(tmp_path, name, args):
    done = subprocess.run(
        [sys.executable, str(rs.ORA_DIR / "tools.py")],
        input=json.dumps({"name": name, "args": args}) + "\n",
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_remote_tools_work_in_the_workspace_and_stay_inside_it(tmp_path):
    assert (
        "Successfully wrote"
        in _tools(
            tmp_path, "write", {"path": "a/train.py", "content": "x = 1\ny = 2\n"}
        )["result"]["content"][0]["text"]
    )
    _tools(
        tmp_path,
        "edit",
        {"path": "a/train.py", "edits": [{"oldText": "y = 2", "newText": "y = 3"}]},
    )
    assert (tmp_path / "a/train.py").read_text() == "x = 1\ny = 3\n"
    read = _tools(tmp_path, "read", {"path": "a/train.py", "offset": 2})
    assert read["result"]["content"][0]["text"] == "y = 3"
    grep = _tools(tmp_path, "grep", {"pattern": "y =", "glob": "*.py"})
    assert "a/train.py:2: y = 3" in grep["result"]["content"][0]["text"]
    assert (
        "train.py"
        in _tools(tmp_path, "find", {"pattern": "*.py"})["result"]["content"][0]["text"]
    )
    assert _tools(tmp_path, "ls", {})["result"]["content"][0]["text"] == "a/"
    failed = _tools(tmp_path, "bash", {"command": "echo hi; exit 3"})["result"]
    assert failed["isError"] and "hi" in failed["content"][0]["text"]
    assert "工作区" in _tools(tmp_path, "read", {"path": "../outside"})["error"]


def test_tool_calls_of_an_ssh_project_run_on_that_machine(world, monkeypatch):
    calls = []

    def fake(args, input=None, **kw):
        calls.append(args)
        if args[0] == "ssh" and input:
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps({"result": {"content": [{"type": "text", "text": "ok"}]}})
                + "\n",
                "",
            )
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(rs, "run", fake)
    rset.update(
        world.settings,
        {
            "computes": [
                {"id": "wsl", "kind": "ssh", "host": "wsl-box", "remote_dir": "~/ora"}
            ]
        },
    )
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.compute_id = "wsl"
        data = rs.workdir(world.settings, p.id) / "data"
        data.mkdir()
        (data / "x.csv").write_text("1")
        out = rs.pi_call(world.settings, p.id, "ls", {}, d)
        assert out["content"][0]["text"] == "ok"
        rsyncs = [c for c in calls if c[0] == "rsync"]
        # Uploads go over, and nothing on that machine is deleted.
        assert any(c[-1] == f"wsl-box:~/ora/{p.id}/work/data/" for c in rsyncs)
        assert not any("--delete" in c for c in rsyncs)
        assert calls[-1][-1].startswith(
            f"cd ~/ora/{p.id}/work && env PYTHONPATH=~/ora/ora"
        )
        before = len(calls)
        rs.pi_call(world.settings, p.id, "ls", {}, d)
        # Nothing changed, so nothing is copied again.
        assert len(calls) == before + 1


def test_a_moved_project_takes_its_workspace_along_once(world, monkeypatch):
    calls, seeded = [], {"v": False}

    def fake(args, input=None, **kw):
        calls.append(args)
        script = args[-1] if args[0] == "ssh" else ""
        if "test -e" in script:
            return subprocess.CompletedProcess(
                args, 0, "yes\n" if seeded["v"] else "no\n", ""
            )
        if "touch" in script:
            seeded["v"] = True
        if args[0] == "ssh" and input:
            return subprocess.CompletedProcess(
                args, 0, json.dumps({"result": {"content": []}}) + "\n", ""
            )
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(rs, "run", fake)
    rr._prepared.clear()
    rset.update(
        world.settings, {"computes": [{"id": "wsl", "kind": "ssh", "host": "wsl-box"}]}
    )
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.compute_id = "wsl"
        (rs.workdir(world.settings, p.id) / "train.py").write_text("print(1)")
        rs.pi_call(world.settings, p.id, "ls", {}, d)
        whole = [c for c in calls if c[0] == "rsync" and c[-1].endswith("/work/")]
        assert len(whole) == 1 and "--delete" not in whole[0]
        rr._prepared.clear()
        rs.pi_call(world.settings, p.id, "ls", {}, d)
        assert (
            len([c for c in calls if c[0] == "rsync" and c[-1].endswith("/work/")]) == 1
        )


def test_a_remote_python_comes_first_on_the_path(world, monkeypatch):
    fake = FakeSSH()
    monkeypatch.setattr(rs, "run", fake)
    rr._prepared.clear()
    item = rset.check_compute(
        {
            "id": "wsl",
            "kind": "ssh",
            "host": "research-wsl",
            "python": "~/ora-venv/bin/python",
        }
    )
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        job = ResearchJob(
            id="j2", project_id=p.id, node_id="n", sprint_id="s", command="python3 t.py"
        )
        rr.start(world.settings, d, item, p, job)
        assert "PATH=~/ora-venv/bin:$PATH " in fake.calls[-1][-1]


def test_a_failure_inside_a_pipe_is_a_failed_job(world, monkeypatch):
    fake = FakeSSH()
    monkeypatch.setattr(rs, "run", fake)
    item = rset.check_compute({"id": "wsl", "kind": "ssh", "host": "research-wsl"})
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        job = ResearchJob(
            id="j3",
            project_id=p.id,
            node_id="n",
            sprint_id="s",
            command="python3 t.py | tail -3",
        )
        rr.start(world.settings, d, item, p, job)
        assert "set -o pipefail; python3 t.py | tail -3" in fake.calls[-1][-1]
    done = subprocess.run(["bash", "-c", rs.strict("false | tail -1")])
    assert done.returncode != 0


def test_an_executor_round_keeps_the_focus_of_the_last_one(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        root = rm.root(d, p)
        hyp = rm.add_node(
            d, p, root.id, "hypothesis", "H1", kill_if="k", actor="human", reason="r"
        )
        last = ResearchSprint(
            project_id=p.id,
            number=1,
            run_id="r",
            role="executor",
            status="ended",
            focus_node_id=hyp.id,
        )
        d.add(last)
        d.commit()
        rw._start(world.app, d, p, last, "executor", {"model": "m"})
        d.commit()
        new = d.scalars(select(ResearchSprint).where(ResearchSprint.number == 2)).one()
        assert new.focus_node_id == hyp.id
        hyp.status = "refuted"
        rw._start(world.app, d, p, new, "executor", {"model": "m"})
        third = d.scalars(
            select(ResearchSprint).where(ResearchSprint.number == 3)
        ).one()
        assert third.focus_node_id is None


def test_briefs_say_when_the_environment_changed(world):
    from backend.research_brief import executor_brief

    rset.update(
        world.settings,
        {"computes": [{"id": "wsl", "name": "WSL GPU", "kind": "ssh", "host": "h"}]},
    )
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        rm.event(d, p, None, "human", "compute_changed", {"from": "local", "to": "wsl"})
        p.compute_id = "wsl"
        brief = executor_brief(d, p, 5, world.settings)
        assert "研究环境换过" in brief and "WSL GPU" in brief


def test_a_spent_budget_asks_the_researcher_before_ending(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        p.budget = {**p.budget, "max_sprints": 4}
        p.spent = {**p.spent, "sprints": 4}
        rw._plan(world.app, d, p)
        rw._plan(world.app, d, p)
        d.commit()
        assert p.status == "waiting" and p.stage == "experiments"
        asks = list(
            d.scalars(
                select(ResearchEvent).where(
                    ResearchEvent.action == "decision_requested"
                )
            )
        )
        assert len(asks) == 1 and asks[0].detail["kind"] == "budget"
        assert asks[0].detail["extra_sprints"] == 4
        st.decide(d, p, asks[0], True, "")
        assert p.status == "active" and p.budget["max_sprints"] == 8


def test_declining_more_budget_ends_the_project(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        p.budget = {**p.budget, "max_sprints": 2}
        p.spent = {**p.spent, "sprints": 2}
        rw._plan(world.app, d, p)
        ask = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "decision_requested")
        ).one()
        st.decide(d, p, ask, False, "够了")
        assert p.status == "finished" and p.end_reason == "budget"
        assert p.stage == "retrospective"


def test_a_round_cut_by_a_restart_is_given_back(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        p.spent = {**p.spent, "sprints": 3}
        run = AgentRun(
            owner=p.owner,
            session_id=p.session_id,
            model_config_id="m",
            model="m",
            prompt="x",
            lane="research",
            status="failed",
            error="服务重启",
            runtime={"interrupted": True},
            steps=[{"name": "bash", "status": "completed"}],
        )
        d.add(run)
        d.flush()
        d.add(ResearchSprint(project_id=p.id, number=1, run_id=run.id, role="executor"))
        d.flush()
        rw._plan(world.app, d, p)
        assert (
            p.spent["sprints"] == 3 - 1 + 1
        )  # given back, then the next round started


def test_a_project_ended_by_its_budget_can_be_given_more(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage, p.status, p.end_reason = "retrospective", "finished", "budget"
        p.budget = {**p.budget, "max_sprints": 12}
        st.extend(d, p, 8, 2.0)
        assert p.status == "active" and p.stage == "experiments" and p.end_reason == ""
        assert p.budget["max_sprints"] == 20
        assert p.budget["max_job_seconds"] == (p.budget["max_job_seconds"])


def test_a_project_without_limits_never_runs_out(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        p.budget = {
            **p.budget,
            "max_sprints": None,
            "max_tokens": None,
            "max_job_seconds": None,
        }
        p.spent = {"sprints": 500, "tokens": 10**9, "job_seconds": 10**7}
        assert not rw._over_budget(p)
        history = [
            ResearchSprint(
                project_id=p.id, number=1, run_id="r", role="executor", status="ended"
            )
        ]
        d.add_all(history)
        d.flush()
        rw.next_role(d, p, history)  # no budget marks to compute, and no error


def test_a_plan_without_a_budget_sets_no_limits(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        sprint = ResearchSprint(project_id=p.id, number=1, role="scoping", run_id="r")
        d.add(sprint)
        d.flush()
        plan = {k: v for k, v in PLAN.items() if k != "budget"}
        st.propose_plan(world.settings, d, p, sprint, plan)
        st.approve_plan(world.settings, d, p, 1)
        assert p.budget["max_sprints"] is None and p.budget["max_job_seconds"] is None


def test_limits_can_be_lifted_and_an_ended_project_reopened(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage, p.status, p.end_reason = "retrospective", "finished", "budget"
        st.lift_limits(d, p, "先不设置上限")
        assert p.status == "active" and p.stage == "experiments"
        assert p.budget["max_sprints"] is None and p.budget["max_tokens"] is None


def test_a_reopened_project_is_not_closed_by_a_late_retrospective(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        d.add(
            ResearchSprint(
                project_id=p.id, number=1, run_id="r", role="executor", status="ended"
            )
        )
        d.add(
            ResearchSprint(
                project_id=p.id,
                number=2,
                run_id="r",
                role="distiller",
                status="abnormal",
            )
        )
        p.status = "active"
        rw._distill(world.app, d, p)
        assert p.stage == "experiments"


def test_reopening_puts_a_closed_stage_back_to_experiments(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage, p.status = "done", "waiting"
        st.lift_limits(d, p)
        assert p.stage == "experiments" and p.status == "active"


def test_blocking_needs_a_real_reason(world):
    from backend.research_advice import apply

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="advisor")
        d.add(sprint)
        d.flush()
        root = rm.root(d, p)
        out = apply(
            d,
            p,
            sprint,
            {
                "verdicts": [
                    {"node_id": root.id, "verdict": "continue", "reason": "x"}
                ],
                "conclude": {"status": "blocked", "summary": "占位"},
            },
        )
        assert p.status != "waiting"
        assert any("blocked" in n for n in out.get("notes", []))


def test_a_finished_run_is_recorded_on_its_node_by_the_system(world):
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        node = rm.root(d, p)
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r")
        d.add(sprint)
        d.flush()
        job = rs.start_job(world.settings, d, p, node, sprint, "python t.py", 600)
        folder = rs.rundir(world.settings, p.id, job.id)
        (folder / "config.json").write_text(json.dumps({"tag": "base_s0"}))
        (folder / "summary.json").write_text(json.dumps({"final_test_acc": 0.9945}))
        world.docker.containers[job.container]["running"] = False
        rs._sweep_one(world.settings, d, job)
        row = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "run_result")
        ).one()
        assert row.node_id == node.id and row.actor == "system"
        assert row.detail["metrics"]["final_test_acc"] == 0.9945
        assert row.detail["tag"] == "base_s0" and row.detail["status"] == "succeeded"


def test_the_advisor_can_ask_the_researcher_without_stopping_the_work(world):
    from backend.research_advice import apply

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        sprint = ResearchSprint(project_id=p.id, number=1, run_id="r", role="advisor")
        d.add(sprint)
        d.flush()
        root = rm.root(d, p)
        apply(
            d,
            p,
            sprint,
            {
                "verdicts": [
                    {"node_id": root.id, "verdict": "continue", "reason": "x"}
                ],
                "ask_researcher": "“紧凑 CNN”按参数 ≤100k 算可以吗？",
            },
        )
        ask = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "decision_requested")
        ).one()
        assert ask.detail["kind"] == "question" and p.status == "active"
        assert st.decide(d, p, ask, True, "可以，≤100k")
        said = d.scalars(
            select(ResearchEvent)
            .where(ResearchEvent.action == "message", ResearchEvent.actor == "human")
            .order_by(ResearchEvent.created_at.desc())
        ).first()
        assert "≤100k" in said.detail["text"]


def test_briefs_show_what_each_finished_job_measured(world):
    from backend.research_brief import advisor_brief, executor_brief

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        node = rm.root(d, p)
        d.add(
            ResearchJob(
                project_id=p.id,
                node_id=node.id,
                sprint_id="s",
                command="python train.py",
                status="succeeded",
                exit_code=0,
                config={"tag": "cnn-seed0"},
                metrics={"test_acc": 0.9123, "step": 400, "note": "x"},
                started_at="2026-10-20T10:00:00+00:00",
                finished_at="2026-10-20T10:05:00+00:00",
            )
        )
        d.flush()
        for brief in (executor_brief(d, p, 2), advisor_brief(d, p, 2)):
            assert "cnn-seed0" in brief and "test_acc=0.9123" in brief
            assert "step=" not in brief


def test_a_dataset_comes_from_its_fastest_mirror(world, monkeypatch):
    import hashlib

    content = b"cifar" * 50000

    class Stream(io.BytesIO):
        def __init__(self, data, pause):
            super().__init__(data)
            self.pause = pause

        def read(self, n=-1):
            time.sleep(self.pause)
            return super().read(min(n, 4096) if n and n > 0 else 4096)

    opened = []

    def fake(url, timeout):
        opened.append(url)
        return Stream(content, 0.3 if "slow" in url else 0)

    spec = {
        "title": "toy",
        "files": [
            (
                "toy.bin",
                ("https://slow.example/toy.bin", "https://fast.example/toy.bin"),
                hashlib.md5(content).hexdigest(),
            )
        ],
    }
    monkeypatch.setitem(rd.REGISTRY, "toy", spec)
    monkeypatch.setattr(rd, "urlopen", fake)
    monkeypatch.setattr(rd, "TRY_SECONDS", 0.5)
    row = ResearchDataset(project_id=world.pid, name="toy", source="registry")
    rd.fetch(world.settings, row)
    assert row.status == "ready" and row.note == "fast.example"
    assert opened[-1] == "https://fast.example/toy.bin"
    again = ResearchDataset(project_id=world.pid, name="toy", source="registry")
    rd.fetch(world.settings, again)
    assert again.status == "ready" and again.note == "本机缓存"


def test_a_download_cut_midway_is_tried_again(world, monkeypatch):
    import hashlib

    content = b"mnist" * 1000
    calls = []

    def flaky(url, timeout):
        calls.append(url)
        if len(calls) < 3:
            raise OSError("[SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred")
        return io.BytesIO(content)

    spec = {
        "title": "toy",
        "files": [("toy.bin", "https://one.example/toy.bin", hashlib.md5(content).hexdigest())],
    }
    monkeypatch.setitem(rd.REGISTRY, "toy", spec)
    monkeypatch.setattr(rd, "urlopen", flaky)
    monkeypatch.setattr(rd, "RETRY_WAIT", 0)
    row = ResearchDataset(project_id=world.pid, name="toy", source="registry")
    rd.fetch(world.settings, row)
    assert row.status == "ready" and len(calls) == 3

    monkeypatch.setattr(rd, "urlopen", lambda url, timeout: (_ for _ in ()).throw(OSError("down")))
    (rd.cache(world.settings) / "toy" / "toy.bin").unlink()
    with pytest.raises(OSError):
        rd.fetch(world.settings, ResearchDataset(project_id=world.pid, name="toy", source="registry"))


def test_a_download_is_on_the_project_record_as_it_goes(world, monkeypatch):
    monkeypatch.setattr(rd, "urlopen", lambda url, timeout: io.BytesIO(b"not mnist"))
    with world.maker() as d:
        rd.request(d, d.get(ResearchProject, world.pid), ["mnist"])
        d.commit()
    rd.fetch_pending(world.settings, world.maker)
    with world.maker() as d:
        said = [
            (e.action, e.detail["name"])
            for e in d.scalars(
                select(ResearchEvent).where(ResearchEvent.action.like("dataset_%"))
            )
        ]
        failed = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "dataset_failed")
        ).one()
    assert said == [("dataset_fetching", "mnist"), ("dataset_failed", "mnist")]
    assert "校验不符" in failed.detail["reason"]


def test_all_briefs_put_the_recorded_language_first(world):
    from backend.research_brief import (
        advisor_brief,
        executor_brief,
        scoping_brief,
        distiller_brief,
        workflow_brief,
    )

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.question = "The approved plan changed the question to English"
        for make_brief in (
            executor_brief,
            advisor_brief,
            scoping_brief,
            distiller_brief,
            workflow_brief,
        ):
            assert make_brief(d, p, 2).startswith(
                "## 语言\n研究者用中文提问。用研究者的语言说话"
            )
        created = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "create_project")
        ).one()
        created.detail = {**created.detail, "language": "en"}
        assert executor_brief(d, p, 2).startswith("## 语言\n研究者用英文提问")


def test_first_round_focuses_plan_order_and_can_switch(world):
    from backend.research_tools import _focus

    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        p.stage = "experiments"
        root = rm.root(d, p)
        later = rm.add_node(
            d, p, root.id, "hypothesis", "Later", kill_if="k", actor="human"
        )
        first = rm.add_node(
            d, p, root.id, "hypothesis", "First", kill_if="k", actor="human"
        )
        p.plan = {"hypotheses": [{"title": "First"}, {"title": "Later"}]}
        rw._start(world.app, d, p, None, "executor", {"model": "m"})
        sprint = d.scalars(select(ResearchSprint)).one()
        run = d.get(AgentRun, sprint.run_id)
        assert sprint.focus_node_id == first.id and first.status == "active"
        assert "本轮聚焦：First" in run.prompt
        _focus(d, p, sprint, {"node_id": later.id, "intent": "Switch"})
        rw._auto_focus(d, p, sprint)
        assert sprint.focus_node_id == later.id
        first.status = "supported"
        rw._start(world.app, d, p, sprint, "executor", {"model": "m"})
        second = d.scalars(
            select(ResearchSprint).where(ResearchSprint.number == 2)
        ).one()
        assert second.focus_node_id == later.id


@pytest.mark.parametrize(
    "reply, mode, expected",
    [
        ("手写数字优化器对比", "fake-ok", "手写数字优化器对比"),
        ("", "fake-empty", None),
        ("Title longer than sixteen characters", "fake-ok", None),
        ("ignored", "fake-500", None),
    ],
)
def test_title_uses_one_cheap_request_and_falls_back(
    world, monkeypatch, reply, mode, expected
):
    from backend import research_titles, translation_settings
    from backend.devtools.fake_model import FakeModel
    from backend.models import AgentSession, ModelUsage

    monkeypatch.setattr(translation_settings, "validate_endpoint", lambda url: url)
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        original = p.title
        rw._start(world.app, d, p, None, "scoping", {"model": mode})
        run_id = d.scalars(select(ResearchSprint)).one().run_id
        d.commit()
    with FakeModel(reply) as fake:
        config = {
            "model": mode,
            "base_url": fake.base_url,
            "api_key": "fake",
            "protocol": "openai",
        }
        research_titles.prepare(world.app, run_id, config)
        research_titles.prepare(world.app, run_id, config)
        assert len(fake.requests) == 1
        assert fake.requests[0]["max_tokens"] == 256
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        assert p.title == (expected or original)
        assert d.get(AgentSession, p.session_id).title == p.title
        assert d.scalars(select(ModelUsage)).one().source == "research_title"


def test_existing_or_renamed_conversations_do_not_get_titles(world, monkeypatch):
    from backend import research_titles

    calls = []

    def unexpected(*args, **kwargs):
        calls.append(args)
        raise AssertionError("No model request expected")

    monkeypatch.setattr(research_titles, "complete", unexpected)
    with world.maker() as d:
        p = d.get(ResearchProject, world.pid)
        created = d.scalars(
            select(ResearchEvent).where(ResearchEvent.action == "create_project")
        ).one()
        created.detail = {"question": p.question}
        rw._start(world.app, d, p, None, "scoping", {"model": "m"})
        run_id = d.scalars(select(ResearchSprint)).one().run_id
        d.commit()
    research_titles.prepare(world.app, run_id, {})
    with world.maker() as d:
        created = d.get(ResearchEvent, created.id)
        created.detail = {**created.detail, "title_pending": True}
        p = d.get(ResearchProject, world.pid)
        p.title = "User title"
        d.commit()
    research_titles.prepare(world.app, run_id, {})
    with world.maker() as d:
        assert d.get(ResearchProject, world.pid).title == "User title"
    assert not calls
