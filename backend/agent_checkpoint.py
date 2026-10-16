"""Owner-scoped continuation ledger; never execute a saved tool call."""

import hashlib
import json

from sqlalchemy import select

from .agent_receipts import verify_write
from .models import AgentRun, Idempotency


def fingerprint(name, args):
    return hashlib.sha256(
        json.dumps([name, args], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def lineage(d, owner, run_id):
    rows, seen = [], set()
    session = None
    while run_id:
        if run_id in seen or len(seen) >= 50:
            raise ValueError("任务续接记录异常")
        seen.add(run_id)
        run = d.get(AgentRun, run_id)
        if not run or run.owner != owner or (session and run.session_id != session):
            raise ValueError("任务不存在")
        session = run.session_id
        rows.append(run)
        run_id = (run.runtime or {}).get("resume_from")
    return list(reversed(rows))


def operations(rows):
    return [
        (run, index, step) for run in rows for index, step in enumerate(run.steps, 1)
    ]


def committed(d, owner, run, index):
    return d.scalar(
        select(Idempotency).where(
            Idempotency.owner == owner, Idempotency.key == f"agent:{run.id}:{index}"
        )
    )


def previous_write(app, owner, source, name, args):
    """Exact repeated writes in a continuation return their ledger result, not a replay."""
    if not source:
        return None
    key = fingerprint(name, args)
    with app.state.maker() as d:
        for run, index, step in reversed(operations(lineage(d, owner, source))):
            if (
                step.get(
                    "fingerprint", fingerprint(step["name"], step.get("arguments", {}))
                )
                != key
            ):
                continue
            saved = committed(d, owner, run, index)
            if saved or step.get("status") == "completed":
                return {
                    "already_executed": True,
                    "operation_id": f"agent:{run.id}:{index}",
                    "result": saved.result if saved else step.get("result"),
                    "notice": "这是之前已完成操作的记录，本次没有重复执行；需要当前状态时请回读对象。",
                }
            raise ValueError(
                "上次相同操作的结果不确定；先查询对象当前状态，不能直接重复执行"
            )
    return None


async def checkpoint(app, owner, args, client):
    offset = args.get("offset", 0)
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("offset 必须为非负整数")
    with app.state.maker() as d:
        rows = lineage(d, owner, args["id"])
        all_steps = operations(rows)
        result = {
            "task_id": args["id"],
            "total": len(all_steps),
            "has_more": offset + 20 < len(all_steps),
            "next_offset": offset + 20 if offset + 20 < len(all_steps) else None,
            "items": [],
        }
        for run, index, step in all_steps[offset : offset + 20]:
            saved = committed(d, owner, run, index)
            receipt = step.get("receipt")
            values = saved.result if saved else None
            method, path = "POST", ""
            name, arguments = step["name"], step.get("arguments", {})
            if name in {"create_paper", "import_arxiv", "create_note"}:
                path = {
                    "create_paper": "/papers",
                    "import_arxiv": "/import/arxiv",
                    "create_note": "/items",
                }[name]
            elif name in {
                "write_note",
                "append_note",
                "replace_note_text",
                "update_paper",
            }:
                method, path = (
                    "PUT",
                    ("/items/" if name != "update_paper" else "/papers/")
                    + arguments.get("id", ""),
                )
            elif name == "start_translation":
                path = "/papers/" + arguments.get("id", "") + "/translations"
            elif name == "cancel_translation":
                path = "/translations/" + arguments.get("id", "") + "/cancel"
            elif name == "workspace_write":
                method, path = (
                    arguments.get("method", "POST"),
                    arguments.get("path", ""),
                )
            if receipt:
                entity, entity_id = receipt.get("entity_type"), receipt.get("entity_id")
                if entity in {"papers", "items"}:
                    method = "DELETE" if receipt.get("state") == "deleted" else "PUT"
                    path = f"/{entity}/{entity_id}"
                    values = {
                        "id": entity_id,
                        "revision": receipt.get("revision_after"),
                    }
                    if values["revision"] is None:
                        values.pop("revision")
            verification = (
                await verify_write(
                    client, method, path, values, None, f"agent:{run.id}:{index}"
                )
                if path and values
                else None
            )
            result["items"].append(
                {
                    "operation_id": f"agent:{run.id}:{index}",
                    "tool": name,
                    "arguments": {
                        k: v[:500] if isinstance(v, str) else v
                        for k, v in arguments.items()
                        if k in {"id", "paper_id", "path", "url", "query", "revision"}
                    },
                    "status": "committed" if saved else step.get("status"),
                    "uncertain": not saved and step.get("status") != "completed",
                    "receipt": verification
                    or (
                        {**receipt, "verification": "unavailable"} if receipt else None
                    ),
                    "summary": json.dumps(
                        saved.result if saved else step.get("result"),
                        ensure_ascii=False,
                    )[:800],
                }
            )
        return result
