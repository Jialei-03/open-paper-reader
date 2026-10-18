"""Installing layout translation on demand (local build). Nothing is downloaded:
the install steps are replaced by small local commands."""

import sys
import time

import pytest
from fastapi.testclient import TestClient

from backend import layout_install
from backend.config import Settings
from backend.main import create_app
from backend.models import Base

LOCAL_URL = "http://127.0.0.1:8765"


def make_client(tmp_path, mode):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
        origin=LOCAL_URL,
        mode=mode,
    )
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    c = TestClient(app, base_url=LOCAL_URL, client=("127.0.0.1", 50000))
    return app, settings, c


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.delenv("LAYOUT_RUNTIME_DIR", raising=False)
    app, settings, c = make_client(tmp_path, "local")
    with c:
        c.get("/api/v1/auth/me")
        c.headers["X-CSRF-Token"] = c.cookies["paper_csrf"]
        yield settings, c
    app.state.engine.dispose()


def fake_python(target):
    """A step that leaves an interpreter where the real venv would put one."""
    python = layout_install.venv_python(target)
    code = (
        "import pathlib,shutil,sys;p=pathlib.Path(sys.argv[1]);"
        "p.parent.mkdir(parents=True,exist_ok=True);shutil.copy(sys.executable,p);"
        "print('created',p)"
    )
    return [sys.executable, "-c", code, str(python)]


def wait(c, *statuses):
    for _ in range(200):
        state = c.get("/api/v1/layout-install").json()
        if state["status"] in statuses:
            return state
        time.sleep(0.05)
    raise AssertionError(state)


def test_install_runs_each_step_then_layout_translation_is_available(local, monkeypatch):
    settings, c = local
    monkeypatch.setattr(
        layout_install,
        "steps",
        lambda target: [
            ("environment", 20, fake_python(target)),
            ("engine", 70, [sys.executable, "-c", "print('Collecting BabelDOC')"]),
            ("assets", 10, [sys.executable, "-c", "print('assets ready')"]),
        ],
    )
    before = c.get("/api/v1/layout-install").json()
    assert before["supported"] and not before["installed"] and not before["available"]
    assert c.get("/api/v1/translation-settings").json()["pdf_layout_enabled"] is False

    started = c.post("/api/v1/layout-install")
    assert started.status_code == 200 and started.json()["status"] == "running"
    done = wait(c, "completed", "failed")
    assert done["status"] == "completed", done
    assert done["installed"] and done["available"] and done["progress"] == 100
    assert c.get("/api/v1/translation-settings").json()["pdf_layout_enabled"] is True

    venv = layout_install.runtime_dir(settings)
    assert venv.name == "babeldoc-venv" and not venv.with_name("babeldoc-venv.partial").exists()
    command = layout_install.layout_runtime(settings)
    assert command[0] == str(layout_install.venv_python(venv)) and command[1] == "-I"
    assert command[2].endswith("worker/layout_translation_worker.py")


def test_cancel_stops_the_running_step_and_leaves_nothing(local, monkeypatch):
    settings, c = local
    monkeypatch.setattr(
        layout_install,
        "steps",
        lambda target: [
            ("environment", 10, fake_python(target)),
            ("engine", 90, [sys.executable, "-c", "import time;print('x',flush=True);time.sleep(30)"]),
        ],
    )
    c.post("/api/v1/layout-install")
    for _ in range(200):
        if c.get("/api/v1/layout-install").json()["stage"] == "engine":
            break
        time.sleep(0.05)
    assert c.post("/api/v1/layout-install/cancel").status_code == 200
    state = wait(c, "cancelled", "failed")
    assert state["status"] == "cancelled" and not state["installed"]
    venv = layout_install.runtime_dir(settings)
    assert not venv.exists() and not venv.with_name("babeldoc-venv.partial").exists()


def test_a_failed_step_reports_its_output(local, monkeypatch):
    _, c = local
    monkeypatch.setattr(
        layout_install,
        "steps",
        lambda target: [
            ("engine", 100, [sys.executable, "-c", "import sys;print('No matching distribution');sys.exit(1)"]),
        ],
    )
    c.post("/api/v1/layout-install")
    state = wait(c, "failed", "completed")
    assert state["status"] == "failed"
    assert "No matching distribution" in state["error"]
    assert not state["installed"]


def test_the_hosted_site_does_not_install_anything(tmp_path):
    app, settings, c = make_client(tmp_path, "cloud")
    with c:
        from backend.main import PASSWORD
        from backend.models import User

        with app.state.maker() as d:
            d.add(User(username="owner", password=PASSWORD.hash("Hosted-password-2026!")))
            d.commit()
        login = c.post(
            "/api/v1/auth/login",
            json={"username": "owner", "password": "Hosted-password-2026!"},
        )
        c.headers["X-CSRF-Token"] = login.json()["csrf"]
        assert c.get("/api/v1/layout-install").json()["supported"] is False
        assert c.post("/api/v1/layout-install").status_code == 409
        assert layout_install.layout_runtime(settings) is None
    app.state.engine.dispose()


def test_install_steps_prefer_uv_and_pin_babeldoc(tmp_path, monkeypatch):
    monkeypatch.setattr(layout_install.shutil, "which", lambda name: "/usr/bin/uv")
    planned = layout_install.steps(tmp_path / "venv")
    assert planned[0][2][:2] == ["/usr/bin/uv", "venv"]
    assert layout_install.BABELDOC in planned[1][2]
    assert planned[-1][0] == "assets"
