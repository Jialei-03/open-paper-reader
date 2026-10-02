import asyncio
import socket
import uuid

import pytest

from backend import agent_sandbox, agent_web
from backend.agent_tools import execute
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def test_public_network_rejects_private_and_redirect_rebinding(monkeypatch):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))]
    )
    with pytest.raises(ValueError, match="内网"):
        agent_web.fetch("https://example.org/file.pdf")
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("169.254.169.254", 443)),
        ],
    )
    with pytest.raises(ValueError, match="内网"):
        agent_web.addresses("example.org", 443)
    for url in [
        "file:///etc/passwd",
        "http://example.com:8765",
        "https://user:pass@example.org",
    ]:
        with pytest.raises(ValueError):
            agent_web.fetch(url)


def test_skill_download_materialize_export_owner_scope(env, monkeypatch):
    app, a, b, _ = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]

    def call(name, args, mode=True):
        return asyncio.run(
            execute(
                app,
                owner,
                "test",
                name,
                args,
                str(uuid.uuid4()),
                mode,
                sandbox_id="test",
            )
        )

    assert "confirm_delete" in call("read_skill", {})["content"]
    monkeypatch.setattr(
        agent_web, "fetch", lambda url: (pdf_bytes(), "application/pdf", url)
    )
    f = call("download_file", {"url": "https://example.org/paper.pdf"})
    assert a.get(f["url"]).status_code == 200
    assert b.get(f["url"]).status_code == 404
    events = []

    def sandbox(run, name, args):
        events.append((run, name, args))
        if name == "get_file":
            return {"data": __import__("base64").b64encode(b"# Result\n").decode()}
        return {"path": args.get("path")}

    monkeypatch.setattr(agent_sandbox, "call", sandbox)
    call("materialize_file", {"id": f["id"], "path": "paper.pdf"})
    assert events[-1][1] == "put_file"
    foreign = attach(b, paper(b), "other.pdf", pdf_bytes())
    with pytest.raises(ValueError):
        call("materialize_file", {"id": foreign["id"], "path": "other.pdf"})
    exported = call("export_file", {"path": "/work/result.md"})
    assert a.get(exported["url"]).text == "# Result\n"
    with pytest.raises(ValueError, match="只读"):
        call("download_file", {"url": "https://example.org/paper.pdf"}, False)
    p = paper(a)
    attached = call(
        "download_file", {"url": "https://example.org/paper.pdf", "paper_id": p["id"]}
    )
    assert attached["paper_id"] == p["id"]
