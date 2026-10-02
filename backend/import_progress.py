"""Short-lived, owner-scoped import progress shared by HTTP worker processes."""

import hashlib
import json
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

_reporter = ContextVar("arxiv_import_progress", default=None)


def report(stage=None, **values):
    callback = _reporter.get()
    if callback:
        callback(stage, values)


def location(settings, owner, token):
    if not re.fullmatch(r"[a-f0-9-]{36}", token):
        raise HTTPException(422, "导入进度标识无效")
    scope = hashlib.sha256(str(owner).encode()).hexdigest()
    return Path(settings.storage).parent / "import-progress" / scope / (token + ".json")


def read(settings, owner, token):
    path = location(settings, owner, token)
    try:
        value = json.loads(path.read_text())
        if time.time() - value["updated_at"] <= 3600:
            return value
    except (OSError, ValueError, KeyError):
        pass
    return {"stage": "waiting", "received": 0, "total": None}


@contextmanager
def tracking(settings, owner, token):
    if not token:
        yield
        return
    path = location(settings, owner, token)
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError:
        yield
        return
    for old in path.parent.glob("*.json"):
        try:
            if time.time() - old.stat().st_mtime > 3600:
                old.unlink(missing_ok=True)
        except OSError:
            pass
    value = {"stage": "metadata", "received": 0, "total": None}
    last_write = 0.0

    def update(stage, values):
        nonlocal last_write
        changed = stage is not None and stage != value["stage"]
        if changed:
            value.update(stage=stage, received=0, total=None)
        value.update(values)
        moment = time.monotonic()
        if not changed and moment - last_write < 0.25:
            return
        value["updated_at"] = time.time()
        temp = path.with_suffix("." + uuid4().hex + ".tmp")
        try:
            temp.write_text(json.dumps(value))
            temp.chmod(0o600)
            temp.replace(path)
            last_write = moment
        except OSError:
            pass  # Advisory progress must never fail an otherwise valid import.
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass

    context = _reporter.set(update)
    try:
        update("metadata", {})
        yield
        update("done", {})
    except Exception:
        update("failed", {})
        raise
    finally:
        _reporter.reset(context)
