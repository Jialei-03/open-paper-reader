"""What this machine offers an experiment: printed as one JSON line."""

import json
import os
import platform
import shutil
import subprocess
import sys


def _run(args):
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return done.stdout.strip() if done.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


info = {
    "python": sys.version.split()[0],
    "platform": platform.platform(),
    "machine": platform.machine(),
    "cpus": os.cpu_count(),
    "packages": {},
    "gpus": [],
}
try:
    pages = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    info["memory_gb"] = round(pages / 1024**3, 1)
except (ValueError, OSError, AttributeError):
    pass
for name in ("torch", "torchvision", "numpy", "sklearn", "pandas", "jax"):
    try:
        module = __import__(name)
        info["packages"][name] = getattr(module, "__version__", "?")
    except Exception:  # noqa: BLE001 — a missing or broken package is just absent
        pass
try:
    import torch

    info["cuda"] = bool(torch.cuda.is_available())
    if info["cuda"]:
        info["gpus"] = [
            torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())
        ]
    mps = getattr(torch.backends, "mps", None)
    info["mps"] = bool(mps and mps.is_available())
except Exception:  # noqa: BLE001
    pass
if not info["gpus"] and shutil.which("nvidia-smi"):
    names = _run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"]
    )
    info["gpus"] = [line.strip() for line in names.splitlines() if line.strip()]
print(json.dumps(info, ensure_ascii=False))
