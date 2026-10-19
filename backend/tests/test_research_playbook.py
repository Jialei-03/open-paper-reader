from types import SimpleNamespace

import pytest

from backend import research_playbook as pb


@pytest.fixture
def settings(tmp_path):
    return SimpleNamespace(storage=str(tmp_path / "files"))


RULE = {
    "when": "a hypothesis's kill_if is met or nearly met after 3 seeds",
    "do": "drop it and move the budget to the next most informative node",
    "why": "advisor had to kill two such hypotheses late",
}


def test_add_starts_pending(settings):
    book = pb.load(settings)
    out = pb.apply_ops(book, [{"op": "ADD", **RULE}], "p1", "distiller")
    assert out["added"] == 1
    [rule] = book["rules"]
    assert rule["status"] == "pending" and rule["sources"] == ["p1"]
    assert book["version"] == 1 and book["history"][-1]["project"] == "p1"


def test_second_project_activates(settings):
    book = pb.load(settings)
    pb.apply_ops(book, [{"op": "ADD", **RULE}], "p1", "distiller")
    rule_id = book["rules"][0]["id"]
    pb.apply_ops(
        book, [{"op": "VOTE", "id": rule_id, "helpful": True}], "p2", "distiller"
    )
    pb.apply_ops(book, [{"op": "MERGE", "ids": [rule_id], **RULE}], "p2", "distiller")
    active = [r for r in book["rules"] if r["status"] == "active"]
    assert len(active) == 1 and set(active[0]["sources"]) == {"p1", "p2"}


def test_merge_unions_sources(settings):
    book = pb.load(settings)
    pb.apply_ops(book, [{"op": "ADD", **RULE}], "p1", "distiller")
    pb.apply_ops(book, [{"op": "ADD", **RULE, "do": "stop early"}], "p2", "distiller")
    ids = [r["id"] for r in book["rules"]]
    out = pb.apply_ops(book, [{"op": "MERGE", "ids": ids, **RULE}], "p3", "distiller")
    assert out["merged"] == 1
    live = [r for r in book["rules"] if r["status"] != "retired"]
    assert len(live) == 1 and set(live[0]["sources"]) == {"p1", "p2", "p3"}
    assert live[0]["status"] == "active"


def test_harmful_retires(settings):
    book = pb.load(settings)
    pb.apply_ops(book, [{"op": "ADD", **RULE}], "p1", "distiller")
    rule_id = book["rules"][0]["id"]
    pb.apply_ops(
        book,
        [{"op": "VOTE", "id": rule_id, "helpful": False}] * 2,
        "p2",
        "distiller",
    )
    assert book["rules"][0]["status"] == "retired"


def test_vague_rule_rejected(settings):
    book = pb.load(settings)
    out = pb.apply_ops(
        book,
        [
            {"op": "ADD", "when": "", "do": "do good research", "why": ""},
            {"op": "ADD", "when": "x" * 201, "do": "y"},
        ],
        "p1",
        "distiller",
    )
    assert out["rejected"] == 2 and book["rules"] == []


def test_save_and_corrupt_file_falls_back(settings):
    book = pb.load(settings)
    pb.apply_ops(book, [{"op": "ADD", **RULE}], "p1", "distiller")
    pb.save(settings, book)
    assert pb.load(settings)["version"] == 1
    pb.path(settings).write_text("{not json")
    assert pb.load(settings) == {"version": 0, "rules": [], "history": []}


def test_brief_lists_only_active_top12(settings):
    book = pb.load(settings)
    assert pb.for_brief(book) == ""
    for n in range(15):
        pb.apply_ops(
            book, [{"op": "ADD", **RULE, "do": f"action {n}"}], "p1", "distiller"
        )
    for n, rule in enumerate(book["rules"]):
        rule["status"] = "active"
        rule["helpful"] = n
    pb.apply_ops(
        book, [{"op": "ADD", **RULE, "do": "still pending"}], "p1", "distiller"
    )
    text = pb.for_brief(book)
    assert "action 14" in text and "action 3" in text
    assert "action 2" not in text and "still pending" not in text
    assert text.count("\n- ") + text.startswith("- ") <= 12


def test_cap_retires_lowest_pending(settings):
    book = pb.load(settings)
    for n in range(pb.MAX_RULES + 3):
        pb.apply_ops(
            book, [{"op": "ADD", **RULE, "do": f"action {n}"}], "p1", "distiller"
        )
    assert sum(r["status"] != "retired" for r in book["rules"]) == pb.MAX_RULES
