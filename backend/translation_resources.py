"""Physical memory admission for CPU renderers, independent of network concurrency."""

import contextlib
import threading
from pathlib import Path

_CONDITION = threading.Condition()
_RESERVED = 0


def memory_status():
    path = Path("/proc/meminfo")
    if not path.exists():
        return None
    values = {}
    for line in path.read_text().splitlines():
        key, value = line.split(":", 1)
        values[key] = int(value.strip().split()[0]) * 1024
    return values["MemAvailable"], values["MemTotal"]


@contextlib.contextmanager
def rendering_memory(required, cancelled, waiting=lambda: None):
    global _RESERVED
    admitted = False
    reported = False
    try:
        while True:
            if cancelled():
                raise ValueError("翻译已停止")
            with _CONDITION:
                memory = memory_status()
                # Reserve the renderer's declared maximum before launching it.
                # Already admitted tasks remain reserved until their CPU stage
                # exits, covering startup allocation races between job threads.
                if (
                    memory is None
                    or memory[0] - _RESERVED - memory[1] // 20 >= required
                ):
                    _RESERVED += required
                    admitted = True
                    break
                if not reported:
                    waiting()
                    reported = True
                _CONDITION.wait(timeout=1)
        yield
    finally:
        if admitted:
            with _CONDITION:
                _RESERVED -= required
                _CONDITION.notify_all()
