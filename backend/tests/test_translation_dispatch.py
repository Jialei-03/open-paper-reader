import threading
from types import SimpleNamespace

import pytest

from backend.translation_dispatch import TaskExecutor
from backend.tests.test_acceptance import env as env
from backend.tests.test_translation_cache import fixture
from backend.models import TranslationJob


def test_tasks_can_all_run_before_any_completes():
    # Exceeds former 3, 8 and 16 ceilings. A barrier proves simultaneous work,
    # rather than merely counting jobs accepted into a serial queue.
    barrier = threading.Barrier(21)
    with TaskExecutor() as executor:
        futures = [executor.submit(barrier.wait, 5) for _ in range(20)]
        barrier.wait(5)
        for future in futures:
            future.result(timeout=5)
    with pytest.raises(RuntimeError, match="shutdown"):
        executor.submit(lambda: None)


def test_shutdown_waits_for_inflight_work_and_preserves_errors():
    entered = threading.Event()
    finish = threading.Event()
    stopped = threading.Event()
    executor = TaskExecutor()

    def task():
        entered.set()
        finish.wait(5)
        raise ValueError("fixture failure")

    future = executor.submit(task)
    assert entered.wait(5)
    thread = threading.Thread(target=lambda: (executor.shutdown(), stopped.set()))
    thread.start()
    assert not stopped.wait(0.05)
    finish.set()
    assert stopped.wait(5)
    thread.join()
    with pytest.raises(ValueError, match="fixture failure"):
        future.result()


def test_database_dispatch_claims_all_jobs_once_and_excludes_active_retry(env, monkeypatch):
    from backend import translation_worker as worker

    app, _, _, settings = env
    paths = [fixture(env, status="queued")[0] for _ in range(6)]
    barrier = threading.Barrier(7)
    release = threading.Event()
    seen = []

    def process(settings, maker, job_id):
        seen.append(job_id)
        barrier.wait(5)
        release.wait(5)

    monkeypatch.setattr(worker, "process", process)
    active = {}
    with TaskExecutor() as executor:
        worker.dispatch_queued(settings, app.state.maker, executor, active)
        barrier.wait(5)
        assert set(seen) == {p.name for p in paths}
        with app.state.maker() as d:
            assert all(d.get(TranslationJob, p.name).status == "running" for p in paths)
            # User may retry near completion; do not start a second thread until
            # the first finishes scratch-directory cleanup.
            d.get(TranslationJob, paths[0].name).status = "queued"
            d.commit()
        worker.dispatch_queued(settings, app.state.maker, executor, active)
        assert len(seen) == 6
        release.set()


def test_layout_concurrency_follows_each_document_workload():
    from backend.layout_translation_worker import install_document_dispatch

    class Translator:
        def __init__(self):
            self.translation_config = SimpleNamespace(pool_max_workers=3)

        def translate(self, document):
            return self.translation_config.pool_max_workers

    high_level = SimpleNamespace(ILTranslator=Translator, ILTranslatorLLMOnly=Translator)
    install_document_dispatch(high_level)
    for name in ("ILTranslator", "ILTranslatorLLMOnly"):
        translator = getattr(high_level, name)()
        assert translator.translate(SimpleNamespace(page=[SimpleNamespace(pdf_paragraph=[0] * 27)])) == 27
        assert translator.translate(SimpleNamespace(page=[])) == 1


def test_quick_translation_allows_concurrent_requests_without_busy_rejection(monkeypatch):
    from backend import quick_translation

    barrier = threading.Barrier(7)

    def translate(text, language):
        barrier.wait(5)
        return "译文 " + text

    monkeypatch.setattr(quick_translation, "google_translate", translate)
    translator = quick_translation.QuickTranslator()
    with TaskExecutor() as executor:
        futures = [executor.submit(translator.translate, "fixture-owner", str(i)) for i in range(6)]
        barrier.wait(5)
        assert [f.result(timeout=5) for f in futures] == ["译文 " + str(i) for i in range(6)]
