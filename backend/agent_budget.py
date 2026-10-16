"""One execution budget plus a cumulative, cancellable provider queue budget."""

import time

from .platform_model import ModelSlotBusy, model_slot

EXECUTION_SECONDS = 600
WAIT_SECONDS = 540
# A hard supervisor bound also covers child startup and teardown.
WALL_SECONDS = EXECUTION_SECONDS + WAIT_SECONDS + 30


class RunBudget:
    def __init__(self, execution=EXECUTION_SECONDS, waiting=WAIT_SECONDS):
        self.deadline = time.monotonic() + execution
        self.waiting = waiting
        self.slot = None

    def remaining(self):
        return max(0, self.deadline - time.monotonic())

    def acquire(self, config, cancelled):
        if self.slot is not None:
            raise ValueError("模型名额重复申请")
        if not self.remaining():
            raise ValueError("任务执行时间已用尽；已完成操作保留")
        started = time.monotonic()
        try:
            candidate = model_slot(config, timeout=self.waiting, cancelled=cancelled)
            try:
                candidate.__enter__()
                self.slot = candidate
            except ModelSlotBusy:
                raise ValueError("共享模型累计等待超时，请稍后重试") from None
        finally:
            elapsed = time.monotonic() - started
            self.waiting = max(0, self.waiting - elapsed)
            self.deadline += elapsed

    def release(self):
        if self.slot is not None:
            self.slot.__exit__(None, None, None)
            self.slot = None
