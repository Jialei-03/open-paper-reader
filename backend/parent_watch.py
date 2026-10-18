"""Let a worker started by the local CLI exit when that CLI dies.

The CLI passes its pid in OPR_PARENT_PID; a daemon thread polls it. Works on
macOS, Linux and Windows. Without the variable (cloud) nothing happens.
"""

import os
import signal
import threading
import time

ENV = "OPR_PARENT_PID"


def pid_alive(pid):
    if os.name == "nt":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(interval=1.0, on_gone=None):
    """Start the watchdog if OPR_PARENT_PID is set. Returns the thread or None."""
    try:
        parent = int(os.environ.get(ENV, ""))
    except ValueError:
        return None

    def leave():
        if on_gone:
            on_gone()
        elif os.name == "nt":
            os._exit(0)
        else:
            os.kill(os.getpid(), signal.SIGTERM)  # workers turn this into a clean stop
            time.sleep(10)
            os._exit(0)

    def loop():
        while True:
            time.sleep(interval)
            if not pid_alive(parent) or (os.name != "nt" and os.getppid() != parent):
                leave()
                return

    thread = threading.Thread(target=loop, name="parent-watch", daemon=True)
    thread.start()
    return thread
