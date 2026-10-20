"""Mirrors finished experiments to SwanLab or Weights & Biases.

The research system keeps its own record (the job, its log, what it reported
through `ora`); the tracker is where a person browses and compares runs. Each
finished job becomes one tracker run: its settings, every logged point, its
final values, and tags for the project, the hypothesis and the compute.

The upload happens here, on the host, in a child process with a time limit:
the tracker's SDK and API key never enter an experiment's container.

`tracker_url` on a job: "" not yet mirrored, "none" not mirrored by choice,
an http(s) address, "local:<folder>" for an offline log, or "error: ...".
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import select

from . import research_sandbox, research_settings
from .models import ResearchJob, ResearchNode, ResearchProject

TIMEOUT = 180
FINISHED = ("succeeded", "failed", "timeout")


def _payload(settings, d, job, tracker):
    project = d.get(ResearchProject, job.project_id)
    node = d.get(ResearchNode, job.node_id)
    title = (node.title if node else "")[:60]
    return {
        "kind": tracker["kind"],
        "mode": tracker.get("mode", "local"),
        "project": tracker["project"],
        "entity": tracker.get("entity", ""),
        "name": f"{title or 'run'} · {job.id[:8]}",
        "group": f"{project.question[:40]} · {project.id[:8]}",
        "tags": [project.stage, job.compute_id, job.status],
        "config": {
            **job.config,
            "ora/command": job.command[:500],
            "ora/compute": job.compute_id,
            "ora/node": title,
            "ora/job": job.id,
        },
        "series": research_sandbox.series(settings, job),
        "summary": job.metrics,
        "logdir": str(Path(settings.storage).parent / "research" / "tracker-logs"),
    }


def sync_one(settings, d, job):
    tracker = research_settings.load(settings)["tracker"]
    if tracker["kind"] == "none":
        job.tracker_url = "none"
        return
    payload = _payload(settings, d, job, tracker)
    env = dict(os.environ)
    key = tracker.get("api_key", "")
    if key:
        env["SWANLAB_API_KEY" if tracker["kind"] == "swanlab" else "WANDB_API_KEY"] = (
            key
        )
    try:
        done = subprocess.run(
            [sys.executable, "-m", "backend.research_tracker"],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
            env=env,
            cwd=str(Path(__file__).parent.parent),
        )
    except subprocess.TimeoutExpired:
        job.tracker_url = "error: 上传超时"
        return
    lines = (done.stdout or "").strip().splitlines()
    try:
        reply = json.loads(lines[-1]) if lines else {}
    except ValueError:
        reply = {}
    if reply.get("url"):
        job.tracker_url = reply["url"][:500]
    else:
        job.tracker_url = (
            "error: " + (reply.get("error") or (done.stderr or "")[-300:] or "未知错误")
        )[:500]


def sync_pending(settings, maker, limit=2):
    """A few finished jobs per round, so planning is never held up for long."""
    with maker() as d:
        ids = list(
            d.scalars(
                select(ResearchJob.id)
                .where(
                    ResearchJob.status.in_(FINISHED),
                    ResearchJob.tracker_url == "",
                )
                .order_by(ResearchJob.finished_at)
                .limit(limit)
            )
        )
    for id in ids:
        with maker() as d:
            job = d.get(ResearchJob, id)
            try:
                sync_one(settings, d, job)
            except (OSError, ValueError) as e:
                job.tracker_url = ("error: " + str(e))[:500]
            d.commit()


def _swanlab(p):
    import swanlab

    os.makedirs(p["logdir"], exist_ok=True)
    run = swanlab.init(
        project=p["project"],
        workspace=p["entity"] or None,
        experiment_name=p["name"],
        group=p["group"],
        tags=p["tags"],
        config=p["config"],
        mode="cloud" if p["mode"] == "cloud" else "local",
        logdir=p["logdir"],
    )
    for row in p["series"]:
        values = {
            k: v
            for k, v in row.items()
            if k not in {"step", "t"} and isinstance(v, (int, float))
        }
        if values:
            swanlab.log(values, step=row.get("step"))
    finals = {
        "final/" + k: v for k, v in p["summary"].items() if isinstance(v, (int, float))
    }
    if finals:
        swanlab.log(finals)
    url = getattr(run, "public", None)
    url = getattr(url, "cloud", None) and getattr(url.cloud, "experiment_url", None)
    swanlab.finish()
    return url or "local:" + p["logdir"]


def _wandb(p):
    import wandb

    run = wandb.init(
        project=p["project"],
        entity=p["entity"] or None,
        name=p["name"],
        group=p["group"],
        tags=p["tags"],
        config=p["config"],
        mode="online" if p["mode"] == "cloud" else "offline",
        dir=p["logdir"],
    )
    for row in p["series"]:
        values = {
            k: v
            for k, v in row.items()
            if k not in {"step", "t"} and isinstance(v, (int, float))
        }
        if values:
            run.log(values, step=row.get("step"))
    for k, v in p["summary"].items():
        run.summary[k] = v
    url = run.url if p["mode"] == "cloud" else "local:" + run.dir
    run.finish()
    return url


def main():
    payload = json.loads(sys.stdin.read())
    try:
        url = (_swanlab if payload["kind"] == "swanlab" else _wandb)(payload)
        print(json.dumps({"url": url}))
    except ImportError:
        name = payload["kind"]
        print(json.dumps({"error": f"后端没有安装 {name}：pip install {name}"}))
    except Exception as e:  # noqa: BLE001 — any tracker failure is reported, not raised
        print(json.dumps({"error": str(e)[:300]}))


if __name__ == "__main__":
    main()
