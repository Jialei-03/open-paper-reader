"""Talking the plan through, and the records an experiment leaves behind."""

import io
import json
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
        assert "mnist" in run.prompt  # the datasets the system can fetch
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
    assert [c["id"] for c in data["computes"]] == ["local", "lab"]
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
        _run(world.app, "o", research, "run_job", {"command": "ls"})


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
        assert (
            "CUDA_VISIBLE_DEVICES=1" in launch
            and "'(set -o pipefail; python t.py); echo $?" in launch
        )
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
    for name in ("search_papers", "read_paper", "web_read", "propose_plan"):
        gate(world.app, research, name)
    for name in ("run_job", "bash", "advise", "add_node"):
        with pytest.raises(ValueError, match="定题"):
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


def _wsl(world):
    rset.update(
        world.settings,
        {
            "computes": [
                {
                    "id": "wsl",
                    "name": "WSL",
                    "kind": "ssh",
                    "host": "research-wsl",
                    "gpus": "0",
                }
            ]
        },
    )


def test_an_agent_prepares_an_environment_and_the_system_checks_it(world, monkeypatch):
    from backend import research_environment as re_

    _wsl(world)
    monkeypatch.setattr(re_, "read_config", lambda *a: {"model": "m"})
    with world.maker() as d:
        user = d.scalars(select(User)).first()
        run = re_.start(world.settings, d, user.id, "wsl", "m", "", allow_sudo=False)
        d.commit()
        assert run.runtime["research"] == {
            "role": "envsetup",
            "env_id": "wsl",
            "allow_sudo": False,
        }
        assert "不要使用 sudo" in run.prompt and "PyTorch" in run.prompt
        with pytest.raises(ValueError, match="正在准备"):
            re_.start(world.settings, d, user.id, "wsl", "m")
    assert re_.state(world.settings, "wsl")["status"] == "preparing"

    probes = iter(
        [
            {"python": "3.12", "packages": {"numpy": "2"}, "cuda": False},
            {"python": "3.12", "packages": {"torch": "2.11"}, "cuda": False},
            {
                "python": "3.12",
                "packages": {"torch": "2.11"},
                "cuda": True,
                "gpus": ["RTX"],
            },
        ]
    )
    monkeypatch.setattr(rr, "probe", lambda item: next(probes))
    args = {"python": "~/ora-venv/bin/python", "recipe": "uv venv", "summary": "ok"}
    with pytest.raises(ValueError, match="PyTorch"):
        re_.finish(world.settings, "wsl", args)
    with pytest.raises(ValueError, match="CUDA"):
        re_.finish(world.settings, "wsl", args)
    out = re_.finish(world.settings, "wsl", args)
    assert out["version"] == 1
    # Experiments on it now use the Python the agent settled on.
    assert rset.compute(world.settings, "wsl")["python"] == "~/ora-venv/bin/python"
    # Editing the settings keeps what preparing produced.
    rset.update(world.settings, {"default_compute": "wsl"})
    assert re_.state(world.settings, "wsl")["status"] == "ready"


def test_a_preparation_that_ends_without_finishing_has_failed(world, monkeypatch):
    from backend import research_environment as re_

    _wsl(world)
    monkeypatch.setattr(re_, "read_config", lambda *a: {"model": "m"})
    with world.maker() as d:
        user = d.scalars(select(User)).first()
        run = re_.start(world.settings, d, user.id, "wsl", "m")
        run.status, run.response = "completed", "驱动太旧，装不了"
        d.commit()
    re_.settle(world.settings, world.maker)
    st = re_.state(world.settings, "wsl")
    assert st["status"] == "failed" and "驱动太旧" in st["error"]


def test_preparing_may_only_use_that_machine(world):
    from backend.research_tools import gate

    research = {"role": "envsetup", "env_id": "wsl"}
    for name in ("bash", "write", "web_read", "finish_setup"):
        gate(world.app, research, name)
    for name in ("run_job", "add_node", "propose_plan"):
        with pytest.raises(ValueError, match="准备环境"):
            gate(world.app, research, name)
    with pytest.raises(ValueError, match="finish_setup"):
        gate(
            world.app,
            {"role": "executor", "project_id": "x", "sprint_id": "y"},
            "finish_setup",
        )


def test_setup_commands_get_a_longer_limit(tmp_path):
    done = subprocess.run(
        [sys.executable, str(rs.ORA_DIR / "tools.py")],
        input=json.dumps(
            {
                "name": "bash",
                "args": {"command": "echo $((1+1))", "timeout": 300},
                "cap": 120,
            }
        )
        + "\n",
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert json.loads(done.stdout)["result"]["content"][0]["text"].strip() == "2"


def test_preparing_spends_no_project_budget(world):
    rw.charge(world.maker, {"role": "envsetup", "env_id": "wsl"}, 500)


def test_preparation_steps_read_as_plain_output(world, monkeypatch):
    from backend import research_environment as re_

    _wsl(world)
    monkeypatch.setattr(re_, "read_config", lambda *a: {"model": "m"})
    with world.maker() as d:
        user = d.scalars(select(User)).first()
        run = re_.start(world.settings, d, user.id, "wsl", "m")
        result = {
            "content": [{"type": "text", "text": "Ubuntu 24.04\nok"}],
            "isError": False,
        }
        run.steps = [
            {
                "name": "bash",
                "status": "completed",
                "arguments": json.dumps({"command": "uname -a"}),
                "result": {"summary": json.dumps(result)},
            }
        ]
        d.commit()
        step = re_.progress(world.settings, d, "wsl")["steps"][0]
    assert step["command"] == "uname -a"
    assert step["output"] == "Ubuntu 24.04\nok"


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
