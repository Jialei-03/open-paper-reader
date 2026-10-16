"""Conservative retention of completed translation work; recovery caches are kept."""

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import stat
import time
import uuid
from datetime import datetime
from pathlib import Path

from .config import Settings, database
from .models import File, TranslationJob


def tree_info(path):
    size, newest, unsafe = 0, path.stat().st_mtime, False
    for root, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            try:
                info = (Path(root) / name).lstat()
            except FileNotFoundError:
                continue
            newest = max(newest, info.st_mtime)
            if stat.S_ISREG(info.st_mode):
                size += info.st_size
            elif not stat.S_ISDIR(info.st_mode):
                unsafe = True
    return size, newest, unsafe


def published(d, settings, job, verify=False):
    for identifier in (job.translated_file, job.translated_archive):
        row = d.get(File, identifier) if identifier else None
        if (
            not row
            or row.owner != job.owner
            or row.paper_id != job.paper_id
            or row.version_id != job.version_id
        ):
            return False
        path = Path(settings.storage) / row.id
        if path.is_symlink() or not path.is_file() or path.stat().st_size != row.size:
            return False
        if verify:
            with path.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != row.sha256:
                    return False
    return True


def inventory(settings, maker, clock=None):
    clock = time.time() if clock is None else clock
    root = Path(settings.storage).parent / "translation-work"
    if root.is_symlink():
        raise ValueError("Translation cache root cannot be a symlink")
    if not root.exists():
        return []
    rows = []
    with maker() as d:
        for path in root.iterdir():
            if path.is_symlink() or not path.is_dir():
                continue
            try:
                if str(uuid.UUID(path.name)) != path.name:
                    continue
            except ValueError:
                continue
            try:
                size, newest, unsafe = tree_info(path)
            except FileNotFoundError:
                continue
            job = d.get(TranslationJob, path.name)
            if job:
                try:
                    newest = max(
                        newest, datetime.fromisoformat(job.updated_at).timestamp()
                    )
                except ValueError:
                    unsafe = True
            status = job.status if job else "orphan"
            days = (
                settings.translation_cache_days
                if job
                else settings.translation_orphan_days
            )
            eligible = not unsafe and days > 0 and clock - newest >= days * 86400
            if job:
                eligible = (
                    eligible and status == "completed" and published(d, settings, job)
                )
            rows.append(
                {
                    "id": path.name,
                    "status": status,
                    "bytes": size,
                    "eligible": bool(eligible),
                    "unsafe": unsafe,
                }
            )
    return rows


def sweep(settings, maker, *, worker_locked=False):
    """The worker owns the global lock; offline callers must acquire it first."""
    if not worker_locked:
        lock_path = Path(settings.storage).parent / "translation-worker.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError(
                    "Translation worker is active; use its periodic cleanup or stop it first"
                ) from None
            return sweep(settings, maker, worker_locked=True)
    removed, freed = 0, 0
    root = Path(settings.storage).parent / "translation-work"
    for row in inventory(settings, maker):
        if not row["eligible"]:
            continue
        with maker() as d:
            job = d.get(TranslationJob, row["id"])
            if job and (
                job.status != "completed"
                or not published(d, settings, job, verify=True)
            ):
                continue
            # Paths came from canonical UUID directories, never user-provided paths.
            path = root / row["id"]
            if path.is_symlink():
                continue
            shutil.rmtree(path)
            removed += 1
            freed += row["bytes"]
    return {"removed": removed, "freed_bytes": freed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Requires an idle/stopped translation worker",
    )
    args = parser.parse_args()
    settings = Settings.env()
    engine, maker = database(settings)
    try:
        rows = inventory(settings, maker)
        result = {
            "directories": len(rows),
            "bytes": sum(r["bytes"] for r in rows),
            "eligible_bytes": sum(r["bytes"] for r in rows if r["eligible"]),
            "protected_bytes": sum(r["bytes"] for r in rows if not r["eligible"]),
        }
        result["by_status"] = {}
        for row in rows:
            bucket = result["by_status"].setdefault(
                row["status"], {"directories": 0, "bytes": 0}
            )
            bucket["directories"] += 1
            bucket["bytes"] += row["bytes"]
        if args.clean:
            result["cleanup"] = sweep(settings, maker)
        print(json.dumps(result))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
