"""Projects that run straight on this machine: no container, no copy.

The workspace is the project's own folder here; the agent's file and shell
tools (research_ora/tools.py) and its experiments run in it as plain
processes. That gives experiments this machine's GPU (Apple's MPS included)
and whatever Python its environment preparation settled on, at the price of
isolation: code the agent writes runs as the user. Jobs get a small
environment of their own, not this server's (which holds API keys).

A job runs detached in its own process group; its exit code is written next
to what it reports through `ora`, so the system can tell a finished job from
a lost one even after a restart.
"""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
from pathlib import Path

from . import research_datasets, research_sandbox
from .research_sandbox import GONE, ORA_DIR

LOG_BYTES = 8 * 1024 * 1024
SETUP_CAP = 120
# Ending processes by name reaches the researcher's own programs on this machine.
BY_NAME = re.compile(r"\b(pkill|killall)\b|\bkill\b[^\n;|&]*\$\(\s*pgrep")
BY_NAME_REFUSED = (
    "这台机器上还跑着研究者自己的程序，不能按名字结束进程（pkill、killall、kill $(pgrep ...)）。"
    "要停实验，用 stop_job(job_id)。"
)


def _check(name, args):
    if name == "bash" and BY_NAME.search(str(args.get("command") or "")):
        raise ValueError(BY_NAME_REFUSED)


KEEP = ("HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SHELL", "TERM")


def setup_dir(settings):
    """Where the agent preparing this machine works (and may keep a venv)."""
    path = Path(settings.storage).parent / "research" / "host-setup"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _python(item):
    return os.path.expanduser(item.get("python") or "") or ""


def env(settings, item, extra=None):
    """What a command here sees: the configured Python first on PATH, `ora`
    importable, the datasets' folder; nothing else of this server's."""
    out = {k: os.environ[k] for k in KEEP if k in os.environ}
    path = os.environ.get("PATH", "/usr/bin:/bin")
    python = _python(item)
    if "/" in python:
        path = os.path.dirname(python) + os.pathsep + path
    out.update(
        PATH=path,
        PYTHONPATH=str(ORA_DIR),
        ORA_DATA=str(research_datasets.cache(settings)),
        PYTHONUNBUFFERED="1",
    )
    gpus = item.get("gpus") or ""
    if gpus and gpus != "all":
        out["CUDA_VISIBLE_DEVICES"] = gpus
    return {**out, **(extra or {})}


def _tools(settings, item, cwd, request, timeout):
    try:
        done = research_sandbox.run(
            [sys.executable, str(ORA_DIR / "tools.py")],
            cwd=str(cwd),
            env=env(settings, item),
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise ValueError(
            f"命令超时（单条命令最长 {request.get('cap', 60)} 秒，长任务请用 run_job）"
        ) from None
    lines = (done.stdout or "").strip().splitlines()
    if not lines:
        raise ValueError("本机工具没有返回结果：" + (done.stderr or "")[-300:])
    reply = json.loads(lines[-1])
    if reply.get("error"):
        raise ValueError(reply["error"])
    return reply["result"]


def tool_call(settings, d, item, project, name, args):
    """One file or shell tool call in the project's workspace."""
    _check(name, args)
    work = research_sandbox.workdir(settings, project.id)
    return _tools(settings, item, work, {"name": name, "args": args}, 75)


def setup_call(settings, item, name, args):
    """A tool call of the agent preparing this machine, in host-setup, with a
    longer limit per command (longer installs go to the background)."""
    _check(name, args)
    request = {"name": name, "args": args, "cap": SETUP_CAP}
    try:
        return _tools(settings, item, setup_dir(settings), request, SETUP_CAP + 20)
    except ValueError as e:
        if "超时" in str(e):
            raise ValueError(
                f"命令超过 {SETUP_CAP} 秒：长的安装请放到后台（nohup ... > log 2>&1 &），再查看日志"
            ) from None
        raise


def start(settings, d, item, project, job):
    run_dir = research_sandbox.rundir(settings, project.id, job.id)
    log = research_sandbox.logdir(settings, project.id) / f"{job.id}.log"
    exit_file = run_dir / ".exit"
    wrapped = (
        f"({research_sandbox.strict(job.command)}); "
        f"echo $? > {shlex.quote(str(exit_file))}"
    )
    with open(log, "w") as out:
        process = subprocess.Popen(
            ["bash", "-c", wrapped],
            cwd=str(research_sandbox.workdir(settings, project.id)),
            env=env(
                settings,
                item,
                {"ORA_RUN_DIR": str(run_dir), "ORA_JOB_ID": job.id},
            ),
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    job.remote = {
        "kind": "host",
        "pid": process.pid,
        "exit": str(exit_file),
        "log": str(log),
    }


def _reap(pid):
    # A child of this server stays a zombie (and "alive") until it is waited for.
    try:
        os.waitpid(pid, os.WNOHANG)
    except (ChildProcessError, OSError):
        pass


def _alive(pid):
    _reap(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def state(job):
    """Like Docker's State: {"Running", "ExitCode"}, or GONE when it vanished."""
    r = job.remote
    exit_file = Path(r["exit"])
    if exit_file.exists():
        word = exit_file.read_text().strip()
        if word.isdigit():
            return {"Running": False, "ExitCode": int(word)}
    if _alive(r["pid"]):
        return {"Running": True}
    return GONE


def logs(job):
    path = Path(job.remote["log"])
    if not path.exists():
        return ""
    with open(path, "rb") as f:
        f.seek(max(0, path.stat().st_size - LOG_BYTES))
        return f.read().decode(errors="replace")


def kill(job):
    # The whole process group: the shell and what it started.
    pid = job.remote["pid"]
    try:
        os.killpg(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    _reap(pid)


def fetch_reports(settings, job, timeout=600):
    """Nothing to copy: the job reports into this machine's folder."""


def fetch_back(settings, job):
    """Nothing to copy: the job wrote into this machine's workspace."""


def probe(settings, item):
    """What this machine offers, from the configured Python (or python3)."""
    python = _python(item) or "python3"
    try:
        done = research_sandbox.run(
            [python, str(ORA_DIR / "probe.py")],
            env=env(settings, item),
            capture_output=True,
            text=True,
            timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ValueError(f"本机环境检测失败：{e}") from None
    lines = (done.stdout or "").strip().splitlines()
    try:
        info = json.loads(lines[-1]) if lines else {}
    except ValueError:
        info = {}
    if done.returncode != 0 and not info:
        raise ValueError("本机环境检测失败：" + (done.stderr or "")[-300:])
    return {"host": "本机", "runner": "host", "interpreter": python, **info}
