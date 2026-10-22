"""Projects on a machine reached over SSH (a lab server, a WSL box with a GPU).

For such a project the workspace lives there: the agent's file and shell
tools run there (research_ora/tools.py, standard library only) and so do its
experiments. What the researcher uploads and the datasets are copied over
(never deleting anything there); after each job the workspace and what the
job reported through `ora` are copied back, so this machine keeps the record. The job runs detached, either as a plain process or in
Docker on that machine (with `--gpus`); its exit code is written next to its
log so the system can tell a finished job from a lost one.

SSH runs non-interactively (BatchMode): keys and host names come from the
user's own ~/.ssh/config; nothing here holds a password.
"""

import json
import shlex
import subprocess

from . import research_datasets, research_sandbox, research_settings
from .research_sandbox import GONE, IMAGE, ORA_DIR

SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
LOG_BYTES = 8 * 1024 * 1024


def _run(args, timeout=120):
    # research_sandbox.run, looked up each time, so tests replace one CLI for both.
    return research_sandbox.run(args, capture_output=True, text=True, timeout=timeout)


def ssh(host, script, timeout=120):
    from .research_locations import ssh_args

    name = host["host"] if isinstance(host, dict) else host
    done = _run([*ssh_args(host), name, script], timeout)
    if done.returncode == 255:
        raise ValueError(f"连不上 {name}：" + (done.stderr or "")[-300:])
    return done


def _rsync(
    source, target, delete=False, timeout=600, max_size=None, item=None, excludes=()
):
    # A worktree's .git (research_repo) is this machine's alone.
    from .research_locations import ssh_args

    transport = ssh_args(item) if item else SSH
    args = ["rsync", "-az", "--exclude=.git", "-e", shlex.join(transport)]
    args.extend(f"--exclude={pattern}" for pattern in excludes)
    if delete:
        args.append("--delete")
    if max_size:
        args.append(f"--max-size={max_size}")
    done = _run([*args, source, target], timeout)
    if done.returncode != 0:
        raise ValueError("同步文件失败：" + (done.stderr or "")[-300:])


def _base(item, project_id):
    # remote_dir is checked to hold no spaces or shell syntax (research_settings).
    return f"{item['remote_dir']}/{project_id}"


def _q(path):
    if research_settings.REMOTE_DIR.fullmatch(path) and not path.startswith("-"):
        return path
    return (
        '"$HOME"/' + shlex.quote(path[2:])
        if path.startswith("~/")
        else shlex.quote(path)
    )


def _spec(item, path):
    return item["host"] + ":" + _q(path)


def _work(item, project_id):
    return item.get("workspace_path") or _base(item, project_id) + "/work"


def snapshot_pull(settings, item, path, dest, timeout=60):
    """Read bounded code into a private snapshot folder, never write remote source."""
    from .research_repo import MAX_BYTES, SNAPSHOT_DIRS, SNAPSHOT_FILES

    _rsync(
        _spec(item, path.rstrip("/") + "/"),
        str(dest) + "/",
        item=item,
        timeout=timeout,
        max_size=MAX_BYTES,
        excludes=[*(name + "/" for name in SNAPSHOT_DIRS), *SNAPSHOT_FILES],
    )


def _gpu_env(item):
    """GPUs to use, and the configured Python's folder first on PATH, so a plain
    `python3` in a command is the environment that has the packages."""
    gpus = item.get("gpus") or ""
    out = f"CUDA_VISIBLE_DEVICES={gpus} " if gpus and gpus != "all" else ""
    python = item.get("python") or "python3"
    if "/" in python:
        out += f"PATH={python.rsplit('/', 1)[0]}:$PATH "
    return out


def _push_ora(item):
    host, root = item["host"], item["remote_dir"]
    ssh(item, f"mkdir -p {_q(root + '/ora')} {_q(root + '/datasets')}")
    _rsync(f"{ORA_DIR}/", _spec(item, root + "/ora/"), item=item)


_prepared = {}


def prepare(settings, d, item, project):
    """The remote workspace, the `ora` module, the datasets and the uploads, in place.

    Done again only when something to copy changed (a new dataset, a new upload).
    """
    host, root = item["host"], item["remote_dir"]
    base = _base(item, project.id)
    data = research_sandbox.workdir(settings, project.id) / "data"
    datasets = [row.name for row in research_datasets.ready(d, project)]
    stamp = (
        host,
        item.get("port", 22),
        item.get("identity_file", ""),
        _work(item, project.id),
        tuple(datasets),
        (
            tuple(sorted((f.name, f.stat().st_mtime) for f in data.iterdir()))
            if data.exists()
            else ()
        ),
    )
    if _prepared.get((item["id"], project.id)) == stamp:
        return base
    ssh(
        item, f"mkdir -p {_q(base + '/work')} {_q(base + '/runs')} {_q(base + '/logs')}"
    )
    seeded = ssh(item, f"test -e {_q(base + '/.seeded')} && echo yes || echo no")
    if not item.get("workspace_path") and (seeded.stdout or "").strip() != "yes":
        # The first time here (a new project, or one moved from another compute):
        # what was written so far comes along. Nothing there is deleted.
        _rsync(
            f"{research_sandbox.workdir(settings, project.id)}/",
            _spec(item, base + "/work/"),
            item=item,
        )
        ssh(item, f"touch {_q(base + '/.seeded')}")
    _push_ora(item)
    for name in datasets:
        _rsync(
            f"{research_datasets.cache(settings) / name}/",
            _spec(item, root + f"/datasets/{name}/"),
            item=item,
        )
    if data.exists():
        _rsync(f"{data}/", _spec(item, _work(item, project.id) + "/data/"), item=item)
    _prepared[(item["id"], project.id)] = stamp
    return base


def tool_call(settings, d, item, project, name, args):
    """One file or shell tool call in the remote workspace."""
    base = prepare(settings, d, item, project)
    root = item["remote_dir"]
    script = (
        f"cd {_q(_work(item, project.id))} && env PYTHONPATH={_q(root + '/ora')} ORA_DATA={_q(root + '/datasets')} "
        f"{_gpu_env(item)}{item.get('python') or 'python3'} {_q(root + '/ora/tools.py')}"
    )
    try:
        from .research_locations import ssh_args

        done = _run_input(
            [*ssh_args(item), item["host"], script], {"name": name, "args": args}
        )
    except subprocess.TimeoutExpired:
        raise ValueError(
            "远程命令超时（单条命令最长 60 秒，长任务请用 run_job）"
        ) from None
    if done.returncode == 255:
        raise ValueError(f"连不上 {item['host']}：" + (done.stderr or "")[-300:])
    lines = (done.stdout or "").strip().splitlines()
    if not lines:
        raise ValueError("远程环境没有返回结果：" + (done.stderr or "")[-300:])
    reply = json.loads(lines[-1])
    if reply.get("error"):
        raise ValueError(reply["error"])
    return reply["result"]


def _run_input(args, request, timeout=75):
    return research_sandbox.run(
        args,
        input=json.dumps(request) + "\n",
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def start(settings, d, item, project, job):
    host, root = item["host"], item["remote_dir"]
    base = prepare(settings, d, item, project)
    run_dir = f"{base}/runs/{job.id}"
    ssh(item, f"mkdir -p {_q(run_dir)}")
    log = f"{base}/logs/{job.id}.log"
    wrapped = (
        f"(\n{research_sandbox.strict(job.command)}\n)\n"
        f"echo $? > {_q(run_dir + '/.exit')}\n"
    )
    transport = {"host": host, "base": base}
    if item.get("port", 22) != 22:
        transport["port"] = item["port"]
    if item.get("identity_file"):
        transport["identity_file"] = item["identity_file"]
    if item.get("workspace_path"):
        transport["workdir"] = item["workspace_path"]
    if item.get("runner") == "docker":
        gpus = item.get("gpus") or ""
        gpu_flag = (
            ""
            if not gpus
            else (
                "--gpus all "
                if gpus == "all"
                else f"--gpus {shlex.quote('device=' + gpus)} "
            )
        )
        script = (
            f"docker run -d --name {job.container} {gpu_flag}"
            f"-v {_q(_work(item, project.id))}:/work -v {_q(run_dir)}:/ora-run "
            f"-v {_q(root + '/ora')}:/opt/ora:ro -v {_q(root + '/datasets')}:/data:ro "
            "-e ORA_RUN_DIR=/ora-run -e PYTHONPATH=/opt/ora -e ORA_DATA=/data "
            f"-e ORA_JOB_ID={job.id} -w /work {item.get('image') or IMAGE} "
            f"bash -lc {shlex.quote(research_sandbox.strict(job.command))}"
        )
        done = ssh(item, script)
        if done.returncode != 0:
            raise ValueError("远程作业没有启动：" + (done.stderr or "")[-300:])
        job.remote = {**transport, "container": job.container}
        return
    script = (
        f"cd {_q(_work(item, project.id))} && nohup setsid env ORA_RUN_DIR={_q(run_dir)} PYTHONPATH={_q(root + '/ora')} "
        f"ORA_DATA={_q(root + '/datasets')} ORA_JOB_ID={job.id} {_gpu_env(item)}"
        f"bash -c {shlex.quote(wrapped)} > {_q(log)} 2>&1 < /dev/null & echo $!"
    )
    done = ssh(item, script)
    pid = (done.stdout or "").strip().splitlines()
    if done.returncode != 0 or not pid or not pid[-1].isdigit():
        raise ValueError("远程作业没有启动：" + (done.stderr or "")[-300:])
    job.remote = {**transport, "pid": int(pid[-1])}


def state(job):
    """Like Docker's State: {"Running", "ExitCode"}, or GONE when it vanished."""
    r = job.remote
    if r.get("container"):
        done = ssh(r, f"docker inspect --format '{{{{json .State}}}}' {r['container']}")
        if done.returncode != 0:
            return GONE if "no such" in (done.stderr or "").lower() else _raise(done)
        return json.loads(done.stdout)
    exit_file = f"{r['base']}/runs/{job.id}/.exit"
    done = ssh(
        r,
        f"if kill -0 {r['pid']} 2>/dev/null; then echo running; "
        f"elif [ -f {_q(exit_file)} ]; then cat {_q(exit_file)}; else echo gone; fi",
    )
    if done.returncode != 0:
        _raise(done)
    word = (done.stdout or "").strip()
    if word == "running":
        return {"Running": True}
    if word.isdigit():
        return {"Running": False, "ExitCode": int(word)}
    return GONE


def _raise(done):
    raise ValueError("远程机器暂时不可用：" + (done.stderr or "")[-200:])


def logs(job):
    r = job.remote
    if r.get("container"):
        done = ssh(r, f"docker logs {r['container']} 2>&1 | tail -c {LOG_BYTES}")
    else:
        done = ssh(
            r, f"tail -c {LOG_BYTES} {_q(r['base'] + '/logs/' + job.id + '.log')}"
        )
    return done.stdout or ""


def kill(job):
    r = job.remote
    if r.get("container"):
        ssh(r, f"docker kill {r['container']}")
    else:
        # The whole process group: the shell and what it started.
        ssh(r, f"kill -- -{r['pid']} 2>/dev/null || kill {r['pid']}")


def pull(settings, item, project_id, small=False, timeout=600):
    """The remote workspace back to this machine (the project moves elsewhere, or
    a round ended: `small` leaves the large files there)."""
    from .research_repo import MAX_BYTES, snapshot_remote_worktree

    if item.get("workspace_path"):
        return snapshot_pull(
            settings,
            item,
            item["workspace_path"],
            research_sandbox.workdir(settings, project_id),
            timeout=timeout,
        )

    if snapshot_remote_worktree(
        settings, item, project_id, _work(item, project_id), timeout=timeout
    ):
        return
    _rsync(
        _spec(item, _work(item, project_id) + "/"),
        f"{research_sandbox.workdir(settings, project_id)}/",
        timeout=timeout,
        max_size=MAX_BYTES if small else None,
        item=item,
    )


def fetch_reports(settings, job, timeout=600):
    """What the job has reported through `ora` so far, back to this machine."""
    r = job.remote
    _rsync(
        _spec(r, r["base"] + "/runs/" + job.id + "/"),
        f"{research_sandbox.rundir(settings, job.project_id, job.id)}/",
        timeout=timeout,
        item=r,
    )


def fetch_back(settings, job):
    """The workspace and the job's reports, back to this machine."""
    r = job.remote
    fetch_reports(settings, job)
    if r.get("workdir"):
        snapshot_pull(
            settings,
            r,
            r["workdir"],
            research_sandbox.workdir(settings, job.project_id),
        )
    else:
        from .research_repo import snapshot_remote_worktree

        if not snapshot_remote_worktree(
            settings, r, job.project_id, r["base"] + "/work"
        ):
            _rsync(
                _spec(r, r["base"] + "/work/"),
                f"{research_sandbox.workdir(settings, job.project_id)}/",
                item=r,
            )
    if r.get("container"):
        ssh(r, f"docker rm -f {r['container']}")


def probe(item):
    """What the remote machine offers, from the same probe script."""
    _push_ora(item)
    root = item["remote_dir"]
    if item.get("runner") == "docker":
        gpus = "--gpus all " if item.get("gpus") else ""
        script = (
            f"docker run --rm {gpus}-v {root}/ora:/opt/ora:ro "
            f"{item.get('image') or IMAGE} python3 /opt/ora/probe.py"
        )
    else:
        script = (
            f"{_gpu_env(item)}{item.get('python') or 'python3'} {root}/ora/probe.py"
        )
    if not (ssh(item, "command -v rsync").stdout or "").strip():
        raise ValueError(f"{item['host']} 上没有 rsync：sudo apt install rsync")
    done = ssh(item, script, timeout=90)
    lines = (done.stdout or "").strip().splitlines()
    try:
        info = json.loads(lines[-1]) if lines else {}
    except ValueError:
        info = {}
    if done.returncode != 0 and not info:
        raise ValueError("远程环境检测失败：" + (done.stderr or "")[-300:])
    return {"host": item["host"], "runner": item.get("runner", "shell"), **info}
