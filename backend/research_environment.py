"""Research environments: this machine, or one reached over SSH.

Nothing is prepared ahead of time. An environment is checked: can it be
reached, and what does it offer (Python, packages, GPUs, from the probe
script)? Experiments install what they are missing themselves, in a virtual
environment in their workspace (see the executor's skill).

The state lives next to the environment in the research settings:
{status: connected|disconnected, probe, checked_at, error}; an environment
prepared by an earlier version may also carry `python`, which stays in use.
"""

import re
import subprocess
from pathlib import Path

from . import research_settings
from .models import now


def state(settings, env_id):
    return research_settings.load(settings).get("states", {}).get(env_id, {})


def set_state(settings, env_id, **values):
    data = research_settings.load(settings)
    states = data.setdefault("states", {})
    states[env_id] = {**states.get(env_id, {}), **values}
    research_settings.save(settings, data)
    return states[env_id]


def probe(settings, item):
    """What the environment offers; raises ValueError when it cannot be reached."""
    from . import research_host, research_remote

    if item["kind"] == "host":
        return research_host.probe(settings, item)
    if item["kind"] == "ssh":
        from .research_locations import ssh_args

        reach = subprocess.run(
            [*ssh_args(item), item["host"], "true"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if reach.returncode != 0:
            raise ValueError((reach.stderr or "").strip()[-400:] or "连不上")
        return research_remote.probe(item)
    raise ValueError("不支持的环境")


def check(settings, env_id):
    """Reaches the environment, probes it and keeps what it found."""
    item = research_settings.compute(settings, env_id)
    try:
        found = probe(settings, item)
    except (ValueError, OSError, subprocess.TimeoutExpired) as e:
        return set_state(
            settings,
            env_id,
            status="disconnected",
            error=str(e)[:1000] or "检测失败",
            checked_at=now(),
        )
    return set_state(
        settings,
        env_id,
        status="connected",
        probe=found,
        error="",
        checked_at=now(),
    )


def ssh_hosts(path=None):
    """The concrete Host entries of ~/.ssh/config (and the files it includes)."""
    path = Path(path or Path.home() / ".ssh" / "config")
    hosts, seen = [], set()

    def read(file, depth=0):
        try:
            lines = file.read_text(errors="replace").splitlines()
        except OSError:
            return
        current = []
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"[\s=]+", line, maxsplit=1)
            key, value = parts[0].lower(), (parts[1] if len(parts) > 1 else "").strip()
            if key == "include" and depth < 3:
                for pattern in value.split():
                    base = Path(pattern).expanduser()
                    if not base.is_absolute():
                        base = path.parent / base
                    for f in sorted(base.parent.glob(base.name)):
                        read(f, depth + 1)
                current = []
            elif key == "host":
                current = []
                for name in value.split():
                    if any(c in name for c in "*?!") or name in seen:
                        continue
                    seen.add(name)
                    entry = {"name": name, "hostname": "", "user": ""}
                    hosts.append(entry)
                    current.append(entry)
            elif key == "match":
                current = []
            elif key in ("hostname", "user"):
                for entry in current:
                    entry[key] = entry[key] or value

    read(path)
    return hosts
