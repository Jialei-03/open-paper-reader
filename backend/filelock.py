"""A small cross-platform exclusive file lock (fcntl on POSIX, msvcrt on Windows).

The lock belongs to the open file handle and is released when it is closed or
the process dies. `lock_nowait` raises BlockingIOError when someone else holds it.
"""

import os

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt


def lock_nowait(handle):
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError as error:
        raise BlockingIOError(*error.args) from error


def unlock(handle):
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_UN)
        return
    handle.seek(0)
    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
