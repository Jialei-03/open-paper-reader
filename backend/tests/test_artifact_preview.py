import json

from backend.artifact_preview import complete_arrays, preview


def test_only_complete_top_level_items_and_escaped_strings():
    raw = '{"summary":["a \\"quoted\\" string", "unfinished'
    assert complete_arrays(raw) == {"summary": ['a "quoted" string']}
    assert complete_arrays('{"sections":[{"body":"x", "pages":[1]') == {"sections": []}
    assert complete_arrays('{"summary":["ok"],"sections":[{"body":"no') == {
        "summary": ["ok"],
        "sections": [],
    }
    assert complete_arrays('{"summary":[1') == {"summary": []}
    assert complete_arrays('{"summary":["x"],"summary":["y"]}') == {}


def test_translation_id_reconstruction_and_missing_ids():
    units = [
        {"id": 0, "original": "First sentence."},
        {"id": 1, "original": "Second sentence."},
    ]
    row = {"id": 0, "kind": "text", "translation": "第一句。"}
    args = {
        "texts": {"1": "First sentence. Second sentence."},
        "pages": {1},
        "units": units,
    }
    raw = '{"sentences":[' + json.dumps(row) + ',{"id":1'
    assert preview("page_translation", raw, **args) == {
        "paragraphs": [
            {"original": "First sentence.", "kind": "text", "translation": "第一句。"}
        ]
    }
    for bad_id in [True, 1, -1, "0"]:
        assert (
            preview(
                "page_translation",
                json.dumps({"sentences": [{**row, "id": bad_id}]}),
                **args,
            )
            == {}
        )


def test_no_unverified_sources_or_merged_translation():
    args = {"texts": {"1": "First sentence. Second sentence."}, "pages": {1}}
    for source in ["Invented.", "First sentence. Second sentence."]:
        assert (
            preview(
                "page_translation",
                json.dumps(
                    {"paragraphs": [{"original": source, "translation": "译文"}]}
                ),
                **args,
            )
            == {}
        )
    assert (
        preview(
            "outline", '{"entries":[{"title":"Invented", "page":1,"level":1}]}', **args
        )
        == {}
    )
    assert (
        preview(
            "highlights",
            '{"highlights":[{"quote":"First sentence.", "page":2,"category":"method"}]}',
            **args,
        )
        == {}
    )


def test_guide_draft_has_complete_validated_sections_only():
    section = {"title": "研究问题", "body": "研究内容", "pages": [1]}
    raw = json.dumps({"keywords": ["内容"], "sections": [section]})
    assert preview("guide", raw, texts={}, pages={1}) == {
        "keywords": ["内容"],
        "sections": [section],
    }
    assert preview("guide", raw, texts={}, pages={2}) == {"keywords": ["内容"]}


def test_preview_is_bounded_and_does_not_extract_nested_arrays():
    assert complete_arrays('not json {"summary":["secret"]}') == {}
    assert complete_arrays('{"nested":{"summary":["secret"]}}') == {}
    assert complete_arrays('{"summary":[' + '"' + ("x" * 140000)) == {}


def test_store_resets_draft_and_checks_run_ownership():
    from types import SimpleNamespace

    from backend.artifact_preview import store_preview

    row = SimpleNamespace(
        run_id="run", owner="owner", kind="guide", evidence_pages=[1], evidence_text={}
    )
    db = SimpleNamespace(get=lambda model, identifier: row)
    run = SimpleNamespace(
        id="run",
        owner="owner",
        status="running",
        runtime={"reading_artifact_id": "artifact"},
    )
    assert store_preview(db, run, '{"summary":["A complete sentence.",')
    assert run.runtime["artifact_preview"] == {"summary": ["A complete sentence."]}
    store_preview(db, run, "")
    assert "artifact_preview" not in run.runtime
    row.run_id = "replacement"
    store_preview(db, run, '{"summary":["A complete sentence.",')
    assert "artifact_preview" not in run.runtime
    row.run_id = "run"
    row.owner = "other-owner"
    store_preview(db, run, '{"summary":["A complete sentence.",')
    assert "artifact_preview" not in run.runtime
