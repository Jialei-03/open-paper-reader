import asyncio
import uuid

import pytest

from backend.agent_tools import execute
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper


def test_partial_note_edits_preserve_content_and_require_revision(env):
    app, a, b, _ = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    p = paper(a)
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])

    def run(name, values, writable=True):
        return asyncio.run(
            execute(app, owner, "notes-test", name, values, str(uuid.uuid4()), writable)
        )

    def current():
        return a.get("/api/v1/items/" + note["id"]).json()

    result = run(
        "append_note",
        {
            "id": note["id"],
            "revision": note["revision"],
            "text": "## 原结论\n\n保留图片 ![图](/example.png)\n\n目标段落\n\n重复 重复\n\naaa",
        },
    )
    assert result["_receipt"]["verification"] == "confirmed"
    before = current()
    result = run(
        "replace_note_text",
        {
            "id": note["id"],
            "revision": before["revision"],
            "old_text": "目标段落",
            "new_text": "修改后的段落",
        },
    )
    assert result["body"] == before["body"].replace("目标段落", "修改后的段落")
    assert result["title"] == before["title"]
    assert result["_receipt"]["revision_after"] == before["revision"] + 1
    for old in ["", "不存在", "重复", "aa"]:
        latest = current()
        with pytest.raises(ValueError, match="精确匹配一次"):
            run(
                "replace_note_text",
                {
                    "id": note["id"],
                    "revision": latest["revision"],
                    "old_text": old,
                    "new_text": "错误",
                },
            )
        assert current()["revision"] == latest["revision"]
    with pytest.raises(ValueError, match="409"):
        run(
            "append_note",
            {"id": note["id"], "revision": before["revision"], "text": "不能覆盖"},
        )
    with pytest.raises(ValueError, match="只读"):
        run(
            "append_note",
            {"id": note["id"], "revision": current()["revision"], "text": "不能写"},
            False,
        )
    with pytest.raises(ValueError, match="不能为空"):
        run(
            "append_note",
            {"id": note["id"], "revision": current()["revision"], "text": ""},
        )
    result = run(
        "replace_note_text",
        {
            "id": note["id"],
            "revision": current()["revision"],
            "old_text": "修改后的段落",
            "new_text": "",
        },
    )
    assert "修改后的段落" not in result["body"] and "保留图片" in result["body"]
    other = paper(b)
    other_note = next(
        n for n in b.get("/api/v1/items").json() if n["paper_id"] == other["id"]
    )
    with pytest.raises(ValueError):
        run(
            "append_note",
            {
                "id": other_note["id"],
                "revision": other_note["revision"],
                "text": "不允许",
            },
        )


@pytest.mark.parametrize("name", ["append_note", "replace_note_text"])
def test_note_tool_race_and_checkpoint(env, monkeypatch, name):
    import httpx

    from backend.agent_checkpoint import fingerprint, previous_write
    from backend.models import AgentRun
    from backend.tests.test_acceptance import write
    from backend.tests.test_agents import configure

    app, a, _, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])
    note = write(
        a,
        "/items/" + note["id"],
        {
            "kind": "note",
            "paper_id": p["id"],
            "title": note["title"],
            "body": "Existing evidence",
        },
        "PUT",
        note["revision"],
    ).json()
    args = {
        "id": note["id"],
        "revision": note["revision"],
        **(
            {"text": "\nMore"}
            if name == "append_note"
            else {"old_text": "Existing", "new_text": "Checked"}
        ),
    }
    original = httpx.AsyncClient.request
    changed = False

    async def request(client, method, url, **kwargs):
        nonlocal changed
        if method == "PUT" and not changed:
            changed = True
            response = write(
                a,
                "/items/" + note["id"],
                {
                    "kind": "note",
                    "paper_id": p["id"],
                    "title": note["title"],
                    "body": "Human update",
                },
                "PUT",
                note["revision"],
            )
            assert response.status_code == 200
        return await original(client, method, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "request", request)
    with pytest.raises(ValueError, match="409"):
        asyncio.run(execute(app, owner, "test", name, args, "race"))
    assert a.get("/api/v1/items/" + note["id"]).json()["body"] == "Human update"
    monkeypatch.setattr(httpx.AsyncClient, "request", original)
    note = a.get("/api/v1/items/" + note["id"]).json()
    args["revision"] = note["revision"]
    if name == "replace_note_text":
        args["old_text"] = "Human"
    session = a.post("/api/v1/agent/sessions", json={}).json()["id"]
    row = a.post(
        f"/api/v1/agent/sessions/{session}/runs",
        json={"prompt": "局部编辑", "model_config_id": model},
    ).json()
    result = asyncio.run(
        execute(app, owner, session, name, args, f"agent:{row['id']}:1")
    )
    with app.state.maker() as d:
        run = d.get(AgentRun, row["id"])
        run.status = "failed"
        run.steps = [
            {
                "name": name,
                "status": "running",
                "arguments": args,
                "fingerprint": fingerprint(name, args),
            }
        ]
        d.commit()
    checkpoint = asyncio.run(
        execute(
            app,
            owner,
            session,
            "read_task_checkpoint",
            {"id": row["id"]},
            "read",
            False,
        )
    )
    assert checkpoint["items"][0]["status"] == "committed"
    assert checkpoint["items"][0]["receipt"]["verification"] == "confirmed"
    reused = previous_write(app, owner, row["id"], name, args)
    assert reused["already_executed"] and reused["result"]["body"] == result["body"]
    assert a.get("/api/v1/items/" + note["id"]).json()["revision"] == result["revision"]
