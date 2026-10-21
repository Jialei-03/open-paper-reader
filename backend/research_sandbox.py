"""Where research experiments run: a project's own workspace, in local Docker,
straight on this machine (research_host), or on a machine reached over SSH
(research_remote).

Every command runs in a container with no network, a read-only root and no
capabilities; the project's work directory is mounted at /work, its datasets
read-only at /data, and the `ora` reporting module at /opt/ora. A background
job's output is collected by the system into a log outside that directory, and
what the job reports through `ora` goes to a folder only that job can write,
so what the agent cites as evidence is what really ran, not a file it wrote
itself.
"""

import json
import os
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from . import research_datasets, research_settings
from .models import ResearchJob, ResearchNode, ResearchProject, now

IMAGE = "open-research-sandbox:1"
ORA_DIR = Path(__file__).parent / "research_ora"
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


def limits(item=None):
    """LIMITS with the CPU, memory and GPUs of a Docker compute entry."""
    item = item or research_settings.LOCAL
    out = list(LIMITS)
    out[out.index("--cpus") + 1] = f"{item.get('cpus', 2):g}"
    out[out.index("--memory") + 1] = f"{int(item.get('memory_gb', 4))}g"
    gpus = item.get("gpus") or ""
    if gpus:
        out += ["--gpus", "all" if gpus == "all" else f'"device={gpus}"']
    return out


STATUS_SECONDS = 30
NO_DOCKER = "未安装或未启动 Docker，实验暂时不能运行"
NO_IMAGE = "需要先构建研究沙箱镜像：make research-image"
NOT_SHARED = (
    "实验环境看不到项目工作区：Docker 没有共享这个目录"
    "（colima 等默认只共享主目录）。请把数据目录放在主目录下，或在 Docker 设置里共享它"
)
QUOTA_NOTE = "[系统] 工作区超过配额，作业被终止"
STOPPED_NOTE = "[系统] 研究已停止，作业被终止"
PAUSED_NOTE = "[系统] 研究已暂停，作业被终止"
CANCELLED_NOTE = "[系统] 执行者停止了这个作业"
QUEUED_NOTE = "[系统] 作业在排队时被取消，没有运行"
# Still to end: waiting its turn on this machine, or running.
ACTIVE = ("queued", "running")
SERIAL = (
    "本机的实验依次运行（同时最多 {n} 个）：再启动的作业会排队，"
    "前一个结束后由系统自动开始，耗时从真正开始运行算起。排队不是卡住，不要重复启动。"
)

# The CLI, through one name so tests can stand in for it.
run = subprocess.run
_status_cache = {}
_visible = set()
# Docker says a container does not exist (as opposed to: Docker cannot be asked now).
GONE = object()


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


def strict(command):
    """A command whose pipeline fails when any part of it fails (`x | tail` too)."""
    return "set -o pipefail; " + command


def rundir(settings, project_id, job_id):
    """What one job reports through `ora`: written by that job alone."""
    if not job_id or "/" in job_id or ".." in job_id:
        raise ValueError("作业编号不合法")
    path = _root(settings, project_id) / "runs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _user():
    # The host user, so what an experiment writes in /work stays the user's own.
    if hasattr(os, "getuid"):
        return ["--user", f"{os.getuid()}:{os.getgid()}"]
    return []


def _mount(settings, project_id):
    # --mount, not -v: a path with a colon in it cannot turn into extra options.
    return [
        "--mount",
        f"type=bind,source={workdir(settings, project_id)},target=/work",
    ]


def _extras(settings, d, project_id):
    """The reporting module and the project's datasets, read-only; where to find them."""
    mounts = [
        "--mount",
        f"type=bind,source={ORA_DIR},target=/opt/ora,readonly",
        "-e",
        "PYTHONPATH=/opt/ora",
        "-e",
        "ORA_DATA=/data",
    ]
    if d is None:
        return mounts
    project = d.get(ResearchProject, project_id)
    for row in research_datasets.ready(d, project) if project else []:
        source = research_datasets.cache(settings) / row.name
        mounts += [
            "--mount",
            f"type=bind,source={source},target=/data/{row.name},readonly",
        ]
    return mounts


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


def _check_visible(settings, project_id):
    """The container must see the project's files, not an empty folder in its own VM."""
    if project_id in _visible:
        return
    work = workdir(settings, project_id)
    token = uuid.uuid4().hex
    marker = work / ".ora-visible"
    marker.write_text(token)
    try:
        seen = run(
            [
                "docker",
                "run",
                "--rm",
                *LIMITS,
                *_user(),
                *_mount(settings, project_id),
                IMAGE,
                "cat",
                "/work/.ora-visible",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("实验环境启动超时，请稍后重试") from None
    finally:
        marker.unlink(missing_ok=True)
    if (seen.stdout or "").strip() != token:
        raise ValueError(NOT_SHARED)
    _visible.add(project_id)


def pi_call(settings, project_id, name, args, d=None):
    """One file or shell tool call (read, bash, edit, write, grep, find, ls) in /work,
    or in the remote workspace of a project that runs over SSH."""
    project = d.get(ResearchProject, project_id) if d is not None else None
    if project is not None:
        item = research_settings.compute(settings, project.compute_id)
        if item["kind"] == "ssh":
            from . import research_remote

            return research_remote.tool_call(settings, d, item, project, name, args)
        if item["kind"] == "host":
            from . import research_host

            return research_host.tool_call(settings, d, item, project, name, args)
    _ready()
    _check_visible(settings, project_id)
    container = "ora-pi-" + uuid.uuid4().hex[:12]
    command = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        container,
        "--label",
        f"ora.project={project_id}",
        *LIMITS,
        *_user(),
        *_mount(settings, project_id),
        *_extras(settings, d, project_id),
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
        # The CLI was stopped; the container was not, unless it is removed.
        run(
            ["docker", "rm", "-f", container],
            capture_output=True,
            text=True,
            timeout=30,
        )
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
    # Links are not followed: a link the container made may point anywhere.
    return sum(
        f.lstat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink()
    )


def start_job(settings, d, project, node, sprint, command, timeout_seconds):
    """Starts a background experiment bound to the node being worked on,
    on the project's compute."""
    item = research_settings.compute(settings, project.compute_id)
    if item["kind"] == "docker":
        _ready()
        _check_visible(settings, project.id)
    command = (command or "").strip()
    if not command:
        raise ValueError("命令不能为空")
    if not 1 <= timeout_seconds <= JOB_MAX_SECONDS:
        raise ValueError(f"作业超时时间须在 1 到 {JOB_MAX_SECONDS} 秒之间")
    if _size(workdir(settings, project.id)) > WORKSPACE_BYTES:
        raise ValueError("工作区已超过配额，先清理不需要的文件再启动作业")
    job = ResearchJob(
        project_id=project.id,
        node_id=node.id,
        sprint_id=sprint.id,
        command=command,
        timeout_seconds=timeout_seconds,
        compute_id=item["id"],
    )
    d.add(job)
    d.flush()
    job.container = "ora-job-" + job.id.replace("-", "")[:12]
    if item["id"] not in (project.environment or {}):
        probe(settings, d, project, item)
    # Its time counts from here, not from before the probe.
    job.started_at = now()
    if item["kind"] == "host" and _busy(d, item, job):
        # This machine's GPU is shared: the job waits its turn (sweep starts it).
        job.status = "queued"
        return job
    if item["kind"] in {"ssh", "host"}:
        _away(item["kind"]).start(settings, d, item, project, job)
        return job
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
            *limits(item),
            *_user(),
            *_mount(settings, project.id),
            *_extras(settings, d, project.id),
            "--mount",
            f"type=bind,source={rundir(settings, project.id, job.id)},target=/ora-run",
            "-e",
            "ORA_RUN_DIR=/ora-run",
            "-e",
            f"ORA_JOB_ID={job.id}",
            "-w",
            "/work",
            IMAGE,
            "bash",
            "-lc",
            strict(command),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if started.returncode != 0:
        raise ValueError("作业没有启动：" + (started.stderr or "")[-300:])
    return job


def _busy(d, item, job=None):
    """Whether this machine already runs as many jobs as it may at once."""
    other = job.id if job is not None else ""
    running = d.scalars(
        select(ResearchJob.id).where(
            ResearchJob.compute_id == item["id"],
            ResearchJob.status == "running",
            ResearchJob.id != other,
        )
    ).all()
    ahead = []
    if job is not None:
        # Jobs already waiting go first.
        ahead = d.scalars(
            select(ResearchJob.id).where(
                ResearchJob.compute_id == item["id"],
                ResearchJob.status == "queued",
                ResearchJob.id != job.id,
            )
        ).all()
    return len(running) + len(ahead) >= research_settings.concurrency(item)


def queue_position(d, job):
    """1 for the next job to start on its machine, and so on."""
    ahead = d.scalars(
        select(ResearchJob.id).where(
            ResearchJob.compute_id == job.compute_id,
            ResearchJob.status == "queued",
            ResearchJob.started_at <= job.started_at,
            ResearchJob.id != job.id,
        )
    ).all()
    return len(ahead) + 1


def _start_queued(settings, d, job):
    """A queued job's turn: it starts now, and its time counts from now."""
    project = d.get(ResearchProject, job.project_id)
    item = research_settings.compute(settings, job.compute_id)
    job.status = "running"
    job.started_at = now()
    _away(item["kind"]).start(settings, d, item, project, job)


def start_waiting(settings, maker):
    """Starts queued jobs, oldest first, as their machine has room for them."""
    with maker() as d:
        ids = list(
            d.scalars(
                select(ResearchJob.id)
                .where(ResearchJob.status == "queued")
                .order_by(ResearchJob.started_at, ResearchJob.id)
            )
        )
    for job_id in ids:
        with maker() as d:
            job = d.get(ResearchJob, job_id)
            if job is None or job.status != "queued":
                continue
            try:
                item = research_settings.compute(settings, job.compute_id)
                if _busy(d, item):
                    continue
                _start_queued(settings, d, job)
                d.commit()
            except (ValueError, OSError) as e:
                d.rollback()
                job = d.get(ResearchJob, job_id)
                _end_queued(settings, job, "failed", f"[系统] 作业没有启动：{e}")
                d.commit()


def _end_queued(settings, job, status, note):
    """A job that never ran: its log says why."""
    (logdir(settings, job.project_id) / f"{job.id}.log").write_text(note + "\n")
    job.log_lines = 1
    job.status = status
    job.finished_at = now()


def probe(settings, d, project, item):
    """Records what the compute offers (Python, packages, GPUs), once per project."""
    if item["kind"] == "ssh":
        from . import research_remote

        info = research_remote.probe(item)
    elif item["kind"] == "host":
        from . import research_host

        info = research_host.probe(settings, item)
    else:
        done = run(
            [
                "docker",
                "run",
                "--rm",
                *limits(item),
                *_user(),
                *_extras(settings, None, project.id),
                IMAGE,
                "python3",
                "/opt/ora/probe.py",
            ],
            capture_output=True,
            text=True,
            timeout=90,
        )
        lines = (done.stdout or "").strip().splitlines()
        try:
            info = json.loads(lines[-1]) if lines else {}
        except ValueError:
            info = {}
        info = {"image": IMAGE, **info}
    info = {
        **info,
        "compute": {k: v for k, v in item.items() if k not in {"id"}},
        "probed_at": now(),
    }
    project.environment = {**(project.environment or {}), item["id"]: info}
    return info


def collect(settings, job):
    """Reads what the job reported through `ora`: settings, last values, points."""
    folder = rundir(settings, job.project_id, job.id)
    config_file = folder / "config.json"
    summary_file = folder / "summary.json"
    series_file = folder / "metrics.jsonl"
    try:
        job.config = json.loads(config_file.read_text()) if config_file.exists() else {}
    except ValueError:
        job.config = {}
    last, points = {}, 0
    if series_file.exists():
        for line in series_file.read_text().splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            points += 1
            last.update({k: v for k, v in row.items() if k not in {"t"}})
    try:
        summary = json.loads(summary_file.read_text()) if summary_file.exists() else {}
    except ValueError:
        summary = {}
    job.metrics = {**last, **summary}
    job.points = points


def _record_run(d, job):
    """The run's numbers on its node, by the system: what the agents judge from."""
    from . import research_map

    project = d.get(ResearchProject, job.project_id)
    node = d.get(ResearchNode, job.node_id)
    if project is None:
        return
    research_map.event(
        d,
        project,
        node,
        "system",
        "run_result",
        {
            "job_id": job.id,
            "status": job.status,
            "exit_code": job.exit_code,
            "tag": str((job.config or {}).get("tag") or "")[:100],
            "metrics": {
                k: v
                for k, v in (job.metrics or {}).items()
                if isinstance(v, (int, float)) and k != "step"
            },
        },
        job.sprint_id,
    )


def series(settings, job):
    """Every point the job logged, in order."""
    path = rundir(settings, job.project_id, job.id) / "metrics.jsonl"
    rows = []
    if path.exists():
        for line in path.read_text().splitlines()[:20000]:
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    return rows


def _away(where):
    """The module that runs a job outside this machine's Docker: a compute
    kind, or a job (what it recorded when it started)."""
    if not isinstance(where, str):
        where = where.remote.get("kind", "ssh")
    if where == "host":
        from . import research_host

        return research_host
    from . import research_remote

    return research_remote


def _elapsed(job):
    started = datetime.fromisoformat(job.started_at)
    return max(0, int((datetime.now(timezone.utc) - started).total_seconds()))


def _inspect(container):
    """The container's state, or GONE when Docker says there is no such container.

    Any other failure (the daemon restarting, the CLI missing) raises, so the
    job is looked at again later instead of being written off as lost.
    """
    done = run(
        ["docker", "inspect", "--format", "{{json .State}}", container],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if done.returncode != 0:
        if "no such" in (done.stderr or "").lower():
            return GONE
        raise ValueError("Docker 暂时不可用：" + (done.stderr or "")[-200:])
    return json.loads(done.stdout)


def _logs(container, job=None):
    # Both streams, in the order they were written.
    if job is not None and job.remote:
        return _away(job).logs(job)
    done = run(
        ["docker", "logs", container],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=60,
    )
    return done.stdout or ""


def _kill(job):
    if job.remote:
        _away(job).kill(job)
        return
    run(["docker", "kill", job.container], capture_output=True, text=True, timeout=30)


def _finish(settings, d, job, status, exit_code, note=""):
    text = _logs(job.container, job)
    if note:
        if text and not text.endswith("\n"):
            text += "\n"
        text += note + "\n"
    (logdir(settings, job.project_id) / f"{job.id}.log").write_text(text)
    job.log_lines = len(text.splitlines())
    job.status = status
    job.exit_code = exit_code
    job.finished_at = now()
    if job.remote:
        _away(job).fetch_back(settings, job)
    else:
        run(
            ["docker", "rm", "-f", job.container],
            capture_output=True,
            text=True,
            timeout=30,
        )
    collect(settings, job)
    _pulled.pop(job.id, None)
    _read.pop(job.id, None)
    _record_run(d, job)


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


def _sweep_one(settings, d, job):
    if job.remote:
        state = _away(job).state(job)
    else:
        state = _inspect(job.container)
    if state is GONE:
        job.status = "lost"
        job.finished_at = now()
        _charge(d, job)
    elif not state.get("Running"):
        code = state.get("ExitCode", 1)
        _charge(d, job)
        _finish(settings, d, job, "succeeded" if code == 0 else "failed", code)
    elif _elapsed(job) > job.timeout_seconds:
        _kill(job)
        _charge(d, job)
        _finish(settings, d, job, "timeout", None)
    elif _size(workdir(settings, job.project_id)) > WORKSPACE_BYTES:
        # A job may not fill the disk: it is stopped, and its log says why.
        _kill(job)
        _charge(d, job)
        _finish(settings, d, job, "failed", None, note=QUOTA_NOTE)
    else:
        _progress(settings, job)


PULL_EVERY = 30
_pulled = {}  # job id -> when its reports last came back from another machine
_read = {}  # job id -> the size of its metrics file when last read

# Through one name, so tests can move the clock.
_clock = time.monotonic


def _progress(settings, job):
    """A running job's numbers so far, so its curve and latest values show
    before it ends. Seeing them is a convenience: failing to only waits."""
    if job.remote and job.remote.get("kind", "ssh") != "host":
        if _clock() - _pulled.get(job.id, -PULL_EVERY) < PULL_EVERY:
            return
        _pulled[job.id] = _clock()
        try:
            _away(job).fetch_reports(settings, job, timeout=60)
        except (ValueError, OSError, subprocess.TimeoutExpired):
            return
    path = rundir(settings, job.project_id, job.id) / "metrics.jsonl"
    size = path.stat().st_size if path.exists() else 0
    if _read.get(job.id) == size:
        return
    _read[job.id] = size
    collect(settings, job)


def sweep(settings, maker):
    """Collects finished jobs, stops overdue ones, and notes the ones that vanished.

    Each job is looked at on its own: one that cannot be checked now (Docker
    busy or restarting) stays running and is looked at again next time.
    """
    with maker() as d:
        ids = list(
            d.scalars(select(ResearchJob.id).where(ResearchJob.status == "running"))
        )
    for job_id in ids:
        with maker() as d:
            job = d.get(ResearchJob, job_id)
            try:
                _sweep_one(settings, d, job)
                d.commit()
            except (ValueError, OSError, subprocess.TimeoutExpired):
                d.rollback()
    start_waiting(settings, maker)


def stop_jobs(settings, d, project_id, note=STOPPED_NOTE):
    """Stops a project's running experiments and drops its queued ones
    (the project was stopped or paused)."""
    for job in list(
        d.scalars(
            select(ResearchJob).where(
                ResearchJob.project_id == project_id, ResearchJob.status == "queued"
            )
        )
    ):
        _end_queued(settings, job, "cancelled", QUEUED_NOTE)
    for job in list(
        d.scalars(
            select(ResearchJob).where(
                ResearchJob.project_id == project_id, ResearchJob.status == "running"
            )
        )
    ):
        try:
            _kill(job)
            _charge(d, job)
            _finish(settings, d, job, "failed", None, note=note)
        except (ValueError, OSError, subprocess.TimeoutExpired):
            job.status = "lost"
            job.finished_at = now()


def stop_job(settings, d, job):
    """Stops one running job of the project, and only that one; a queued
    one is taken out of the queue."""
    if job.status == "queued":
        _end_queued(settings, job, "cancelled", QUEUED_NOTE)
        return
    if job.status != "running":
        raise ValueError(f"作业已经结束（{job.status}）")
    _kill(job)
    _charge(d, job)
    _finish(settings, d, job, "cancelled", None, note=CANCELLED_NOTE)


def job_status(job, d=None):
    out = {}
    if job.status == "queued" and d is not None:
        position = queue_position(d, job)
        out = {
            "queue_position": position,
            "hint": f"本机实验依次运行：这个作业在排队（第 {position} 位），"
            "前面的作业结束后系统会自动开始它。",
        }
    return {
        "status": job.status,
        "exit_code": job.exit_code,
        "elapsed_seconds": _elapsed(job) if job.status == "running" else None,
        "log_lines": job.log_lines,
        "command": job.command,
        # While it runs: the latest values it logged through `ora`, and how many.
        "metrics": job.metrics or {},
        "points": job.points or 0,
    } | out


LOG_BYTES = 8 * 1024 * 1024


def read_log(settings, job, offset, limit):
    """Lines of a job's output, numbered from 1; a running job's, up to now."""
    if job.status == "queued":
        return {"lines": [], "total": 0}
    if job.status == "running":
        text = _logs(job.container, job)[-LOG_BYTES:]
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
