import asyncio
import uuid

import pytest

from backend.agent_tools import execute
from backend.tests.test_acceptance import env as env  # noqa: PLC0414


def test_generic_business_api_scope_revision_and_readonly(env):
    app, a, b, _ = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]

    def call(name, args, writable=True):
        return asyncio.run(
            execute(
                app, owner, "test", name, args, str(uuid.uuid4()), writable=writable
            )
        )

    schema = call("workspace_api", {"path": "/papers", "method": "POST"})
    assert "PaperCreate" in schema["schemas"]
    p = call(
        "workspace_write",
        {"path": "/papers", "method": "POST", "body": {"title": "Generic API paper"}},
    )
    actual = call("workspace_read", {"path": "/papers/" + p["id"]})
    assert actual["title"] == "Generic API paper"
    updated = call(
        "workspace_write",
        {
            "path": "/papers/" + p["id"],
            "method": "PATCH",
            "body": {"favorite": True},
            "revision": p["revision"],
        },
    )
    assert updated["favorite"]
    with pytest.raises(ValueError, match="409"):
        call(
            "workspace_write",
            {
                "path": "/papers/" + p["id"],
                "method": "PATCH",
                "body": {"favorite": False},
                "revision": p["revision"],
            },
        )
    with pytest.raises(ValueError, match="只读"):
        call(
            "workspace_write",
            {"path": "/papers", "method": "POST", "body": {"title": "forbidden"}},
            False,
        )
    assert b.get("/api/v1/papers/" + p["id"]).status_code == 404
    for path in [
        "/auth/me",
        "/translation-settings",
        "/tokens",
        "http://localhost/papers",
        "//example.com/papers",
        "/papers/%2e%2e/auth/me",
    ]:
        with pytest.raises(ValueError):
            call("workspace_read", {"path": path})
    call(
        "workspace_write",
        {
            "path": "/papers/" + p["id"],
            "method": "DELETE",
            "confirm_delete": p["id"],
            "revision": updated["revision"],
        },
    )
    assert a.get("/api/v1/papers/" + p["id"]).status_code == 404


def test_annotation_routes_discoverable_without_raw_file_or_secret_access(env):
    from backend.workspace_api import catalog, operation

    app, *_ = env
    paths = catalog(app)
    assert "/files/{id}/annotations" in paths
    assert "/files/{id}/annotations/{annotation_id}" in paths
    for path in ["/files/test/content", "/auth/me", "/translation-settings"]:
        with pytest.raises(ValueError):
            operation(app, path, "GET")
