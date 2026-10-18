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
