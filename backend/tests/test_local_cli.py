"""Smoke test of the one-command local build: start, health check, stop."""

import fcntl
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

from backend.local import cli

ROOT = Path(__file__).resolve().parents[2]
LOCKS = ("preparation-worker.lock", "translation-worker.lock")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url):
    with urllib.request.urlopen(url, timeout=2) as response:
        return response.headers, json.loads(response.read())


def test_the_command_refuses_to_listen_on_a_network():
    for host in ("0.0.0.0", "192.168.1.20"):
        with pytest.raises(SystemExit):
            cli.parse(["--host", host])
    assert cli.parse(["--port", "9000"]).host == "127.0.0.1"


def test_start_answer_and_stop(tmp_path):
    port = free_port()
    data = tmp_path / "data"
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("APP_", "DATABASE_", "STORAGE_", "OPR_", "LAYOUT_"))
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "backend.local", "--port", str(port), "--no-browser", "--data", str(data)],
        cwd=tmp_path,
        env={**env, "PYTHONPATH": str(ROOT)},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(200):
            try:
                _, health = get(url + "/api/v1/health")
                break
            except OSError:
                if process.poll() is not None:
                    raise AssertionError(process.stdout.read())
                time.sleep(0.1)
        else:
            raise AssertionError("server did not start")
        assert health == {**health, "status": "ok", "mode": "local"}
        headers, me = get(url + "/api/v1/auth/me")
        assert me["local"] is True and me["user"]["username"] == "reader"
        assert "paper_session=" in headers["set-cookie"]
        assert (data / "workspace.db").is_file() and (data / "files").is_dir()
        for _ in range(300):  # the workers take their locks once they are up
            if all((data / name).exists() for name in LOCKS):
                break
            time.sleep(0.1)
    finally:
        process.send_signal(signal.SIGINT)
        output, _ = process.communicate(timeout=30)
    assert process.returncode == 0, output
    assert "Stopped." in output
    # Each worker holds its lock while it runs: every lock is free again.
    for name in LOCKS:
        assert (data / name).exists(), name
        with (data / name).open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_a_container_with_only_the_built_frontend_serves_it(tmp_path, monkeypatch):
    from backend.local import paths

    monkeypatch.delenv("OPR_FRONTEND_DIR", raising=False)
    (tmp_path / "frontend" / "dist").mkdir(parents=True)
    monkeypatch.setattr(paths, "CHECKOUT", tmp_path)
    monkeypatch.setattr(paths, "BUNDLE", tmp_path / "bundle")
    # No dist yet: the wheel's copy.
    assert paths.frontend_dir() == tmp_path / "bundle" / "frontend"
    (tmp_path / "frontend" / "dist" / "index.html").write_text("<div id=\"root\"></div>")
    assert paths.frontend_dir() == tmp_path / "frontend"


def test_the_desktop_app_is_told_where_to_look(tmp_path):
    """--desktop says `ORA_READY <url>` once it answers; a second start on the
    same data folder says where the first one is, and leaves it running."""
    data = tmp_path / "data"
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("APP_", "DATABASE_", "STORAGE_", "OPR_", "LAYOUT_"))
    }
    env = {**env, "PYTHONPATH": str(ROOT)}

    def start(port):
        return subprocess.Popen(
            [sys.executable, "-m", "backend.local", "--desktop", "--port", str(port), "--data", str(data)],
            cwd=tmp_path,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    first_port = free_port()
    first = start(first_port)
    try:
        url = f"http://127.0.0.1:{first_port}"
        for line in first.stdout:
            if line.startswith("ORA_READY"):
                assert line.split() == ["ORA_READY", url]
                break
        else:
            raise AssertionError("no ORA_READY line")
        second = start(free_port())
        output, _ = second.communicate(timeout=60)
        assert second.returncode == 0, output
        assert f"ORA_SHARED {url}" in output
        assert first.poll() is None
    finally:
        first.send_signal(signal.SIGINT)
        first.communicate(timeout=30)
