"""Operator-owned shared model and cross-process concurrency leases for one host."""

import fcntl
import json
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class ModelSlotBusy(ValueError):
    pass


PLATFORM_ID = "platform-minimax"


def shared_config(settings):
    path = Path(
        os.getenv(
            "PLATFORM_MODEL_CONFIG",
            str(Path(settings.storage).parent / "platform-model.json"),
        )
    )
    if not path.is_file():
        return {}
    value = json.loads(path.read_text())
    if (
        not value.get("enabled", True)
        or not value.get("api_key")
        or not value.get("model")
    ):
        return {}
    concurrency = int(
        os.getenv("PLATFORM_MODEL_CONCURRENCY", value.get("concurrency_limit", 0))
    )
    if concurrency < 0:
        raise ValueError("平台模型并发上限不能为负数")
    return {
        **value,
        "id": PLATFORM_ID,
        "name": value.get("name") or value["model"],
        "shared": True,
        # Shown next to the model in the interface; set "badge" in the JSON to change it.
        "badge": value.get("badge") or "共享模型",
        "concurrency_limit": concurrency,
        "_platform_concurrency_limit": concurrency,
        "_platform_limit_dir": str(path.parent / "platform-model-slots"),
    }


def shared_configs(settings):
    primary = shared_config(settings)
    if not primary:
        return []
    rows = [primary]
    for choice in primary.get("models", []):
        identifier = choice.get("id", "")
        if (
            not identifier.startswith("platform-")
            or len(identifier) > 36
            or any(row["id"] == identifier for row in rows)
            or not choice.get("model")
        ):
            continue
        # Every shared choice uses the same credential and concurrency pool.
        rows.append(
            {
                **primary,
                "id": identifier,
                "model": choice["model"],
                "name": choice.get("name") or choice["model"],
                "vision": bool(choice.get("vision", False)),
                "context_length": choice.get("context_length"),
            }
        )
    return rows


def apply_limit(config, shared):
    # The same platform credential through an existing personal alias also counts.
    if config and shared and config.get("api_key") == shared.get("api_key"):
        return {
            **config,
            "_platform_limit_dir": shared["_platform_limit_dir"],
            "_platform_concurrency_limit": shared["_platform_concurrency_limit"],
        }
    return config


def _first_waiter(root, own):
    """Under queue.lock: discard tickets whose owning process exited."""
    for path in sorted(root.glob("waiter-*.lock")):
        if path == own:
            return True
        try:
            with path.open("r+") as candidate:
                try:
                    fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return False
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            continue
    return False


@contextmanager
def model_slot(config, timeout=540, cancelled=None):
    location = config.get("_platform_limit_dir")
    concurrency = config.get("_platform_concurrency_limit", 3)
    if not location or concurrency == 0:
        if cancelled and cancelled():
            raise ValueError("任务已停止；已完成操作保留")
        yield
        return
    root = Path(location)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    deadline = time.monotonic() + timeout
    held = None
    ticket_path = root / f"waiter-{time.monotonic_ns():020d}-{uuid.uuid4().hex}.lock"
    # Ticket creation and its liveness lock are atomic to other queue participants.
    with (root / "queue.lock").open("a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        ticket = ticket_path.open("x+")
        fcntl.flock(ticket, fcntl.LOCK_EX)
    try:
        while held is None:
            if cancelled and cancelled():
                raise ValueError("任务已停止；已完成操作保留")
            with (root / "queue.lock").open("a") as guard:
                fcntl.flock(guard, fcntl.LOCK_EX)
                if _first_waiter(root, ticket_path):
                    for n in range(concurrency):
                        f = (root / f"slot-{n}.lock").open("a")
                        try:
                            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            held = f
                            ticket_path.unlink(missing_ok=True)
                            break
                        except BlockingIOError:
                            f.close()
            if held is None:
                if time.monotonic() >= deadline:
                    raise ModelSlotBusy("共享模型当前繁忙，等待超时，请稍后重试")
                time.sleep(0.1)
        yield
    finally:
        ticket_path.unlink(missing_ok=True)
        ticket.close()
        if held is not None:
            held.close()
