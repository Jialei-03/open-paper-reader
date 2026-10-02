"""Client for isolated Pi tools. The Agent never receives Docker access."""

import json
import os
import socket


def call(run, name, args=None):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(85)
        try:
            client.connect(
                os.getenv("AGENT_SANDBOX_SOCKET", "/run/paper-sandbox/broker.sock")
            )
        except OSError:
            raise ValueError("隔离终端暂不可用，请使用业务工具或稍后重试") from None
        client.sendall(
            (
                json.dumps(
                    {"run": run.replace("-", ""), "name": name, "args": args or {}}
                )
                + "\n"
            ).encode()
        )
        with client.makefile("rb") as stream:
            data = stream.readline(30 * 1024 * 1024 + 1)
        if len(data) > 30 * 1024 * 1024:
            raise ValueError("隔离终端输出过大")
        result = json.loads(data)
        if result.get("error"):
            raise ValueError(result["error"])
        return result["result"]
