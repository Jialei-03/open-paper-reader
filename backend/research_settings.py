"""Where research experiments run and where their numbers are kept.

One file for the installation, next to the playbook: the computes an
experiment can run on (this machine's Docker, or a machine reached over SSH)
and the experiment tracker runs are mirrored to (SwanLab or Weights & Biases).
The tracker's API key stays in this file; it is never sent back to the browser
and never enters an experiment's container.
"""

import json
import os
import re
from pathlib import Path

LOCAL = {
    "id": "local",
    "name": "本机 Docker",
    "kind": "docker",
    "cpus": 2,
    "memory_gb": 4,
    "gpus": "",
}
TRACKERS = {"none", "swanlab", "wandb"}
# An SSH host is a name from ~/.ssh/config or user@host: nothing a shell could read as more.
HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,200}$")
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
GPUS = re.compile(r"^(|all|[0-9]+(,[0-9]+)*)$")
REMOTE_DIR = re.compile(r"^[A-Za-z0-9_./~-]{1,200}$")


def path(settings):
    return Path(settings.storage).parent / "research" / "settings.json"


def default():
    return {
        "computes": [dict(LOCAL)],
        "default_compute": "local",
        "tracker": {"kind": "none", "project": "open-research-agent", "mode": "local"},
        "states": {},
    }


def load(settings):
    file = path(settings)
    if not file.exists():
        return default()
    data = json.loads(file.read_text())
    base = default()
    computes = data.get("computes") or base["computes"]
    if not any(c.get("id") == "local" for c in computes):
        computes = [dict(LOCAL), *computes]
    return {
        "computes": computes,
        "default_compute": data.get("default_compute") or "local",
        "tracker": {**base["tracker"], **(data.get("tracker") or {})},
        # What preparing each environment produced (research_environment).
        "states": data.get("states") or {},
    }


def save(settings, data):
    file = path(settings)
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(file)


def compute(settings, compute_id):
    """An environment, with the Python its preparation settled on (if any)."""
    data = load(settings)
    for item in data["computes"]:
        if item["id"] == compute_id:
            python = data["states"].get(compute_id, {}).get("python")
            return {**item, "python": python} if python else item
    raise ValueError(f"找不到算力配置：{compute_id}")


def public(data):
    """The settings as the browser sees them: the key's presence, not the key."""
    tracker = {k: v for k, v in data["tracker"].items() if k != "api_key"}
    tracker["has_key"] = bool(data["tracker"].get("api_key"))
    return {**data, "tracker": tracker}


def check_compute(item):
    """A compute entry as stored; raises ValueError on anything it cannot run."""
    if not ID.match(item.get("id", "")):
        raise ValueError("算力编号只能用小写字母、数字和连字符")
    name = (item.get("name") or "").strip()[:80] or item["id"]
    kind = item.get("kind")
    gpus = str(item.get("gpus") or "")
    if not GPUS.match(gpus):
        raise ValueError("GPU 只能填 all、留空，或用逗号分隔的编号")
    if kind == "docker":
        cpus = float(item.get("cpus") or 2)
        memory = int(item.get("memory_gb") or 4)
        if not (0.5 <= cpus <= 256 and 1 <= memory <= 2048):
            raise ValueError("CPU 或内存超出范围")
        return {
            "id": item["id"],
            "name": name,
            "kind": "docker",
            "cpus": cpus,
            "memory_gb": memory,
            "gpus": gpus,
        }
    if kind == "ssh":
        host = (item.get("host") or "").strip()
        if not HOST.match(host):
            raise ValueError("SSH 主机填 ~/.ssh/config 里的名字，或 user@host")
        remote_dir = (item.get("remote_dir") or "~/ora-research").strip()
        if not REMOTE_DIR.match(remote_dir) or ".." in remote_dir:
            raise ValueError("远程目录不合法")
        runner = item.get("runner") or "shell"
        if runner not in {"shell", "docker"}:
            raise ValueError("远程运行方式只能是 shell 或 docker")
        python = (item.get("python") or "python3").strip()
        if not REMOTE_DIR.match(python):
            raise ValueError("Python 路径不合法")
        return {
            "id": item["id"],
            "name": name,
            "kind": "ssh",
            "host": host,
            "remote_dir": remote_dir,
            "runner": runner,
            "python": python,
            "gpus": gpus,
        }
    raise ValueError("算力类型只能是 docker 或 ssh")


def update(settings, body):
    """Replaces computes and tracker settings; an empty api_key keeps the stored one."""
    old = load(settings)
    computes = [check_compute(c) for c in body.get("computes", old["computes"])]
    ids = [c["id"] for c in computes]
    if len(set(ids)) != len(ids):
        raise ValueError("算力编号重复")
    if "local" not in ids:
        computes = [dict(LOCAL), *computes]
        ids.insert(0, "local")
    default_compute = body.get("default_compute", old["default_compute"])
    if default_compute not in ids:
        raise ValueError("默认算力不在列表里")
    tracker_in = body.get("tracker") or {}
    kind = tracker_in.get("kind", old["tracker"]["kind"])
    if kind not in TRACKERS:
        raise ValueError("实验追踪只能是 none、swanlab 或 wandb")
    mode = tracker_in.get("mode", old["tracker"].get("mode", "local"))
    if mode not in {"local", "cloud"}:
        raise ValueError("追踪模式只能是 local 或 cloud")
    project = (tracker_in.get("project") or old["tracker"]["project"]).strip()[:100]
    if not re.match(r"^[A-Za-z0-9_.-]{1,100}$", project):
        raise ValueError("追踪项目名只能用字母、数字、点、下划线和连字符")
    tracker = {"kind": kind, "mode": mode, "project": project}
    entity = (tracker_in.get("entity") or old["tracker"].get("entity") or "").strip()
    if entity:
        tracker["entity"] = entity[:100]
    key = tracker_in.get("api_key")
    if key:
        tracker["api_key"] = key.strip()
    elif tracker_in.get("clear_key"):
        pass
    elif old["tracker"].get("api_key"):
        tracker["api_key"] = old["tracker"]["api_key"]
    data = {
        "computes": computes,
        "default_compute": default_compute,
        "tracker": tracker,
        "states": {k: v for k, v in old["states"].items() if k in ids},
    }
    save(settings, data)
    return data
