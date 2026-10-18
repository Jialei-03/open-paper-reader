"""Offline administration. Never exposed through the HTTP API."""

import argparse
import getpass
import hashlib
import json
import os
import re
import zipfile
from pathlib import Path

from sqlalchemy import select

from .config import Settings, database
from .main import PASSWORD
from .models import AgentAttachment, Base, File, NoteImage, User, now

EXCLUDED = {"sessions", "tokens", "invitations", "idempotency", "account_challenges"}


def bootstrap(settings, username, password):
    if (
        not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{2,31}", username)
        or not 8 <= len(password) <= 256
    ):
        raise ValueError("Valid username and 8–256 character password required")
    engine, maker = database(settings)
    with maker() as d:
        if d.scalar(select(User.id).limit(1)):
            raise ValueError(
                "Bootstrap only works on an empty user table; use invitations"
            )
        user = User(
            username=username.lower(), password=PASSWORD.hash(password), admin=True
        )
        d.add(user)
        d.commit()
        result = user.id
    engine.dispose()
    return result


def backup(settings, output):
    """Caller must quiesce writers, including the web process, for file/DB consistency."""
    engine, maker = database(settings)
    output = Path(output)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with (
            os.fdopen(fd, "wb") as out,
            maker() as d,
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z,
        ):
            data = {
                t.name: [dict(row) for row in d.execute(select(t)).mappings()]
                for t in Base.metadata.sorted_tables
                if t.name not in EXCLUDED
            }
            z.writestr(
                "backup.json",
                json.dumps(
                    {
                        "format": "paper-platform-backup",
                        "schema_version": 17,
                        "created_at": now(),
                        "data": data,
                    },
                    ensure_ascii=False,
                ),
            )
            for f in [
                *d.scalars(select(File)),
                *d.scalars(select(NoteImage)),
                *d.scalars(select(AgentAttachment)),
            ]:
                fd_in = os.open(
                    Path(settings.storage) / f.id, os.O_RDONLY | os.O_NOFOLLOW
                )
                with os.fdopen(fd_in, "rb") as src:
                    raw = src.read()
                if hashlib.sha256(raw).hexdigest() != f.sha256:
                    raise ValueError("File checksum mismatch: " + f.id)
                z.writestr("files/" + f.id, raw)
        return {k: len(v) for k, v in data.items()}
    except Exception:
        output.unlink(missing_ok=True)
        raise
    finally:
        engine.dispose()


def restore(settings, source):
    """Read validated entries directly. Never extract an archive to the filesystem."""
    engine, maker = database(settings)
    storage = Path(settings.storage)
    storage.mkdir(parents=True, exist_ok=True, mode=0o700)
    if storage.is_symlink():
        raise ValueError("Storage cannot be a symlink")
    created = []
    try:
        with zipfile.ZipFile(source) as z, maker() as d:
            names = z.namelist()
            if len(names) != len(set(names)) or len(names) > 100000:
                raise ValueError("Duplicate/excess archive entries")
            if sum(i.file_size for i in z.infolist()) > 10 * 1024**3:
                raise ValueError("Backup exceeds 10 GiB restore limit")
            for info in z.infolist():
                if info.filename != "backup.json" and not re.fullmatch(
                    r"files/[0-9a-f-]{36}", info.filename
                ):
                    raise ValueError("Unsafe archive path")
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Symlinks forbidden")
                if info.file_size > max(settings.upload_limit, 20 * 1024**2):
                    raise ValueError("Oversized archive member")
            payload = json.loads(z.read("backup.json"))
            if payload.get("format") != "paper-platform-backup" or payload.get(
                "schema_version"
            ) not in {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17}:
                raise ValueError("Unsupported backup schema")
            data = payload["data"]
            if payload["schema_version"] == 1:
                used = set()
                for user in sorted(
                    data["users"],
                    key=lambda u: ("@" in u["email"], u["created_at"], u["id"]),
                ):
                    base = re.sub(
                        r"[^a-z0-9_]", "_", user["email"].split("@")[0].lower()
                    )[:24]
                    if not re.fullmatch(r"[a-z][a-z0-9_]{2,31}", base):
                        base = "user_" + user["id"].replace("-", "")[:12]
                    username, suffix = base, 2
                    while username in used:
                        username = f"{base}_{suffix}"
                        suffix += 1
                    used.add(username)
                    user["username"] = username
                    user["email_verified"] = False
                    if "@" not in user["email"]:
                        user["email"] = None
            if payload["schema_version"] < 3:
                for table in ("research_profiles", "discovery_candidates"):
                    data.setdefault(table, [])
            if payload["schema_version"] < 4:
                data.setdefault("translation_jobs", [])
            if payload["schema_version"] < 5:
                data.setdefault("agent_sessions", [])
                data.setdefault("agent_runs", [])
                data.setdefault("agent_quotas", [])
            if payload["schema_version"] < 6:
                data.setdefault("note_images", [])
            if payload["schema_version"] < 7:
                data.setdefault("agent_attachments", [])
                for run in data["agent_runs"]:
                    run.setdefault("attachment_ids", [])
            if payload["schema_version"] < 8:
                data.setdefault("model_usage", [])
            if payload["schema_version"] < 9:
                for row in data["model_usage"]:
                    row.setdefault("reserved_tokens", 0)
            for run in data["agent_runs"]:
                if run["status"] in {"queued", "running"}:
                    run["status"] = "failed"
                    run["error"] = (
                        "从备份恢复，任务未自动重放；请检查已有操作后重新发送"
                    )
            for paper in data["papers"]:
                if paper.get("reading_status") == "queued":
                    paper["reading_status"] = "unread"
            if payload["schema_version"] < 10:
                data.setdefault("ink_strokes", [])
            if payload["schema_version"] < 11:
                data.setdefault("text_annotations", [])
            if payload["schema_version"] < 12:
                data.setdefault("reading_artifacts", [])
            if payload["schema_version"] < 13:
                data.setdefault("library_collections", [])
            if payload["schema_version"] < 14:
                data.setdefault("saved_citations", [])
            if payload["schema_version"] < 15:
                data.setdefault("paper_shares", [])
            if payload["schema_version"] < 16:
                for table in (
                    "preparation_settings",
                    "paper_preparations",
                    "translation_memory",
                ):
                    data.setdefault(table, [])
                for job in data["translation_jobs"]:
                    job.setdefault("preparation_id", "")
            if payload["schema_version"] < 17:
                data.setdefault("paper_metadata", [])
            for preparation in data["paper_preparations"]:
                if preparation["status"] in {"queued", "running", "waiting"}:
                    preparation["status"] = "paused"
                    preparation["stage"] = "从备份恢复，请确认后继续"
            for job in data["translation_jobs"]:
                if job.get("preparation_id") and job["status"] in {"queued", "running"}:
                    job["status"] = "cancelled"
                    job["stage"] = "从备份恢复，自动准备已暂停"
            expected = {
                t.name for t in Base.metadata.sorted_tables if t.name not in EXCLUDED
            }
            if set(data) != expected:
                raise ValueError("Backup table set mismatch")
            for t in Base.metadata.sorted_tables:
                if d.execute(select(t).limit(1)).first():
                    raise ValueError("Restore requires an empty migrated database")
            expected_names = {"backup.json"} | {
                "files/" + r["id"]
                for r in data["files"] + data["note_images"] + data["agent_attachments"]
            }
            if set(names) != expected_names:
                raise ValueError("Unexpected or missing files")
            for f in data["files"] + data["note_images"] + data["agent_attachments"]:
                if not re.fullmatch(r"[0-9a-f-]{36}", f["id"]):
                    raise ValueError("Unsafe file id")
                raw = z.read("files/" + f["id"])
                if (
                    len(raw) != f["size"]
                    or hashlib.sha256(raw).hexdigest() != f["sha256"]
                ):
                    raise ValueError("File checksum mismatch")
                target = storage / f["id"]
                fd = os.open(
                    target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
                )
                created.append(target)
                with os.fdopen(fd, "wb") as out:
                    out.write(raw)
            for t in Base.metadata.sorted_tables:
                rows = data.get(t.name, [])
                if rows:
                    d.execute(t.insert(), rows)
            d.commit()
            return {k: len(v) for k, v in data.items()}
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    finally:
        engine.dispose()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest="command", required=True)
    b = subs.add_parser("bootstrap")
    b.add_argument("--username", required=True)
    for name in ("backup", "restore"):
        s = subs.add_parser(name)
        s.add_argument("path")
        s.add_argument(
            "--offline",
            action="store_true",
            required=True,
            help="Confirm all writers have been stopped",
        )
    args = p.parse_args()
    settings = Settings.env()
    if args.command == "bootstrap":
        pw = getpass.getpass("Admin password (8+ characters): ")
        if pw != getpass.getpass("Repeat password: "):
            raise SystemExit("Passwords differ")
        print("Created admin:", bootstrap(settings, args.username, pw))
    else:
        print(
            json.dumps(
                (backup if args.command == "backup" else restore)(settings, args.path),
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
