import asyncio
import json

import httpx
import pytest

from backend.model_errors import ModelError
from backend.model_stream import streamed_post


def event(value):
    return "data: " + json.dumps(value) + "\n\n"


@pytest.mark.parametrize("finish", ["stop", "length"])
def test_stream_preserves_usage_and_finish_without_exposing_reasoning(finish):
    payload = event({"choices": [{"delta": {"reasoning_content": "private thought"}}]})
    payload += event({"choices": [{"delta": {"content": "你好"}}]})
    payload += event({"choices": [{"delta": {}, "finish_reason": finish}]})
    payload += event({"choices": [], "usage": {"completion_tokens": 12}})
    payload += "data: [DONE]\n\n"
    seen = []

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=payload,
                )
            )
        ) as client:
            return await streamed_post(
                client, "https://example.test/v1/chat/completions", {}, {}, seen.append
            )

    response = asyncio.run(run()).json()
    assert seen == ["你好"]
    assert response["choices"][0]["finish_reason"] == finish
    assert response["usage"]["completion_tokens"] == 12


def test_truncated_stream_cannot_become_successful_translation():
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=event({"choices": [{"delta": {"content": "partial"}}]})
                    + "data: [DONE]\n\n",
                )
            )
        ) as client:
            await streamed_post(
                client, "https://example.test", {}, {}, lambda text: None
            )

    with pytest.raises(ModelError, match="中途断开") as caught:
        asyncio.run(run())
    assert caught.value.code == "interrupted"
