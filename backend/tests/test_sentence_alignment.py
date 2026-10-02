import json

import pytest

from backend.reading_artifacts import PageTranslation, verify_translation
from backend.sentence_alignment import (
    align_sentences,
    require_sentence_pairs,
    sentences,
)


def test_scientific_boundaries_preserve_abbreviations_numbers_and_quotes():
    text = 'Dr. Smith et al. use Eq. 3 with 1.25 units, e.g. in the U.S. dataset. "It works!" Is it robust? Yes.'
    assert sentences(text) == [
        "Dr. Smith et al. use Eq. 3 with 1.25 units, e.g. in the U.S. dataset.",
        '"It works!"',
        "Is it robust?",
        "Yes.",
    ]
    assert sentences("方法有效。结果稳定！是否泛化？") == [
        "方法有效。",
        "结果稳定！",
        "是否泛化？",
    ]
    assert sentences("Figure 1. Results of the model. More results.") == [
        "Figure 1. Results of the model.",
        "More results.",
    ]


def test_alignment_translates_identified_sources_not_zipped_target_punctuation():
    text = "The baseline fails. Our model works."
    result = PageTranslation.model_validate(
        {"paragraphs": [{"original": text, "translation": "基线失败而本模型有效。"}]}
    )
    calls = []

    def ask(system, content):
        calls.append(json.loads(content))
        # Output order may differ; stable IDs preserve the exact pairing.
        return json.dumps(
            {
                "sentences": [
                    {"id": 1, "translation": "我们的模型有效。"},
                    {"id": 0, "translation": "基线失败。"},
                ]
            }
        )

    result = align_sentences(result, ask, "Simplified Chinese")
    assert [p.original for p in result.paragraphs] == [
        "The baseline fails.",
        "Our model works.",
    ]
    assert [p.translation for p in result.paragraphs] == [
        "基线失败。",
        "我们的模型有效。",
    ]
    verify_translation(result, text)
    require_sentence_pairs(result)
    assert len(calls) == 1


def test_incomplete_alignment_never_succeeds_or_mutates_existing_result():
    result = PageTranslation.model_validate(
        {
            "paragraphs": [
                {
                    "original": "First sentence. Second sentence.",
                    "translation": "旧译文",
                }
            ]
        }
    )
    with pytest.raises(ValueError, match="逐句对齐"):
        align_sentences(
            result,
            lambda *_: '{"sentences":[{"id":0,"translation":"只有第一句"}]}',
            "Chinese",
        )
    assert result.paragraphs[0].translation == "旧译文"
    with pytest.raises(ValueError, match="不能合并"):
        require_sentence_pairs(result)


def test_already_aligned_and_headings_do_not_trigger_more_model_calls():
    result = PageTranslation.model_validate(
        {
            "paragraphs": [
                {
                    "kind": "heading",
                    "original": "1. Introduction",
                    "translation": "1. 引言",
                },
                {"original": "This is one sentence.", "translation": "这是一个句子。"},
            ]
        }
    )

    def unexpected(*_):
        pytest.fail("No repair request needed")

    assert align_sentences(result, unexpected, "Chinese") is result
