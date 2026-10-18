"""A fault-injecting, OpenAI-compatible fake model server for tests.

The failure to simulate is chosen by the request's ``model`` name, so a test
only has to set the configured model to ``fake-drop`` (or ``fake-429x2``) and
needs no other setup:

    with FakeModel("hello") as fake:
        httpx.post(fake.base_url + "/chat/completions",
                   json={"model": "fake-ok", "messages": [...]})

Any model name that does not start with ``fake-`` behaves like ``fake-ok``, the
``Authorization`` header is ignored, and a streamed answer carries ``usage``
only when the request sets ``stream_options.include_usage``, as OpenAI does.

Run it by hand to see how the UI copes with a flaky model:

    python -m backend.devtools.fake_model --port 8899 [--reply TEXT]
"""

import argparse
import json
import re
import socket
import sys
import threading
import time
import uuid
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Self

MODES = (
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
)

# status -> (error type, error code, message); 429 also carries Retry-After.
_ERRORS = {
    "fake-429": (429, "rate_limit_error", "rate_limit_exceeded", "Rate limit reached"),
    "fake-500": (500, "server_error", "internal_error", "The server had an error"),
    "fake-401": (401, "invalid_request_error", "invalid_api_key", "Invalid API key"),
    "fake-404": (
        404,
        "invalid_request_error",
        "model_not_found",
        "The model does not exist",
    ),
}

# "fake-429x2" -> mode "fake-429", fails for the first 2 requests of that name.
_RETRY_SUFFIX = re.compile(r"(fake-[a-z0-9]+)x(\d+)")


class _BadMode(ValueError):
    pass


def _tokens(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return (len(text) + 3) // 4


class FakeModel:
    def __init__(
        self,
        reply: str | Callable[[list[dict]], str] = "ok",
        *,
        fault: Callable[[dict], str | None] | None = None,
        chunk_size: int = 8,
        chunk_delay: float = 0.0,
        slow_delay: float = 0.2,
        hang_seconds: float = 3600.0,
    ):
        if chunk_size < 1:
            raise ValueError("chunk_size must be at least 1")
        self.reply = reply
        self.fault = fault
        self.chunk_size = chunk_size
        self.chunk_delay = chunk_delay
        self.slow_delay = slow_delay
        self.hang_seconds = hang_seconds
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self._counts: dict[str, int] = {}
        self._stopping = threading.Event()
        self._server: _Server | None = None
        self._thread: threading.Thread | None = None
        self._port: int | None = None

    # -- lifecycle ---------------------------------------------------------

    def start(self, port: int = 0) -> None:
        if self._server is not None:
            raise RuntimeError("FakeModel is already running")
        self._stopping.clear()
        server = _Server(("127.0.0.1", port), _Handler)
        server.fake = self
        self._server = server
        self._port = server.server_address[1]
        self._thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.05},
            name="fake-model",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        server, thread = self._server, self._thread
        if server is None:
            return
        self._server = self._thread = None
        # Wake hung and slow handlers first so nothing waits for a long sleep.
        self._stopping.set()
        server.shutdown()
        server.server_close()
        server.close_connections()
        if thread is not None:
            thread.join(2)

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.stop()

    @property
    def base_url(self) -> str:
        if self._port is None:
            raise RuntimeError("FakeModel has not been started")
        return f"http://127.0.0.1:{self._port}/v1"

    # -- request handling --------------------------------------------------

    def _mode(self, body: dict) -> str:
        """The behaviour this request gets, after fault hook and x<N> suffix."""
        name = self.fault(body) if self.fault else None
        if name is None:
            name = body.get("model")
        if not isinstance(name, str) or not name.startswith("fake-"):
            return "fake-ok"  # any other model name behaves like fake-ok
        mode, limit = name, None
        if mode not in MODES:
            match = _RETRY_SUFFIX.fullmatch(name)
            if match and match.group(1) in MODES:
                mode, limit = match.group(1), int(match.group(2))
            else:
                raise _BadMode(name)
        if limit is None:
            return mode
        with self._lock:
            self._counts[name] = count = self._counts.get(name, 0) + 1
        return mode if count <= limit else "fake-ok"

    def _answer(self, messages: list) -> str:
        if callable(self.reply):
            return self.reply(messages)
        return self.reply


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128
    fake: FakeModel

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._connections: set[socket.socket] = set()
        self._connections_lock = threading.Lock()

    def track(self, connection, add=True):
        with self._connections_lock:
            if add:
                self._connections.add(connection)
            else:
                self._connections.discard(connection)

    def close_connections(self):
        with self._connections_lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def handle_error(self, request, client_address):
        # Clients hanging up on purpose (timeouts, drops) are not worth a trace.
        if not isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            super().handle_error(request, client_address)


class _Handler(BaseHTTPRequestHandler):
    # Chunked transfer encoding is what lets a dropped stream look incomplete.
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True
    server: _Server

    def log_message(self, format, *args):
        pass

    def setup(self):
        super().setup()
        self.server.track(self.connection)

    def finish(self):
        self.server.track(self.connection, add=False)
        super().finish()

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        if self.path.split("?")[0] == "/v1/models":
            data = [
                {"id": m, "object": "model", "created": 0, "owned_by": "fake-model"}
                for m in MODES
            ]
            self._json(200, {"object": "list", "data": data})
        else:
            self._error(404, "invalid_request_error", "not_found", "Unknown route")

    def do_POST(self):
        try:
            raw = self._read_body()
        except (ValueError, OSError):
            self.close_connection = True
            return self._error(400, "invalid_request_error", None, "Bad request body")
        if self.path.split("?")[0] != "/v1/chat/completions":
            return self._error(
                404, "invalid_request_error", "not_found", "Unknown route"
            )
        try:
            body = json.loads(raw)
        except ValueError:
            body = None
        if not isinstance(body, dict):
            return self._error(
                400, "invalid_request_error", None, "Request body must be a JSON object"
            )
        self._chat(body)

    def _read_body(self) -> bytes:
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            data = bytearray()
            while True:
                size = int(
                    self.rfile.readline(65537).split(b";")[0].strip() or b"0", 16
                )
                if size == 0:
                    while self.rfile.readline(65537) not in (b"\r\n", b"\n", b""):
                        pass  # trailers
                    return bytes(data)
                data += self.rfile.read(size)
                self.rfile.readline()
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    # -- the chat endpoint -------------------------------------------------

    def _chat(self, body: dict):
        fake = self.server.fake
        with fake._lock:
            fake.requests.append(body)
        try:
            mode = fake._mode(body)
        except _BadMode as bad:
            return self._error(
                400,
                "invalid_request_error",
                "unknown_fake_mode",
                f"Unknown fake model mode: {bad}. Known modes: {', '.join(MODES)}",
            )
        except Exception as error:  # noqa: BLE001 - a hook bug becomes a 500
            return self._error(
                500,
                "server_error",
                "fault_hook_failed",
                f"fault hook raised: {error!r}",
            )

        if mode in _ERRORS:
            status, kind, code, message = _ERRORS[mode]
            return self._error(
                status,
                kind,
                code,
                f"{message} (simulated by {mode})",
                {"Retry-After": "1"} if status == 429 else None,
            )
        if mode == "fake-hang":
            fake._stopping.wait(fake.hang_seconds)
            self.close_connection = True
            return

        stream = bool(body.get("stream"))
        if mode == "fake-malformed" and not stream:
            return self._send(200, b"<html>oops</html>", "application/json")

        messages = body.get("messages")
        messages = messages if isinstance(messages, list) else []
        try:
            text = "" if mode == "fake-empty" else fake._answer(messages)
        except Exception as error:  # noqa: BLE001 - a reply bug becomes a 500
            return self._error(
                500, "server_error", "reply_failed", f"reply callable raised: {error!r}"
            )
        model = body.get("model") if isinstance(body.get("model"), str) else "fake-ok"
        finish = "length" if mode == "fake-length" else "stop"
        prompt = sum(
            _tokens(m.get("content") or "") for m in messages if isinstance(m, dict)
        )
        usage = {
            "prompt_tokens": prompt,
            "completion_tokens": _tokens(text) if text else 0,
        }
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        created = int(time.time())
        completion_id = "chatcmpl-fake-" + uuid.uuid4().hex[:12]
        if stream:
            options = body.get("stream_options")
            include_usage = isinstance(options, dict) and bool(
                options.get("include_usage")
            )
            self._stream(
                mode,
                completion_id,
                created,
                model,
                text,
                finish,
                usage if include_usage else None,
            )
        else:
            self._plain(mode, completion_id, created, model, text, finish, usage)

    def _plain(self, mode, completion_id, created, model, text, finish, usage):
        if mode == "fake-slow":
            self.server.fake._stopping.wait(self.server.fake.slow_delay)
        payload = json.dumps(
            {
                "id": completion_id,
                "object": "chat.completion",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": finish,
                    }
                ],
                "usage": usage,
            },
            ensure_ascii=False,
        ).encode()
        if mode == "fake-drop":
            # Promise the whole body, deliver half of it, then hang up.
            self._send(
                200, payload, "application/json", send=payload[: len(payload) // 2]
            )
            return self._abort()
        self._send(200, payload, "application/json")

    def _stream(self, mode, completion_id, created, model, text, finish, usage):
        fake = self.server.fake

        def frame(delta, reason=None, extra=None):
            value = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": reason}],
            }
            return json.dumps({**value, **(extra or {})}, ensure_ascii=False)

        size = fake.chunk_size
        pieces = [text[i : i + size] for i in range(0, len(text), size)] or [""]
        if mode == "fake-drop" and len(pieces) < 2 and len(text) >= 2:
            pieces = [text[: len(text) // 2], text[len(text) // 2 :]]
        deltas = [{"content": piece} for piece in pieces]
        deltas[0] = {"role": "assistant", **deltas[0]}
        frames = [frame(delta) for delta in deltas]
        if mode == "fake-drop":
            # Half of the content, then silence: no finish_reason, no [DONE].
            # (A reply too short to split sends none, only the headers.)
            keep = max(1, len(frames) // 2) if len(frames) > 1 else 0
            frames = frames[:keep]
        elif mode == "fake-malformed":
            frames = [frames[0], "{not json"]
        else:
            frames.append(frame({}, finish, {"usage": usage} if usage else None))

        delay = fake.slow_delay if mode == "fake-slow" else fake.chunk_delay
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        for index, payload in enumerate(frames):
            if index and delay > 0 and fake._stopping.wait(delay):
                return self._abort()
            self._event(payload)
        if mode == "fake-drop":
            return self._abort()
        if mode != "fake-malformed":
            self._event("[DONE]")
        self.wfile.write(b"0\r\n\r\n")  # a complete, well-formed body

    # -- wire helpers ------------------------------------------------------

    def _event(self, payload: str):
        data = f"data: {payload}\n\n".encode()
        self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")

    def _send(self, status, payload: bytes, content_type, headers=None, send=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if self.close_connection:
            self.send_header("Connection", "close")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload if send is None else send)

    def _json(self, status, value, headers=None):
        self._send(
            status,
            json.dumps(value, ensure_ascii=False).encode(),
            "application/json",
            headers,
        )

    def _error(self, status, kind, code, message, headers=None):
        self._json(
            status,
            {"error": {"message": message, "type": kind, "param": None, "code": code}},
            headers,
        )

    def _abort(self):
        """Hang up without finishing the response."""
        self.close_connection = True
        try:
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m backend.devtools.fake_model",
        description="Serve an OpenAI-compatible fake model with injectable faults.",
    )
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--reply", default="ok", help="text every answer contains")
    args = parser.parse_args(argv)
    fake = FakeModel(args.reply)
    fake.start(args.port)
    print(fake.base_url, flush=True)
    print("models: " + ", ".join(MODES) + " (plus an x<N> suffix, e.g. fake-429x2)")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        fake.stop()


if __name__ == "__main__":
    main()
