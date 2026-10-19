"""Where research experiments run: a project's own workspace, in local Docker.

Every command runs in a container with no network, a read-only root and no
capabilities; only the project's work directory is mounted, at /work. A
background job's output is collected by the system into a log outside that
directory, so what the agent cites as evidence is what really ran, not a file
it wrote itself.
"""

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from .models import ResearchJob, ResearchNode, ResearchProject, now

IMAGE = "open-research-sandbox:1"
JOB_MAX_SECONDS = int(os.getenv("RESEARCH_JOB_MAX_SECONDS", "7200"))
WORKSPACE_BYTES = int(os.getenv("RESEARCH_WORKSPACE_BYTES", str(2 * 1024**3)))
LIMITS = [
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--cpus",
    "2",
    "--memory",
    "4g",
    "--pids-limit",
    "256",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=536870912",
]
STATUS_SECONDS = 30
NO_DOCKER = "未安装或未启动 Docker，实验暂时不能运行"
NO_IMAGE = "需要先构建研究沙箱镜像：make research-image"

# The CLI, through one name so tests can stand in for it.
run = subprocess.run
_status_cache = {}


def _root(settings, project_id):
    if not project_id or "/" in project_id or ".." in project_id:
        raise ValueError("研究项目编号不合法")
    return Path(settings.storage).parent / "research" / project_id


def workdir(settings, project_id):
    path = _root(settings, project_id) / "work"
    path.mkdir(parents=True, exist_ok=True)
    return path


def logdir(settings, project_id):
    path = _root(settings, project_id) / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _user():
    # The host user, so what an experiment writes in /work stays the user's own.
    if hasattr(os, "getuid"):
        return ["--user", f"{os.getuid()}:{os.getgid()}"]
    return []


def docker_status():
    """Whether experiments can run here, and if not, what to do about it."""
    cached = _status_cache.get("value")
    if cached and time.monotonic() - _status_cache["at"] < STATUS_SECONDS:
        return cached
    try:
        info = run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if info.returncode != 0:
            value = {"available": False, "reason": NO_DOCKER}
        else:
            image = run(
                ["docker", "image", "inspect", IMAGE],
                capture_output=True,
                text=True,
                timeout=10,
            )
            value = (
                {"available": True, "reason": ""}
                if image.returncode == 0
                else {"available": False, "reason": NO_IMAGE}
            )
    except (OSError, subprocess.TimeoutExpired):
        value = {"available": False, "reason": NO_DOCKER}
    _status_cache.update(value=value, at=time.monotonic())
    return value


def _ready():
    status = docker_status()
    if not status["available"]:
        raise ValueError(status["reason"])


def pi_call(settings, project_id, name, args):
    """One file or shell tool call (read, bash, edit, write, grep, find, ls) in /work."""
    _ready()
    command = [
        "docker",
        "run",
        "--rm",
        "-i",
        *LIMITS,
        *_user(),
        "-v",
        f"{workdir(settings, project_id)}:/work",
        IMAGE,
        "node",
        "/app/sandbox-tools.mjs",
    ]
    try:
        done = run(
            command,
            input=json.dumps({"name": name, "args": args}) + "\n",
            capture_output=True,
            text=True,
            timeout=75,
        )
    except subprocess.TimeoutExpired:
        raise ValueError(
            "实验环境命令超时（单条命令最长 60 秒，长任务请用 run_job）"
        ) from None
    line = (done.stdout or "").strip().splitlines()
    if not line:
        raise ValueError("实验环境没有返回结果：" + (done.stderr or "")[-300:])
    reply = json.loads(line[-1])
    if reply.get("error"):
        raise ValueError(reply["error"])
    return reply["result"]


def _size(path):
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def start_job(settings, d, project, node, sprint, command, timeout_seconds):
    """Starts a background experiment bound to the node being worked on."""
    _ready()
    command = (command or "").strip()
    if not command:
        raise ValueError("命令不能为空")
    if not 1 <= timeout_seconds <= JOB_MAX_SECONDS:
        raise ValueError(f"作业超时时间须在 1 到 {JOB_MAX_SECONDS} 秒之间")
    work = workdir(settings, project.id)
    if _size(work) > WORKSPACE_BYTES:
        raise ValueError("工作区已超过配额，先清理不需要的文件再启动作业")
    job = ResearchJob(
        project_id=project.id,
        node_id=node.id,
        sprint_id=sprint.id,
        command=command,
        timeout_seconds=timeout_seconds,
    )
    d.add(job)
    d.flush()
    job.container = "ora-job-" + job.id.replace("-", "")[:12]
    started = run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            job.container,
            "--label",
            f"ora.job={job.id}",
            "--label",
            f"ora.project={project.id}",
            *LIMITS,
            *_user(),
            "-v",
            f"{work}:/work",
            "-w",
            "/work",
            IMAGE,
            "bash",
            "-lc",
            command,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if started.returncode != 0:
        raise ValueError("作业没有启动：" + (started.stderr or "")[-300:])
    return job


def _elapsed(job):
    started = datetime.fromisoformat(job.started_at)
    return max(0, int((datetime.now(timezone.utc) - started).total_seconds()))


def _inspect(container):
    done = run(
        ["docker", "inspect", "--format", "{{json .State}}", container],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if done.returncode != 0:
        return None
    return json.loads(done.stdout)


def _logs(container):
    # Both streams, in the order they were written.
    done = run(
        ["docker", "logs", container],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=60,
    )
    return done.stdout or ""


def _finish(settings, d, job, status, exit_code):
    text = _logs(job.container)
    (logdir(settings, job.project_id) / f"{job.id}.log").write_text(text)
    job.log_lines = len(text.splitlines())
    job.status = status
    job.exit_code = exit_code
    job.finished_at = now()
    run(
        ["docker", "rm", "-f", job.container],
        capture_output=True,
        text=True,
        timeout=30,
    )


def _charge(d, job):
    seconds = _elapsed(job)
    node = d.get(ResearchNode, job.node_id)
    if node:
        node.spent_job_seconds += seconds
    project = d.get(ResearchProject, job.project_id)
    project.spent = {
        **project.spent,
        "job_seconds": project.spent.get("job_seconds", 0) + seconds,
    }


def sweep(settings, maker):
    """Collects finished jobs, stops overdue ones, and notes the ones that vanished."""
    with maker() as d:
        jobs = list(
            d.scalars(select(ResearchJob).where(ResearchJob.status == "running"))
        )
        for job in jobs:
            state = _inspect(job.container)
            if state is None:
                job.status = "lost"
                job.finished_at = now()
                _charge(d, job)
            elif not state.get("Running"):
                code = state.get("ExitCode", 1)
                _charge(d, job)
                _finish(settings, d, job, "succeeded" if code == 0 else "failed", code)
            elif _elapsed(job) > job.timeout_seconds:
                run(
                    ["docker", "kill", job.container],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                _charge(d, job)
                _finish(settings, d, job, "timeout", None)
            d.commit()


def job_status(job):
    return {
        "status": job.status,
        "exit_code": job.exit_code,
        "elapsed_seconds": _elapsed(job) if job.status == "running" else None,
        "log_lines": job.log_lines,
        "command": job.command,
    }


def read_log(settings, job, offset, limit):
    """Lines of a job's output, numbered from 1; a running job's, up to now."""
    if job.status == "running":
        text = _logs(job.container)
    else:
        path = logdir(settings, job.project_id) / f"{job.id}.log"
        text = path.read_text() if path.exists() else ""
    lines = text.splitlines()
    return {
        "lines": [
            {"n": n + 1, "text": lines[n]}
            for n in range(offset, min(len(lines), offset + limit))
        ],
        "total": len(lines),
    }
