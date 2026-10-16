import fcntl
import os
import time
import uuid
from pathlib import Path

import pytest

from backend.models import TranslationJob
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.translation_cache import inventory, sweep


def fixture(env, status="completed", age=40):
    app, a, _, settings = env
    p = paper(a)
    first = attach(a, p, "zh.tex", b"translated")
    archive = attach(a, p, "archive.tex", b"source")
    with app.state.maker() as d:
        job = TranslationJob(
            owner=a.get("/api/v1/auth/me").json()["user"]["id"],
            paper_id=p["id"],
            version_id=p["current_version"],
            arxiv_id="2501.00001v1",
            status=status,
            translated_file=first["id"],
            translated_archive=archive["id"],
            updated_at="2000-01-01T00:00:00+00:00",
        )
        d.add(job)
        d.commit()
        path = Path(settings.storage).parent / "translation-work" / job.id
    path.mkdir(parents=True)
    (path / "units.json").write_text('{"translated":"keep"}')
    old = time.time() - age * 86400
    os.utime(path / "units.json", (old, old))
    os.utime(path, (old, old))
    return path, first


@pytest.mark.parametrize("status", ["failed", "cancelled", "queued", "running"])
def test_recovery_and_active_caches_never_expire(env, status):
    app, _, _, settings = env
    path, _ = fixture(env, status)
    assert not inventory(settings, app.state.maker)[0]["eligible"]
    assert sweep(settings, app.state.maker)["removed"] == 0
    assert (path / "units.json").is_file()


def test_completed_cache_requires_age_and_intact_outputs(env):
    app, _, _, settings = env
    old, first = fixture(env)
    young, _ = fixture(env, age=1)
    assert len(inventory(settings, app.state.maker)) == 2
    # Same size corruption must be found by the checksum, not only size.
    published = Path(settings.storage) / first["id"]
    published.write_bytes(b"corrupted!")
    assert sweep(settings, app.state.maker)["removed"] == 0
    published.write_bytes(b"translated")
    assert sweep(settings, app.state.maker)["removed"] == 1
    assert not old.exists() and young.exists() and published.exists()


def test_worker_lock_symlinks_and_orphan_retention(env, tmp_path):
    app, _, _, settings = env
    path, _ = fixture(env)
    lock_path = Path(settings.storage).parent / "translation-worker.lock"
    with lock_path.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match="worker is active"):
            sweep(settings, app.state.maker)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "important").write_text("keep")
    (path / "linked").symlink_to(outside, target_is_directory=True)
    root = path.parent
    orphan = root / str(uuid.uuid4())
    orphan.mkdir()
    old = time.time() - 40 * 86400
    os.utime(orphan, (old, old))
    (root / str(uuid.uuid4())).symlink_to(outside, target_is_directory=True)
    assert sweep(settings, app.state.maker)["removed"] == 1
    assert path.exists() and not orphan.exists()
    assert (outside / "important").read_text() == "keep"
    settings.translation_cache_days = 0
    (path / "linked").unlink()
    os.utime(path, (old, old))
    assert sweep(settings, app.state.maker)["removed"] == 0


def test_low_disk_stops_before_download_and_keeps_checkpoint(env, monkeypatch):
    from types import SimpleNamespace

    from backend import translation_worker as worker

    app, _, _, settings = env
    path, _ = fixture(env, status="running")
    monkeypatch.setattr(worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=0))

    def forbidden(*args):
        pytest.fail("Low disk must be rejected before downloading")

    monkeypatch.setattr(worker, "download", forbidden)
    worker.process(settings, app.state.maker, path.name)
    with app.state.maker() as d:
        job = d.get(TranslationJob, path.name)
        assert job.status == "failed" and "临时空间不足" in job.error
    assert (path / "units.json").exists()
