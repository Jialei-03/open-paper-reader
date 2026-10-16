"""Dispatch one thread per pending task, without a fixed application concurrency cap.

Tasks remain finite (a document batch or claimed database job). Upstream retry,
validation and per-job memory/disk checks belong to their existing callers.
"""

import threading
from concurrent.futures import Executor, Future


class TaskExecutor(Executor):
    def __init__(self, *, thread_name_prefix="translation"):
        self._lock = threading.Lock()
        self._threads = set()
        self._futures = set()
        self._closed = False
        self._prefix = thread_name_prefix
        self._counter = 0

    def submit(self, fn, /, *args, **kwargs):
        future = Future()

        def run():
            try:
                if future.set_running_or_notify_cancel():
                    try:
                        future.set_result(fn(*args, **kwargs))
                    except BaseException as error:  # noqa: BLE001 -- match Future semantics, including task SystemExit
                        future.set_exception(error)
            finally:
                with self._lock:
                    self._threads.discard(threading.current_thread())
                    self._futures.discard(future)

        with self._lock:
            if self._closed:
                raise RuntimeError("Cannot dispatch after shutdown")
            self._counter += 1
            thread = threading.Thread(
                target=run, name=f"{self._prefix}-{self._counter}", daemon=False
            )
            self._threads.add(thread)
            self._futures.add(future)
            try:
                thread.start()
            except BaseException:
                self._threads.discard(thread)
                self._futures.discard(future)
                raise
        return future

    def shutdown(self, wait=True, *, cancel_futures=False):
        with self._lock:
            self._closed = True
            threads = list(self._threads)
            futures = list(self._futures)
        if cancel_futures:
            for future in futures:
                future.cancel()
        if wait:
            for thread in threads:
                if thread is not threading.current_thread():
                    thread.join()
