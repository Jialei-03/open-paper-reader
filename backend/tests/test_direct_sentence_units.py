"""Compact translations must retain exact evidence without generating it again."""

import json

import pytest

from backend.direct_runs import page_units, translate_page
from backend.reading_artifacts import PageTranslation, verify_translation
from backend.sentence_alignment import require_sentence_pairs


def compact(rows):
    return json.dumps({"sentences": rows}, ensure_ascii=False)


def row(identifier, translation="译文", kind="text"):
    return {"id": identifier, "kind": kind, "translation": translation}


def test_exact_sources_reconstructed_in_order_in_one_call():
    source = "Dr. Smith uses 1.25 units.\nOur model\nworks.\n\n方法有效。结果稳定！"
    calls = []

    def ask(system, content):
        calls.append((system, content))
        units = json.loads(content.split("text:\n", 1)[1])
        return compact([row(u["id"], f"翻译{u['id']}") for u in reversed(units)])

    value = PageTranslation.model_validate_json(translate_page(ask, source, 1, "ja"))
    assert len(calls) == 1
    assert "Japanese" in calls[0][0]
    assert [p.original for p in value.paragraphs] == [
        "Dr. Smith uses 1.25 units.",
        "Our model\nworks.",
        "方法有效。",
        "结果稳定！",
    ]
    assert [p.translation for p in value.paragraphs] == [f"翻译{i}" for i in range(4)]
    verify_translation(value, source)
    require_sentence_pairs(value)


@pytest.mark.parametrize(
    "rows",
    [
        [row(0)],
        [row(0), row(0)],
        [row(True), row(0)],
        [row("0"), row(1)],
        [row(0), row(2)],
        [row(0), row(1, " ")],
        [row(0), row(1, kind="unknown")],
        [row(0), row(1, kind="page_number")],
        [row(0), {**row(1), "original": "invented"}],
        [row(0), None],
    ],
)
def test_invalid_units_cannot_publish_partial_or_misaligned_translation(rows):
    calls = []

    def ask(*args):
        calls.append(args)
        return compact(rows)

    with pytest.raises(ValueError):
        translate_page(ask, "First sentence. Second sentence.", 2, "zh")
    assert len(calls) == 2


def test_compact_bad_ids_can_be_corrected_once():
    answers = iter([compact([row(0)]), compact([row(1, "第二句"), row(0, "第一句")])])
    result = json.loads(
        translate_page(lambda *_: next(answers), "First. Second.", 1, "zh")
    )
    assert [p["translation"] for p in result["paragraphs"]] == ["第一句", "第二句"]


def test_layout_aware_original_response_still_supported_and_verified():
    source = "Introduction\nFirst sentence. Second sentence."
    replies = iter(
        [
            json.dumps(
                {
                    "paragraphs": [
                        {
                            "kind": "heading",
                            "original": "Introduction",
                            "translation": "引言",
                        },
                        {
                            "kind": "text",
                            "original": "First sentence. Second sentence.",
                            "translation": "旧译文",
                        },
                    ]
                }
            ),
            compact(
                [{"id": 1, "translation": "第二句"}, {"id": 0, "translation": "第一句"}]
            ),
        ]
    )
    result = PageTranslation.model_validate_json(
        translate_page(lambda *_: next(replies), source, 1, "zh")
    )
    assert [p.kind for p in result.paragraphs] == ["heading", "text", "text"]
    verify_translation(result, source)
    require_sentence_pairs(result)


def test_oversized_segmentation_uses_original_layout_path():
    assert page_units("Sentence. " * 301) is None
    assert page_units("x" * 18001) is None
