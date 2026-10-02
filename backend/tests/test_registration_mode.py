"""REGISTRATION=invite: an account needs an invitation made by an administrator."""

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import PASSWORD, create_app
from backend.models import Base, User

PASSWORD_TEXT = "Registration-mode-password-2026!"


@pytest.fixture
def invite_only(tmp_path):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
        registration="invite",
    )
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    with app.state.maker() as d:
        d.add(User(username="owner", password=PASSWORD.hash(PASSWORD_TEXT), admin=True))
        d.commit()
    with TestClient(app) as client:
        yield client
    app.state.engine.dispose()


def test_registration_without_invitation_is_refused(invite_only):
    refused = invite_only.post(
        "/api/v1/auth/register",
        json={"username": "guest", "password": PASSWORD_TEXT},
    )
    assert refused.status_code == 403
    assert "邀请码" in refused.json()["detail"]


def test_an_invitation_from_the_administrator_opens_one_registration(invite_only):
    login = invite_only.post(
        "/api/v1/auth/login", json={"username": "owner", "password": PASSWORD_TEXT}
    )
    assert login.status_code == 200
    invite_only.headers["X-CSRF-Token"] = login.json()["csrf"]
    invitation = invite_only.post(
        "/api/v1/invitations", json={"username": "guest"}
    ).json()["invitation"]
    invite_only.cookies.clear()
    wrong_name = invite_only.post(
        "/api/v1/auth/register",
        json={"username": "other", "password": PASSWORD_TEXT, "invitation": invitation},
    )
    assert wrong_name.status_code == 403
    created = invite_only.post(
        "/api/v1/auth/register",
        json={"username": "guest", "password": PASSWORD_TEXT, "invitation": invitation},
    )
    assert created.status_code == 200, created.text
    again = invite_only.post(
        "/api/v1/auth/register",
        json={"username": "guest2", "password": PASSWORD_TEXT, "invitation": invitation},
    )
    assert again.status_code == 403


def test_open_registration_stays_the_default(tmp_path, monkeypatch):
    monkeypatch.delenv("REGISTRATION", raising=False)
    assert Settings.env().registration == "open"
    monkeypatch.setenv("REGISTRATION", "closed")
    with pytest.raises(ValueError, match="REGISTRATION"):
        Settings.env()
