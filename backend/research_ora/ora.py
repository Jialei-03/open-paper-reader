"""Reporting an experiment's settings and numbers to the research system.

    import ora
    ora.config({"lr": 1e-3, "epochs": 5})
    for epoch in range(5):
        ...
        ora.log({"train_loss": loss, "test_acc": acc}, step=epoch)
    ora.summary({"test_acc": best})

Every call also prints one line (ORA_CONFIG / ORA_METRIC / ORA_SUMMARY), so the
same numbers are in the job's log and can be cited as evidence. The files go
to a folder only this job can write; the system reads them when the job ends
and mirrors them to the experiment tracker. Only the standard library is used.
"""

import json
import math
import os
import sys
import time

_DIR = os.environ.get("ORA_RUN_DIR", "")


def _clean(values):
    out = {}
    for key, value in dict(values).items():
        key = str(key)[:100]
        if hasattr(value, "item"):
            value = value.item()  # numpy and torch scalars
        if isinstance(value, bool) or value is None:
            out[key] = value
        elif isinstance(value, (int, float)):
            out[key] = value if math.isfinite(value) else str(value)
        else:
            out[key] = str(value)[:500]
    return out


def _write(name, text, mode="w"):
    if not _DIR:
        return
    os.makedirs(_DIR, exist_ok=True)
    with open(os.path.join(_DIR, name), mode) as f:
        f.write(text)


def _fmt(values):
    return " ".join(
        f"{k}={v:.6g}" if isinstance(v, float) else f"{k}={v}"
        for k, v in values.items()
    )


def config(values):
    """The experiment's settings (hyperparameters, seed, data version)."""
    values = _clean(values)
    _write("config.json", json.dumps(values, ensure_ascii=False))
    print("ORA_CONFIG " + _fmt(values), flush=True)


def log(values, step=None):
    """Numbers at one step (an epoch, an iteration)."""
    values = _clean(values)
    row = {"step": step, "t": round(time.time(), 3), **values}
    _write("metrics.jsonl", json.dumps(row, ensure_ascii=False) + "\n", "a")
    print(
        "ORA_METRIC " + ("" if step is None else f"step={step} ") + _fmt(values),
        flush=True,
    )


def summary(values):
    """The final numbers of this run; what a result should cite."""
    values = _clean(values)
    _write("summary.json", json.dumps(values, ensure_ascii=False))
    print("ORA_SUMMARY " + _fmt(values), flush=True)


if __name__ == "__main__":
    print("ora: import it from Python; see the docstring", file=sys.stderr)
