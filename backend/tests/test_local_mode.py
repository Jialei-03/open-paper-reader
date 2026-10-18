"""APP_MODE=local: one reader, signed in by itself, only through loopback."""

import pytest
from fastapi.testclient import TestClient

from backend import translation_settings
from backend.config import Settings
from backend.main import PASSWORD, create_app
from backend.models import Base, User

LOCAL_URL = "http://127.0.0.1:8765"


def make_app(tmp_path, **values):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
        origin=LOCAL_URL,
        **values,
    )
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    return app


@pytest.fixture
def local_app(tmp_path):
    app = make_app(tmp_path, mode="local")
    yield app
    app.state.engine.dispose()


def client(app, host="127.0.0.1", base_url=LOCAL_URL):
    return TestClient(app, base_url=base_url, client=(host, 50000))


def test_local_mode_signs_the_reader_in_and_keeps_writes_csrf_protected(local_app):
    with client(local_app) as c:
        me = c.get("/api/v1/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["local"] is True
        assert me.json()["user"]["username"] == "reader"
        assert c.cookies.get("paper_session") and c.cookies.get("paper_csrf")
        # Signed in now: the next call is a normal session, not a new account.
        again = c.get("/api/v1/auth/me").json()
        assert "local" not in again and again["user"]["id"] == me.json()["user"]["id"]
        assert c.post("/api/v1/auth/logout").status_code == 403  # no CSRF header
        out = c.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": c.cookies["paper_csrf"]}
        )
        assert out.status_code == 200
    with local_app.state.maker() as d:
        assert d.query(User).count() == 1


def test_local_mode_uses_the_existing_reader(local_app):
    with local_app.state.maker() as d:
        d.add(User(username="ada", password=PASSWORD.hash("Existing-password-2026!")))
        d.commit()
    with client(local_app) as c:
        assert c.get("/api/v1/auth/me").json()["user"]["username"] == "ada"


@pytest.mark.parametrize(
    "host, base_url, headers",
    [
        ("192.168.1.20", LOCAL_URL, {}),  # another computer on the network
        ("127.0.0.1", "http://evil.example:8765", {}),  # DNS rebinding
        ("127.0.0.1", LOCAL_URL, {"X-Forwarded-For": "203.0.113.9"}),  # a proxy
        ("127.0.0.1", LOCAL_URL, {"Forwarded": "for=203.0.113.9"}),
    ],
)
def test_local_sign_in_refuses_anything_but_this_machine(local_app, host, base_url, headers):
    with client(local_app, host, base_url) as c:
        assert c.get("/api/v1/auth/me", headers=headers).status_code == 401
        assert not c.cookies.get("paper_session")


def test_cloud_mode_never_signs_in_by_itself(tmp_path):
    app = make_app(tmp_path)
    with client(app) as c:
        assert c.get("/api/v1/auth/me").status_code == 401
        assert c.get("/api/v1/health").json()["mode"] == "cloud"
    app.state.engine.dispose()


def test_local_mode_bound_beyond_loopback_never_signs_in(tmp_path):
    app = make_app(tmp_path, mode="local", host="0.0.0.0")
    with client(app) as c:
        assert c.get("/api/v1/auth/me").status_code == 401
    app.state.engine.dispose()


@pytest.mark.parametrize(
    "env",
    [
        {"APP_MODE": "local", "APP_HOST": "0.0.0.0"},
        {"APP_MODE": "local", "APP_HOST": "192.168.1.20"},
        {
            "APP_MODE": "local",
            "APP_ENV": "production",
            "APP_ORIGIN": "https://reader.example",
            "DATABASE_URL": "postgresql://x/y",
        },
    ],
)
def test_local_mode_refuses_to_start_off_loopback(monkeypatch, env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match="loopback"):
        Settings.env()


def test_mode_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("APP_MODE", raising=False)
    assert Settings.env().mode == "cloud"
    monkeypatch.setenv("APP_MODE", "local")
    assert Settings.env().mode == "local"
    monkeypatch.setenv("APP_MODE", "desktop")
    with pytest.raises(ValueError):
        Settings.env()


def test_local_mode_accepts_writes_from_localhost_too(local_app):
    with client(local_app) as c:
        c.get("/api/v1/auth/me")
        response = c.post(
            "/api/v1/auth/logout",
            headers={
                "Origin": "http://localhost:8765",
                "X-CSRF-Token": c.cookies["paper_csrf"],
            },
        )
        assert response.status_code == 200


def test_model_servers_on_this_machine_only_in_local_mode(monkeypatch):
    monkeypatch.delenv("APP_MODE", raising=False)
    assert "127.0.0.1" not in translation_settings.allowed_hosts()
    for url in ("http://127.0.0.1:11434/v1", "http://localhost:1234/v1"):
        with pytest.raises(ValueError):
            translation_settings.validate_endpoint(url)
    monkeypatch.setenv("APP_MODE", "local")
    assert (
        translation_settings.validate_endpoint("http://127.0.0.1:11434/v1/")
        == "http://127.0.0.1:11434/v1"
    )
    assert translation_settings.validate_endpoint("http://localhost:1234/v1")
    for url in (
        "http://192.168.1.20:11434/v1",
        "http://api.openai.com/v1",
        "http://user:pw@127.0.0.1:11434/v1",
    ):
        with pytest.raises(ValueError):
            translation_settings.validate_endpoint(url)


def test_a_local_model_needs_no_key(monkeypatch, tmp_path, local_app):
    monkeypatch.setenv("APP_MODE", "local")
    with client(local_app) as c:
        c.get("/api/v1/auth/me")
        csrf = {"X-CSRF-Token": c.cookies["paper_csrf"]}
        saved = c.put(
            "/api/v1/translation-settings",
            headers=csrf,
            json={
                "base_url": "http://127.0.0.1:11434/v1",
                "model": "qwen3:8b",
                "protocol": "openai",
                "api_key": "local",
            },
        )
        assert saved.status_code == 200, saved.text
        config = c.get("/api/v1/translation-settings").json()
        assert config["configured"] is True and config["local_models"] is True
        assert {"127.0.0.1", "localhost"} <= set(config["allowed_hosts"])
        assert config["models"][0]["base_url"] == "http://127.0.0.1:11434/v1"
