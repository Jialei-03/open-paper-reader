import json
import re

import pytest

from backend.tests import test_acceptance
from backend.tests.test_translation_memory_batches import answer, decode, memory
from backend.translation_memory import protect_layout_markers, restore_layout_markers

env = test_acceptance.env


def test_orphan_style_spans_are_opaque_only_on_wire_and_reused(env, monkeypatch):
    m = memory(env)
    originals = [
        "This sentence <b16>ends inside a style span.",
        "</b1>A new sentence <b7>opens another span with {v2}.",
    ]
    calls = []

    def complete(config, system, content, **kwargs):
        units = decode(content)
        calls.append(units)
        assert all(
            "<b" not in u["original"] and "</b" not in u["original"] for u in units
        )
        return answer(units)

    monkeypatch.setattr("backend.translation_memory.complete", complete)
    result = m.translate(originals)
    assert [row["original"] for row in result] == originals
    assert [row["translation"] for row in result] == [
        "已翻译：" + text for text in originals
    ]
    assert m.translate(originals) == result
    assert len(calls) == 1


@pytest.mark.parametrize("damage", ["drop", "duplicate", "invent", "raw_tag"])
def test_opaque_marker_damage_cannot_bypass_original_guards(env, monkeypatch, damage):
    m = memory(env)
    original = "English text <b16>with an open style span."

    def complete(config, system, content, **kwargs):
        units = decode(content)
        row = json.loads(answer(units))["sentences"][0]
        token = re.search(
            r"__PW_LAYOUT_KEEP_[a-f0-9]{12}_[0-9]+__", row["translation"]
        )[0]
        if damage == "drop":
            row["translation"] = row["translation"].replace(token, "")
        elif damage == "duplicate":
            row["translation"] += token
        elif damage == "invent":
            row["translation"] += "__PW_LAYOUT_KEEP_aaaaaaaaaaaa_9__"
        else:
            row["translation"] += "</b16>"
        return json.dumps({"sentences": [row]})

    monkeypatch.setattr("backend.translation_memory.complete", complete)
    with pytest.raises(ValueError, match="标记"):
        m.translate([original])
    assert m.lookup([original]) is None


def test_existing_literal_sentinel_is_preserved_without_collision():
    original = "Literal __PW_LAYOUT_KEEP_aaaaaaaaaaaa_0__ with <b1>{v2}</b1>."
    encoded, mapping = protect_layout_markers(original)
    assert "__PW_LAYOUT_KEEP_aaaaaaaaaaaa_0__" in encoded
    assert len(mapping) == 3
    assert restore_layout_markers(encoded, encoded, mapping) == original
