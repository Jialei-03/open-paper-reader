"""The research playbook: judgment rules learned from finished projects.

After a project ends, a distiller turns what happened (the advisor's calls,
the kill decisions, the drift it judged) into short conditional rules: "when
X, do Y, because Z". A rule seen in one project stays pending; a second
project, or a person, makes it active, and only active rules reach the agent.
Rules found harmful are retired, and the book never grows past its cap. The
process improves across projects without touching the model itself.
"""

import json
import os
import tempfile
import uuid
from pathlib import Path

from .models import now

MAX_RULES = 40
BRIEF_RULES = 12
LIMITS = {"when": 200, "do": 300, "why": 300}


def path(settings):
    return Path(settings.storage).parent / "research" / "playbook.json"


def empty():
    return {"version": 0, "rules": [], "history": []}


def load(settings):
    try:
        book = json.loads(path(settings).read_text())
    except (OSError, ValueError):
        return empty()
    if not isinstance(book, dict) or not isinstance(book.get("rules"), list):
        return empty()
    book.setdefault("version", 0)
    book.setdefault("history", [])
    return book


def save(settings, book):
    target = path(settings)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=target.parent)
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(book, out, ensure_ascii=False, indent=1)
        os.replace(temp, target)
    finally:
        Path(temp).unlink(missing_ok=True)


def _text(op, field):
    value = str(op.get(field) or "").strip()
    return value if len(value) <= LIMITS[field] else None


def _valid(op):
    when, do, why = _text(op, "when"), _text(op, "do"), _text(op, "why")
    if not when or not do or why is None:
        return None
    return {"when": when, "do": do, "why": why}


def _rule(book, rule_id):
    return next((r for r in book["rules"] if r["id"] == rule_id), None)


def _settle(rule):
    """Admission and retirement, from the rule's sources and votes."""
    if rule["status"] == "retired":
        return
    if rule["harmful"] >= rule["helpful"] + 2:
        rule["status"] = "retired"
    elif rule["status"] == "pending" and len(set(rule["sources"])) >= 2:
        rule["status"] = "active"


def _score(rule):
    return rule["helpful"] - rule["harmful"]


def apply_ops(book, ops, project_id, actor):
    """Carries out a distiller's operations; counts of what happened to them."""
    out = {
        "added": 0,
        "edited": 0,
        "merged": 0,
        "deleted": 0,
        "voted": 0,
        "rejected": 0,
    }
    for op in ops:
        kind = op.get("op")
        if kind == "ADD":
            fields = _valid(op)
            if not fields:
                out["rejected"] += 1
                continue
            book["rules"].append(
                {
                    "id": uuid.uuid4().hex[:12],
                    **fields,
                    "sources": [project_id],
                    "helpful": 0,
                    "harmful": 0,
                    "status": "pending",
                    "created_at": now(),
                }
            )
            out["added"] += 1
        elif kind == "EDIT":
            rule = _rule(book, op.get("id"))
            if rule is None or rule["status"] == "retired":
                out["rejected"] += 1
                continue
            merged = {
                **{k: rule[k] for k in LIMITS},
                **{k: op[k] for k in LIMITS if k in op},
            }
            fields = _valid(merged)
            if not fields:
                out["rejected"] += 1
                continue
            rule.update(fields)
            out["edited"] += 1
        elif kind == "MERGE":
            rules = [_rule(book, i) for i in op.get("ids", [])]
            fields = _valid(op)
            if not fields or not rules or any(r is None for r in rules):
                out["rejected"] += 1
                continue
            sources = sorted({s for r in rules for s in r["sources"]} | {project_id})
            active = any(r["status"] == "active" for r in rules)
            for r in rules:
                r["status"] = "retired"
            rule = {
                "id": uuid.uuid4().hex[:12],
                **fields,
                "sources": sources,
                "helpful": sum(r["helpful"] for r in rules),
                "harmful": sum(r["harmful"] for r in rules),
                "status": "active" if active else "pending",
                "created_at": now(),
            }
            _settle(rule)
            book["rules"].append(rule)
            out["merged"] += 1
        elif kind == "DELETE":
            rule = _rule(book, op.get("id"))
            if rule is None:
                out["rejected"] += 1
                continue
            rule["status"] = "retired"
            out["deleted"] += 1
        elif kind == "VOTE":
            rule = _rule(book, op.get("id"))
            if rule is None:
                out["rejected"] += 1
                continue
            rule["helpful" if op.get("helpful") else "harmful"] += 1
            _settle(rule)
            out["voted"] += 1
        else:
            out["rejected"] += 1
    for rule in book["rules"]:
        _settle(rule)
    live = [r for r in book["rules"] if r["status"] != "retired"]
    if len(live) > MAX_RULES:
        pending = sorted((r for r in live if r["status"] == "pending"), key=_score)
        for rule in pending[: len(live) - MAX_RULES]:
            rule["status"] = "retired"
    book["version"] += 1
    book["history"].append(
        {
            "version": book["version"],
            "project": project_id,
            "actor": actor,
            "at": now(),
            **out,
        }
    )
    return out


def active(book, limit=BRIEF_RULES):
    rules = [r for r in book["rules"] if r["status"] == "active"]
    return sorted(rules, key=_score, reverse=True)[:limit]


def for_brief(book, limit=BRIEF_RULES):
    """The active rules, best first, as the agent reads them; empty when there are none."""
    return "\n".join(
        f"- [{r['id']}] 在「{r['when']}」时：{r['do']}（{r['why']}）"
        for r in active(book, limit)
    )
