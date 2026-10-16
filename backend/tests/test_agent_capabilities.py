"""What the agent may do is written down once, shown from there, and enforced from there."""

import json

from backend import agent_limits
from backend.agent_tools import TOOL_MAP, TOOLS, execute
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes


def test_output_budget_follows_the_model_family():
    minimax = {"model": "MiniMax-M3.1-Flash-Preview", "protocol": "openai"}
    assert agent_limits.output_tokens(minimax) == 32768
    assert agent_limits.output_tokens({**minimax, "model": "MiniMax-M3"}) == 32768
    # A model that shares thinking with its answer needs the room; others keep
    # the smaller budget that has always been enough for them.
    assert agent_limits.output_tokens({"model": "gpt-x", "protocol": "openai"}) == 8192
    assert agent_limits.output_tokens({"model": "claude", "protocol": "anthropic"}) == 8192


def test_the_runtime_is_told_its_limits():
    limits = agent_limits.runtime_limits({"model": "MiniMax-M3", "protocol": "openai"})
    assert limits == {
        "output_tokens": 32768,
        "tool_calls": agent_limits.TOOL_CALLS,
        "model_turns": agent_limits.MODEL_TURNS,
        "context_chars": agent_limits.CONTEXT_CHARS,
    }


def test_the_capabilities_shown_to_readers_come_from_the_same_numbers(env, monkeypatch):
    app, a, _b, _settings = env
    monkeypatch.setattr(agent_limits, "PAGES_PER_READ", 7)
    monkeypatch.setattr(agent_limits, "IMAGES_PER_RUN", 3)
    shown = a.get("/api/v1/agent/capabilities").json()
    text = " ".join(shown["limits"])
    assert "每次最多 7 页" in text
    assert "每轮最多发送 3 张图片" in text
    assert shown["run"] == {
        "model_turns": agent_limits.MODEL_TURNS,
        "tool_calls": agent_limits.TOOL_CALLS,
        "seconds": agent_limits.EXECUTION_SECONDS,
    }


def test_every_tool_is_described_the_same_way():
    for tool in TOOLS:
        assert tool["name"] and tool["description"].strip(), tool["name"]
        assert isinstance(tool["write"], bool), tool["name"]
        schema = tool["parameters"]
        assert schema.get("type") == "object", tool["name"]
        # A required parameter must exist, or the model can never satisfy it.
        assert set(schema.get("required", [])) <= set(schema.get("properties", {})), tool["name"]
    assert len(TOOL_MAP) == len(TOOLS), "tool names are unique"


def test_reading_a_file_stops_at_the_advertised_number_of_pages(env, monkeypatch):
    import asyncio

    app, a, _b, settings = env
    owner, _model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "twelve.pdf", pdf_bytes())
    monkeypatch.setattr(agent_limits, "PAGES_PER_READ", 2)

    async def read(pages):
        return await execute(
            app, owner, "session", "read_file", {"id": f["id"], "page": 1, "pages": pages}, "k", False
        )

    result = asyncio.run(read(5))
    assert [row["page"] for row in result["pages"]] == [1, 2]
    monkeypatch.setattr(agent_limits, "PAGES_PER_READ", 5)
    assert len(asyncio.run(read(5))["pages"]) == 5
    assert json.dumps(result)  # plain data
