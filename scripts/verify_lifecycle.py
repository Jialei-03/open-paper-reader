"""Real process restart and offline CLI restore acceptance, on localhost only."""

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.cli import bootstrap
from backend.config import Settings


def main():
    with tempfile.TemporaryDirectory(prefix="paper-lifecycle-") as temp:
        directory = Path(temp)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = {
            **os.environ,
            "DATABASE_URL": "sqlite:///" + str(directory / "original.db"),
            "STORAGE_DIR": str(directory / "original-files"),
            "APP_ENV": "development",
            "APP_ORIGIN": base,
        }

        def command(*args):
            return subprocess.run(
                [sys.executable, *args],
                cwd=ROOT,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            ).stdout

        command("-m", "alembic", "upgrade", "head")
        password = secrets.token_urlsafe(32)
        bootstrap(
            Settings(database_url=env["DATABASE_URL"], storage=env["STORAGE_DIR"]),
            "lifecycle",
            password,
        )
        proc = None

        def start():
            nonlocal proc
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "backend.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--log-level",
                    "warning",
                ],
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError(proc.stderr.read().decode())
                try:
                    if httpx.get(base + "/api/v1/health", timeout=1).status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            raise RuntimeError("Server startup timeout")

        def stop():
            if proc and proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=15)

        @contextmanager
        def login():
            c = httpx.Client(base_url=base, timeout=30)
            r = c.post(
                "/api/v1/auth/login",
                json={"username": "lifecycle", "password": password},
            )
            r.raise_for_status()
            c.headers["X-CSRF-Token"] = r.json()["csrf"]
            try:
                yield c
            finally:
                c.close()

        try:
            start()
            # RealMem is an optional integration input. The default is an
            # explicitly synthetic fixture made in this disposable directory.
            fixture_dir = os.getenv("REALMEM_FIXTURE_DIR")
            source = (
                Path(fixture_dir) if fixture_dir else directory / "synthetic-fixture"
            )
            if not fixture_dir:
                from pypdf import PdfWriter

                (source / "source/latex-v1/sec").mkdir(parents=True)
                pdf = PdfWriter()
                pdf.add_blank_page(width=612, height=792)
                pdf.write(source / "source/paper-v1.pdf")
                (source / "source/latex-v1/sec/method.tex").write_text(
                    "% Synthetic lifecycle fixture; no research claims.\n"
                )
                (source / "manifest.json").write_text(
                    json.dumps(
                        {
                            "pdf": {
                                "metadata": {
                                    "title": "Synthetic lifecycle fixture",
                                    "author": "Workspace QA",
                                }
                            },
                            "paper_id": "synthetic-lifecycle",
                            "source_url": "Local generated test fixture",
                        }
                    )
                )
            manifest = json.loads((source / "manifest.json").read_text())
            with login() as c:
                r = c.post(
                    "/api/v1/papers",
                    json={
                        "title": manifest["pdf"]["metadata"]["title"],
                        "authors": manifest["pdf"]["metadata"]["author"],
                        "external_id": manifest["paper_id"],
                        "provenance": manifest["source_url"],
                    },
                    headers={"Idempotency-Key": str(uuid.uuid4())},
                )
                r.raise_for_status()
                p = r.json()
                payload = (source / "source/paper-v1.pdf").read_bytes()
                r = c.post(
                    "/api/v1/papers/" + p["id"] + "/files",
                    files={"file": ("paper-v1.pdf", payload)},
                    data={"version_id": p["current_version"]},
                    headers={"Idempotency-Key": str(uuid.uuid4())},
                )
                r.raise_for_status()
                f = r.json()
                tok = c.post(
                    "/api/v1/tokens",
                    json={
                        "name": "revoked-by-restore",
                        "scopes": ["read", "write"],
                        "days": 1,
                    },
                ).json()["token"]
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "examples/agent_client.py"),
                    base,
                    p["id"],
                    str(source / "source/latex-v1/sec/method.tex"),
                ],
                cwd=directory,
                env={**env, "PAPER_TOKEN": tok},
                check=True,
                capture_output=True,
                text=True,
            )
            agent_context = json.loads((directory / "paper-context.json").read_text())
            assert agent_context["paper"]["reading_status"] == "unread"
            assert (
                len(agent_context["items"]) == 1 and len(agent_context["events"]) == 1
            )
            assert agent_context["items"][0]["kind"] == "note"
            assert agent_context["events"][0]["locator"]["line_start"] == 1
            assert "Source first line:" in agent_context["events"][0]["body"]
            stop()
            start()
            with login() as c:
                assert (
                    c.get("/api/v1/papers/" + p["id"]).json()["reading_status"]
                    == "unread"
                )
                assert c.get("/api/v1/files/" + f["id"] + "/content").content == payload
            stop()
            counts = json.loads(
                command(
                    "-m",
                    "backend.cli",
                    "backup",
                    str(directory / "backup.zip"),
                    "--offline",
                )
            )
            env["DATABASE_URL"] = "sqlite:///" + str(directory / "restored.db")
            env["STORAGE_DIR"] = str(directory / "restored-files")
            command("-m", "alembic", "upgrade", "head")
            restored = json.loads(
                command(
                    "-m",
                    "backend.cli",
                    "restore",
                    str(directory / "backup.zip"),
                    "--offline",
                )
            )
            assert counts == restored
            start()
            with login() as c:
                assert c.get("/api/v1/files/" + f["id"] + "/content").content == payload
                assert (
                    c.get("/api/v1/papers/" + p["id"]).json()["reading_status"]
                    == "unread"
                )
                assert (
                    c.get(
                        "/api/v1/papers", headers={"Authorization": "Bearer " + tok}
                    ).status_code
                    == 401
                )
            result = {
                "fixture": "external-originals" if fixture_dir else "synthetic",
                "process_starts": 3,
                "migration_runs": 2,
                "restart_preserved_paper_and_pdf": True,
                "offline_cli_backup_restore": True,
                "restore_revoked_previous_tokens": True,
                "documented_python_agent_example": True,
                "pdf_bytes": len(payload),
                "pdf_sha256": hashlib.sha256(payload).hexdigest(),
                "pdf_pages": f["pages"],
                "restored_counts": restored,
                "reading_status": "unread",
            }
            out = ROOT / "test-results"
            out.mkdir(exist_ok=True)
            (out / "lifecycle.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2))
        finally:
            stop()


if __name__ == "__main__":
    main()
