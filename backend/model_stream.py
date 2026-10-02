"""Read OpenAI SSE responses while exposing only visible answer text."""

import json

import httpx


async def streamed_post(client, url, headers, body, on_delta):
    body = {**body, "stream": True, "stream_options": {"include_usage": True}}
    async with client.stream("POST", url, headers=headers, json=body) as response:
        if (
            response.status_code != 200
            or "text/event-stream" not in response.headers.get("content-type", "")
        ):
            await response.aread()
            return response
        parts, usage, finish = [], None, None
        size = 0
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            if not payload:
                continue
            value = json.loads(payload)
            if value.get("error"):
                raise ValueError("模型流式响应失败，请重试")
            usage = value.get("usage") or usage
            choices = value.get("choices") or []
            if not choices:
                continue
            choice = choices[0]
            finish = choice.get("finish_reason") or finish
            text = (choice.get("delta") or {}).get("content")
            if isinstance(text, str) and text:
                size += len(text)
                if size > 2_000_000:
                    raise ValueError("模型返回内容过长")
                parts.append(text)
                on_delta(text)
        if finish is None:
            raise ValueError("模型响应中断，请重试")
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": finish, "message": {"content": "".join(parts)}}
                ],
                "usage": usage,
            },
        )
