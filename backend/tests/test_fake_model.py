import asyncio
import json
import threading
import time

import httpx
import pytest

from backend.devtools.fake_model import FakeModel
from backend.model_stream import streamed_post

REPLY = "The quick brown fox jumps over the lazy dog."


@pytest.fixture
def fake():
    with FakeModel(REPLY, chunk_size=5) as server:
        yield server


def body(model, *, stream=False, include_usage=False, content="hi"):
    value = {
        "model": model,
        "messages": [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": content},
        ],
    }
    if stream:
        value["stream"] = True
        if include_usage:
            value["stream_options"] = {"include_usage": True}
    return value


def post(fake, payload, **kw):
    return httpx.post(fake.base_url + "/chat/completions", json=payload, **kw)


def read_stream(fake, payload, timeout=5):
    """Return (response, list of raw `data:` payload strings)."""
    lines = []
    with (
        httpx.Client(timeout=timeout) as client,
        client.stream(
            "POST", fake.base_url + "/chat/completions", json=payload
        ) as response,
    ):
        for line in response.iter_lines():
            if line.startswith("data:"):
                lines.append(line[5:].strip())
        return response, lines


def read_dropped_stream(fake, payload):
    """Read a stream the server hangs up on; return the `data:` payloads."""
    lines = []
    with (
        httpx.Client(timeout=5) as client,
        client.stream(
            "POST", fake.base_url + "/chat/completions", json=payload
        ) as response,
    ):
        assert response.status_code == 200
        with pytest.raises(httpx.RemoteProtocolError):
            for line in response.iter_lines():
                if line.startswith("data:"):
                    lines.append(line[5:].strip())
    return lines


def stream_text(lines):
    chunks = [json.loads(x) for x in lines if x != "[DONE]"]
    text = "".join(
        c["choices"][0]["delta"].get("content") or "" for c in chunks if c["choices"]
    )
    finishes = [
        c["choices"][0]["finish_reason"]
        for c in chunks
        if c["choices"] and c["choices"][0].get("finish_reason")
    ]
    return chunks, text, finishes


def test_ok_streams_the_reply_in_chunks_and_finishes(fake):
    response, lines = read_stream(
        fake, body("fake-ok", stream=True, include_usage=True)
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert lines[-1] == "[DONE]"
    chunks, text, finishes = stream_text(lines)
    assert text == REPLY
    assert finishes == ["stop"]
    contents = [
        c["choices"][0]["delta"]["content"]
        for c in chunks
        if c["choices"] and c["choices"][0]["delta"].get("content")
    ]
    assert len(contents) > 1
    assert all(len(x) <= 5 for x in contents)
    assert all(c["object"] == "chat.completion.chunk" for c in chunks)
    assert len({c["id"] for c in chunks}) == 1
    assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"
    final = chunks[-1]
    assert final["choices"][0]["finish_reason"] == "stop"
    assert set(final["usage"]) == {
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
    }

    plain = post(fake, body("fake-ok")).json()
    assert plain["object"] == "chat.completion"
    assert plain["choices"][0]["message"] == {
        "role": "assistant",
        "content": REPLY,
    }
    assert plain["choices"][0]["finish_reason"] == "stop"
    assert plain["usage"]["total_tokens"] == (
        plain["usage"]["prompt_tokens"] + plain["usage"]["completion_tokens"]
    )


def test_stream_usage_only_when_requested(fake):
    _, lines = read_stream(fake, body("fake-ok", stream=True))
    chunks, _, _ = stream_text(lines)
    assert all("usage" not in c for c in chunks)


def test_the_real_stream_parser_reads_the_reply(fake):
    seen = []

    async def run():
        async with httpx.AsyncClient(timeout=5) as client:
            return await streamed_post(
                client,
                fake.base_url + "/chat/completions",
                {"authorization": "Bearer anything"},
                body("fake-ok"),
                seen.append,
            )

    response = asyncio.run(run()).json()
    assert "".join(seen) == REPLY
    assert len(seen) > 1
    assert response["choices"][0]["message"]["content"] == REPLY
    assert response["choices"][0]["finish_reason"] == "stop"
    assert response["usage"]["completion_tokens"] > 0


def test_retry_suffix_fails_only_the_first_requests(fake):
    codes = [post(fake, body("fake-429x2")).status_code for _ in range(3)]
    assert codes == [429, 429, 200]
    # Counters are kept per model name.
    assert post(fake, body("fake-500x1")).status_code == 500
    assert post(fake, body("fake-500x1")).status_code == 200
    assert post(fake, body("fake-429x2")).status_code == 200


def test_retry_suffix_applies_to_streaming_and_drops():
    with FakeModel(REPLY, chunk_size=5) as fake:
        with pytest.raises(httpx.HTTPError):
            read_stream(fake, body("fake-dropx1", stream=True))
        response, lines = read_stream(fake, body("fake-dropx1", stream=True))
        assert response.status_code == 200
        assert lines[-1] == "[DONE]"
        assert stream_text(lines)[1] == REPLY


@pytest.mark.parametrize(
    "mode,status",
    [("fake-429", 429), ("fake-500", 500), ("fake-401", 401), ("fake-404", 404)],
)
def test_status_modes_return_json_errors(fake, mode, status):
    for payload in (body(mode), body(mode, stream=True)):
        r = post(fake, payload)
        assert r.status_code == status
        assert r.headers["content-type"].startswith("application/json")
        error = r.json()["error"]
        assert error["message"]
        assert error["type"]
        assert ("retry-after" in r.headers) == (status == 429)
    if status == 429:
        assert r.headers["retry-after"] == "1"


def test_drop_ends_the_stream_without_finishing():
    with FakeModel(REPLY, chunk_size=5) as fake:
        lines = read_dropped_stream(
            fake, body("fake-drop", stream=True, include_usage=True)
        )
        assert lines and "[DONE]" not in lines
        _, text, finishes = stream_text(lines)
        assert text
        assert len(text) < len(REPLY)
        assert REPLY.startswith(text)
        assert finishes == []


def test_drop_without_streaming_sends_less_than_it_declared(fake):
    with pytest.raises(httpx.RemoteProtocolError):
        post(fake, body("fake-drop"))


def test_drop_still_splits_a_short_reply():
    with FakeModel("hello", chunk_size=64) as fake:
        lines = read_dropped_stream(fake, body("fake-drop", stream=True))
        _, text, finishes = stream_text(lines)
        assert 0 < len(text) < len("hello")
        assert finishes == []


def test_hang_times_out_the_client():
    fake = FakeModel(REPLY, hang_seconds=5)
    fake.start()
    try:
        started = time.monotonic()
        with (
            pytest.raises(httpx.ReadTimeout),
            httpx.Client(timeout=0.3) as client,
        ):
            client.post(fake.base_url + "/chat/completions", json=body("fake-hang"))
        assert time.monotonic() - started < 2
    finally:
        stopping = time.monotonic()
        fake.stop()
    assert time.monotonic() - stopping < 2


def test_stop_releases_a_hanging_request_immediately():
    fake = FakeModel(REPLY, hang_seconds=30)
    fake.start()
    outcome = []

    def request():
        try:
            outcome.append(post(fake, body("fake-hang"), timeout=20))
        except httpx.HTTPError as error:
            outcome.append(error)

    thread = threading.Thread(target=request, daemon=True)
    thread.start()
    time.sleep(0.3)
    started = time.monotonic()
    fake.stop()
    thread.join(5)
    assert not thread.is_alive()
    assert time.monotonic() - started < 3
    assert isinstance(outcome[0], httpx.HTTPError)


def test_malformed_streams_a_good_chunk_then_garbage(fake):
    response, lines = read_stream(fake, body("fake-malformed", stream=True))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert json.loads(lines[0])["choices"][0]["delta"]["content"]
    assert lines[1] == "{not json"
    assert "[DONE]" not in lines
    with pytest.raises(json.JSONDecodeError):
        json.loads(lines[1])


def test_malformed_without_streaming_is_html_labelled_as_json(fake):
    r = post(fake, body("fake-malformed"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.text == "<html>oops</html>"


def test_length_finishes_with_length(fake):
    _, lines = read_stream(fake, body("fake-length", stream=True))
    _, text, finishes = stream_text(lines)
    assert text == REPLY
    assert finishes == ["length"]
    plain = post(fake, body("fake-length")).json()
    assert plain["choices"][0]["message"]["content"] == REPLY
    assert plain["choices"][0]["finish_reason"] == "length"


def test_empty_answers_with_nothing_and_stops(fake):
    _, lines = read_stream(fake, body("fake-empty", stream=True, include_usage=True))
    _, text, finishes = stream_text(lines)
    assert text == ""
    assert finishes == ["stop"]
    assert lines[-1] == "[DONE]"
    plain = post(fake, body("fake-empty")).json()
    assert plain["choices"][0]["message"]["content"] == ""
    assert plain["choices"][0]["finish_reason"] == "stop"
    assert plain["usage"]["completion_tokens"] == 0


def test_slow_waits_between_chunks():
    with FakeModel("abcdefghij", chunk_size=2, slow_delay=0.1) as fake:
        started = time.monotonic()
        _, lines = read_stream(fake, body("fake-slow", stream=True))
        elapsed = time.monotonic() - started
        assert stream_text(lines)[1] == "abcdefghij"
        assert elapsed >= 0.4
        started = time.monotonic()
        read_stream(fake, body("fake-ok", stream=True))
        assert time.monotonic() - started < 0.3


def test_chunk_delay_paces_the_ok_stream():
    with FakeModel("abcdefghij", chunk_size=2, chunk_delay=0.1) as fake:
        started = time.monotonic()
        read_stream(fake, body("fake-ok", stream=True))
        assert time.monotonic() - started >= 0.4


def test_requests_are_recorded():
    with FakeModel() as fake:
        post(fake, body("fake-ok"))
        post(fake, body("fake-500"))
        assert fake.requests[0]["model"] == "fake-ok"
        assert fake.requests[0]["messages"][0]["content"] == "be brief"
        assert [r["model"] for r in fake.requests] == ["fake-ok", "fake-500"]


def test_fault_hook_overrides_the_model_name():
    with FakeModel(
        fault=lambda b: "fake-500" if b["messages"][0]["content"] == "boom" else None
    ) as fake:
        bad = {
            "model": "fake-ok",
            "messages": [{"role": "system", "content": "boom"}],
        }
        good = {
            "model": "fake-ok",
            "messages": [{"role": "system", "content": "fine"}],
        }
        assert post(fake, bad).status_code == 500
        assert post(fake, good).status_code == 200
        assert post(fake, bad).status_code == 500


def test_fault_hook_names_share_the_retry_counter():
    with FakeModel(fault=lambda b: "fake-429x1" if b.get("flaky") else None) as fake:
        flaky = {**body("fake-ok"), "flaky": True}
        assert [post(fake, flaky).status_code for _ in range(2)] == [429, 200]
        assert post(fake, body("fake-ok")).status_code == 200


def test_reply_callable_receives_the_messages():
    seen = []

    def reply(messages):
        seen.append(messages)
        return "echo:" + messages[-1]["content"]

    with FakeModel(reply, chunk_size=3) as fake:
        assert (
            post(fake, body("fake-ok", content="ping")).json()["choices"][0]["message"][
                "content"
            ]
            == "echo:ping"
        )
        _, lines = read_stream(fake, body("fake-ok", stream=True, content="pong"))
        assert stream_text(lines)[1] == "echo:pong"
        assert seen[0][-1] == {"role": "user", "content": "ping"}
        assert len(seen) == 2


def test_unknown_fake_mode_is_a_400_naming_the_mode(fake):
    r = post(fake, body("fake-banana"))
    assert r.status_code == 400
    assert "fake-banana" in r.json()["error"]["message"]
    r = post(fake, body("fake-banana", stream=True))
    assert r.status_code == 400


def test_other_model_names_and_any_api_key_are_accepted(fake):
    r = post(fake, body("gpt-4o-mini"), headers={"authorization": "Bearer nope"})
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == REPLY
    assert r.json()["model"] == "gpt-4o-mini"


def test_bad_requests_get_json_errors(fake):
    r = httpx.post(fake.base_url + "/chat/completions", content=b"{nope")
    assert r.status_code == 400
    assert r.json()["error"]["message"]
    r = httpx.post(fake.base_url + "/chat/completions", json=[1, 2])
    assert r.status_code == 400
    assert httpx.get(fake.base_url + "/nothing").status_code == 404
    assert httpx.post(fake.base_url + "/nothing", json={}).status_code == 404


def test_models_lists_every_mode(fake):
    r = httpx.get(fake.base_url + "/models")
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()["data"]}
    assert ids == {
        "fake-ok",
        "fake-slow",
        "fake-hang",
        "fake-drop",
        "fake-malformed",
        "fake-429",
        "fake-500",
        "fake-401",
        "fake-404",
        "fake-length",
        "fake-empty",
    }
    assert r.json()["object"] == "list"


def test_keep_alive_connections_survive_between_requests(fake):
    with httpx.Client(timeout=5) as client:
        for _ in range(3):
            assert (
                client.post(
                    fake.base_url + "/chat/completions", json=body("fake-ok")
                ).status_code
                == 200
            )
            with client.stream(
                "POST",
                fake.base_url + "/chat/completions",
                json=body("fake-ok", stream=True),
            ) as response:
                assert "[DONE]" in response.read().decode()


def test_base_url_points_at_localhost_v1_and_stop_is_idempotent():
    fake = FakeModel()
    fake.start()
    assert fake.base_url.startswith("http://127.0.0.1:")
    assert fake.base_url.endswith("/v1")
    fake.stop()
    fake.stop()
    with pytest.raises(httpx.ConnectError):
        httpx.post(fake.base_url + "/chat/completions", json=body("fake-ok"))
