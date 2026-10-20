"""The agent's file and shell tools, for a workspace on a machine reached over SSH.

The same seven tools the local sandbox gives (read, bash, edit, write, grep,
find, ls), with the same arguments and the same reply shape, so the agent
works the same way wherever the project runs. Only the standard library is
used: a machine needs nothing but Python 3 to host a project.

Reads one JSON line {"name", "args"} on stdin, works in the current directory
(the project's workspace), and prints one JSON line: {"result": ...} or
{"error": ...}. Paths may not leave the workspace.
"""

import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd().resolve()
READ_LINES = 2000
TEXT_BYTES = 50 * 1024
BASH_MAX = 60


def _path(value, default="."):
    p = (ROOT / (value or default)).resolve()
    if p != ROOT and ROOT not in p.parents:
        raise ValueError("路径必须在工作区内")
    return p


def _text(text, error=False):
    out = {"content": [{"type": "text", "text": text}]}
    if error:
        out["isError"] = True
    return out


def _clip(text):
    data = text.encode()
    if len(data) <= TEXT_BYTES:
        return text
    return "[前面的输出已截断]\n" + data[-TEXT_BYTES:].decode(errors="replace")


def read(args):
    path = _path(args["path"])
    lines = path.read_text(errors="replace").splitlines()
    start = max(int(args.get("offset") or 1), 1)
    limit = int(args.get("limit") or READ_LINES)
    part = lines[start - 1 : start - 1 + limit]
    text = "\n".join(part)
    end = start - 1 + len(part)
    if end < len(lines):
        text += (
            f"\n\n[显示第 {start}-{end} 行，共 {len(lines)} 行；"
            f"用 offset={end + 1} 继续]"
        )
    return _text(text)


def bash(args):
    timeout = min(max(int(args.get("timeout") or BASH_MAX), 1), BASH_MAX)
    try:
        done = subprocess.run(
            ["bash", "-c", args["command"]],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            errors="replace",
        )
    except subprocess.TimeoutExpired as e:
        out = e.stdout or ""
        if isinstance(out, bytes):
            out = out.decode(errors="replace")
        return _text(_clip(out) + f"\n\n命令超过 {timeout} 秒被终止", error=True)
    text = _clip(done.stdout or "(no output)")
    if done.returncode != 0:
        return _text(text + f"\n\nCommand exited with code {done.returncode}", True)
    return _text(text)


def write(args):
    path = _path(args["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    data = args.get("content", "")
    path.write_text(data)
    return _text(f"Successfully wrote {len(data.encode())} bytes to {args['path']}")


def edit(args):
    path = _path(args["path"])
    edits = args.get("edits")
    if isinstance(edits, str):
        edits = json.loads(edits)
    if isinstance(edits, dict):
        edits = [edits]
    if not edits and "oldText" in args:
        edits = [{"oldText": args["oldText"], "newText": args.get("newText", "")}]
    original = path.read_text()
    spans = []
    for item in edits or []:
        old = item["oldText"]
        count = original.count(old)
        if count == 0:
            raise ValueError(f"在 {args['path']} 里找不到要替换的文本：{old[:80]!r}")
        if count > 1:
            raise ValueError(f"要替换的文本出现了 {count} 次，请给更长、唯一的片段")
        at = original.index(old)
        spans.append((at, at + len(old), item.get("newText", "")))
    spans.sort()
    for a, b in zip(spans, spans[1:]):
        if b[0] < a[1]:
            raise ValueError("几处替换互相重叠，请合并成一处")
    out, last = [], 0
    for start, end, new in spans:
        out.append(original[last:start])
        out.append(new)
        last = end
    out.append(original[last:])
    path.write_text("".join(out))
    return _text(f"Successfully replaced {len(spans)} block(s) in {args['path']}.")


def _files(base, pattern=None):
    if base.is_file():
        yield base
        return
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(".") and d != "node_modules"
        )
        for name in sorted(filenames):
            path = Path(dirpath) / name
            rel = str(path.relative_to(base))
            if pattern and not (
                fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern)
            ):
                continue
            yield path


def grep(args):
    base = _path(args.get("path"))
    flags = re.IGNORECASE if args.get("ignoreCase") else 0
    pattern = re.escape(args["pattern"]) if args.get("literal") else args["pattern"]
    rx = re.compile(pattern, flags)
    context = int(args.get("context") or 0)
    limit = int(args.get("limit") or 100)
    out = []
    for path in _files(base, args.get("glob")):
        try:
            lines = path.read_text(errors="strict").splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(ROOT)
        for i, line in enumerate(lines):
            if rx.search(line):
                lo, hi = max(0, i - context), min(len(lines), i + context + 1)
                for j in range(lo, hi):
                    mark = ":" if j == i else "-"
                    out.append(f"{rel}{mark}{j + 1}{mark} {lines[j][:500]}")
                if len([x for x in out if ":" in x]) >= limit:
                    return _text(_clip("\n".join(out)) + f"\n\n[已达 {limit} 条上限]")
    return _text(_clip("\n".join(out)) or "No matches found")


def find(args):
    base = _path(args.get("path"))
    limit = int(args.get("limit") or 1000)
    found = [
        str(p.relative_to(base))
        for p in _files(base, args["pattern"].replace("**/", ""))
    ][:limit]
    return _text("\n".join(found) or "No files found matching pattern")


def ls(args):
    base = _path(args.get("path"))
    limit = int(args.get("limit") or 500)
    names = sorted((p.name + "/" if p.is_dir() else p.name) for p in base.iterdir())[
        :limit
    ]
    return _text("\n".join(names) or "(empty directory)")


TOOLS = {
    "read": read,
    "bash": bash,
    "write": write,
    "edit": edit,
    "grep": grep,
    "find": find,
    "ls": ls,
}


def main():
    line = sys.stdin.readline()
    try:
        request = json.loads(line)
        tool = TOOLS.get(request.get("name"))
        if tool is None:
            raise ValueError("Unknown Pi tool")
        print(
            json.dumps({"result": tool(request.get("args") or {})}, ensure_ascii=False)
        )
    except Exception as e:  # noqa: BLE001 — every failure goes back to the agent as text
        print(json.dumps({"error": str(e)[:1000]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
