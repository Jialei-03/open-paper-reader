"""The local edition linked to a hosted account: sign in once, keep a token, sync papers."""

import json
import stat
import time

import pytest

from backend import cloud_link
from backend.tests.hard_pdfs import text_pdf
from backend.tests.test_acceptance import PASSWORD_TEXT, attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_local_mode import client, make_app

SITE = "http://127.0.0.1:9"  # never reached: the transport leads to the hosted app


@pytest.fixture
def linked(env, tmp_path, monkeypatch):
    """A hosted site (alice's account) and a local edition that can reach it."""
    hosted, alice, _bob, _ = env
    local = make_app(tmp_path / "local", mode="local")
    monkeypatch.setattr(cloud_link, "TRANSPORT", alice._transport)
    with client(local) as c:
        c.get("/api/v1/auth/me")
        c.headers["X-CSRF-Token"] = c.cookies["paper_csrf"]
        yield hosted, alice, local, c
    local.state.engine.dispose()


def pdf(n):
    # Different bytes per paper: papers are matched by their PDF.
    return text_pdf(n)


def with_pdf(c, title, data):
    p = paper(c, title)
    attach(c, p, name=title + ".pdf", data=data)
    return p


def titles(c):
    return sorted(p["title"] for p in c.get("/api/v1/papers").json())


def synced(c):
    assert c.post("/api/v1/cloud-link/sync").status_code == 200
    end = time.time() + 20
    while time.time() < end:
        state = c.get("/api/v1/cloud-link").json()
        if not state["sync"].get("running"):
            return state["last_sync"]
        time.sleep(0.05)
    raise AssertionError("sync did not finish")


def test_connecting_keeps_a_token_and_never_the_password(linked):
    hosted, alice, local, c = linked
    r = c.post(
        "/api/v1/cloud-link",
        json={"origin": SITE, "username": "alice", "password": PASSWORD_TEXT},
    )
    assert r.status_code == 200, r.text
    assert r.json()["connected"] and r.json()["username"] == "alice"
    assert "token" not in json.dumps(r.json())
    path = cloud_link._path(local.state.settings)
    kept = json.loads(path.read_text())
    assert kept["token"].startswith("pp_") and PASSWORD_TEXT not in path.read_text()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    # The hosted account sees the token, named for this computer.
    names = [t["name"] for t in alice.get("/api/v1/tokens").json()]
    assert any(n.startswith("本机版 · ") for n in names)

    assert c.delete("/api/v1/cloud-link").json()["connected"] is False
    assert not path.exists()


def test_a_wrong_password_or_address_connects_nothing(linked):
    _, _, local, c = linked
    r = c.post(
        "/api/v1/cloud-link",
        json={"origin": SITE, "username": "alice", "password": "wrong-password"},
    )
    assert r.status_code == 422 and "登录失败" in r.json()["detail"]
    r = c.post(
        "/api/v1/cloud-link",
        json={"origin": "http://example.com", "username": "a", "password": "b"},
    )
    assert r.status_code == 422
    assert not cloud_link._path(local.state.settings).exists()


def test_papers_sync_both_ways_once_and_a_shared_pdf_is_not_doubled(linked):
    _, alice, _, c = linked
    with_pdf(alice, "Only online", pdf(1))
    with_pdf(alice, "On both", pdf(2))
    paper(alice, "Online, no PDF")
    with_pdf(c, "Only here", pdf(3))
    with_pdf(c, "On both (local copy)", pdf(2))
    c.post(
        "/api/v1/cloud-link",
        json={"origin": SITE, "username": "alice", "password": PASSWORD_TEXT},
    )

    result = synced(c)
    assert result["downloaded"] == 1 and result["uploaded"] == 1, result
    assert result["without_pdf"] == 1 and result["errors"] == []
    assert titles(c) == ["On both (local copy)", "Only here", "Only online"]
    assert titles(alice) == ["On both", "Online, no PDF", "Only here", "Only online"]
    copied = next(p for p in c.get("/api/v1/papers").json() if p["title"] == "Only online")
    files = c.get(f"/api/v1/papers/{copied['id']}/files").json()
    assert c.get(f"/api/v1/files/{files[0]['id']}/content").content == pdf(1)

    again = synced(c)
    assert again["downloaded"] == 0 and again["uploaded"] == 0
    assert len(titles(c)) == 3 and len(titles(alice)) == 4


def test_a_revoked_token_asks_to_connect_again(linked):
    _, alice, _, c = linked
    c.post(
        "/api/v1/cloud-link",
        json={"origin": SITE, "username": "alice", "password": PASSWORD_TEXT},
    )
    for t in alice.get("/api/v1/tokens").json():
        alice.delete(f"/api/v1/tokens/{t['id']}")
    result = synced(c)
    assert "重新连接" in result["errors"][0]


def test_the_hosted_site_has_no_link_to_another_site(env):
    _, alice, _, _ = env
    assert alice.get("/api/v1/cloud-link").status_code == 404
