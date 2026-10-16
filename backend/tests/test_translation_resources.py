import threading
from backend import translation_resources as resources
from backend.translation_dispatch import TaskExecutor


def test_memory_admission_uses_bytes_and_releases_on_failure(monkeypatch):
    monkeypatch.setattr(resources,'memory_status',lambda:(500,1000))
    entered=threading.Event();release=threading.Event();waiting=threading.Event();second=threading.Event()
    def first():
        with resources.rendering_memory(300,lambda:False):
            entered.set();release.wait(5)
            raise ValueError('fixture')
    def next_task():
        with resources.rendering_memory(300,lambda:False,waiting.set):second.set()
    with TaskExecutor() as pool:
        a=pool.submit(first);assert entered.wait(5)
        b=pool.submit(next_task);assert waiting.wait(5);assert not second.is_set()
        release.set()
        import pytest
        with pytest.raises(ValueError):a.result(5)
        b.result(5)
    assert second.is_set() and resources._RESERVED==0


def test_resource_wait_remains_cancellable(monkeypatch):
    monkeypatch.setattr(resources,'memory_status',lambda:(100,1000))
    cancelled=threading.Event()
    import pytest
    with pytest.raises(ValueError,match='停止'):
        with resources.rendering_memory(300,cancelled.is_set,cancelled.set):
            pytest.fail('Insufficient memory must not launch a renderer')
    assert resources._RESERVED==0
