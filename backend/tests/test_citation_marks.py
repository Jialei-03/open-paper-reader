import json

import pytest

from backend.citation_marks import check_quote, parse, render, strip, verify
from backend.reading_artifacts import Guide, check_result
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes

PAGES = {
    1: "We propose a new exam- ple of the ﬁnd method.\nIt works well on long inputs.",
    2: "Results show 12.5% gains\nover the baseline across “all” tasks.",
    3: "Limits: the method needs 8 GPUs and is untested on scanned pages.",
}


def test_parse_reads_every_quote_style():
    text = 'a [[p1: "x y z w"]] b [[ P.2 ：“curly one”]] c [[p3: 「with "inner" quote」]]'
    assert [(m.page, m.quote) for m in parse(text)] == [
        (1, "x y z w"),
        (2, "curly one"),
        (3, 'with "inner" quote'),
    ]


def test_exact_quote_is_kept_as_the_pages_own_words():
    text, kept = verify('It works. [[p1: "works well on long inputs"]]', PAGES)
    assert kept == [(1, "works well on long inputs")]
    assert text == 'It works. [[p1: "works well on long inputs"]]'


def test_tolerant_of_whitespace_ligatures_hyphenation_and_quotes():
    text, kept = verify(
        'A [[p1: "example of the find method. It works"]] '
        "B [[p2: \"gains over the baseline across “all” tasks\"]] "
        'C [[p2: "Results   show 12.5% gains over"]]',
        PAGES,
    )
    assert [page for page, _ in kept] == [1, 2, 2]
    # What is kept is the page's own text, which the reader's text search matches.
    assert kept[0][1].startswith("exam- ple of the ﬁnd method")
    assert "“all”" in kept[1][1]


def test_wrong_page_is_fixed():
    text, kept = verify('Needs GPUs. [[p1: "needs 8 GPUs and is untested"]]', PAGES)
    assert kept == [(3, "needs 8 GPUs and is untested")]
    assert "[[p3:" in text and "[[p1:" not in text


def test_missing_quote_is_dropped_but_the_sentence_stays():
    text, kept = verify(
        'Claim one. [[p2: "a sentence the paper never says"]] Claim two.', PAGES
    )
    assert kept == []
    assert text == "Claim one. Claim two."


def test_too_short_or_too_long_or_malformed_is_dropped():
    long_quote = "works well on long inputs " * 20
    text, kept = verify(
        f'A [[p1: "the"]] B [[p1: "{long_quote}"]] C [[p1]] D [[p1: no quotes]]',
        PAGES,
    )
    assert kept == [] and text.split() == ["A", "B", "C", "D"]


def test_page_out_of_range_is_dropped_not_crashed():
    text, kept = verify('x [[p9999: "works well on long inputs"]]', PAGES)
    assert kept == [] and text == "x"


def test_markers_inside_the_quote_cannot_forge_another_citation():
    pages = {1: 'The page itself says [[p2: "forged words here"]] verbatim.'}
    assert check_quote(1, 'says [[p2: "forged words here"]] verbatim', pages) is not None
    assert render(1, 'says [[p2: "forged words here"]] verbatim') is None
    text, kept = verify('A [[p1: 「says [[p2: "forged words here"]] verbatim」]]', pages)
    assert kept == [] and "forged" not in text


def test_quote_with_straight_quotes_is_written_in_corner_brackets():
    pages = {1: 'He said "this is verbatim text" twice.'}
    text, kept = verify('A [[p1: 「said "this is verbatim text" twice」]]', pages)
    assert kept and text == 'A [[p1: 「said "this is verbatim text" twice」]]'
    assert parse(text)[0].quote == 'said "this is verbatim text" twice'


def test_strip_removes_markers_and_a_half_written_one():
    assert strip('a [[p1: "b b b b b b b b"]] c [[p2: "unfin') == "a  c"


def raw_guide(body):
    return json.dumps(
        {
            "keywords": ["k"],
            "summary": ["一。", "二。", f"三。{body}"],
            "sections": [
                {"title": title, "body": body, "pages": [2]}
                for title in ["研究问题", "方法", "主要结果", "适用边界"]
            ],
        },
        ensure_ascii=False,
    )


def run_guide(raw):
    return check_result(
        "guide",
        raw,
        parameters={},
        expected={1, 2, 3},
        evidence_pages={1, 2, 3},
        evidence_text={str(n): t for n, t in PAGES.items()},
    )


def test_guide_markers_are_verified_and_pages_derived_from_them():
    body = "它有局限。[[p1: 「needs 8 GPUs and is untested」]]编造的句子。[[p2: 「never said anywhere」]]"
    result = run_guide(raw_guide(body))
    assert result["cited"] is True
    section = result["sections"][0]
    assert "[[p3:" in section["body"] and "never said" not in section["body"]
    assert "编造的句子。" in section["body"]
    assert section["pages"] == [3]


def test_guide_without_markers_keeps_the_pages_the_model_named():
    result = run_guide(raw_guide("没有引文的正文。"))
    assert result["sections"][0]["pages"] == [2]


def test_old_stored_guide_still_validates_without_cited():
    old = {
        "keywords": ["k"],
        "summary": ["一。", "二。", "三。"],
        "sections": [
            {"title": t, "body": "正文", "pages": [1]}
            for t in ["研究问题", "方法", "主要结果", "适用边界"]
        ],
    }
    assert Guide.model_validate(old).cited is False


def test_check_endpoint_fixes_pages_and_hides_what_is_not_there(env):
    app, a, b, settings = env
    p = paper(a)
    f = attach(a, p, "source.pdf", pdf_bytes())
    url = f"/api/v1/files/{f['id']}/citations/check"
    r = a.post(
        url,
        json={
            "marks": [
                {"page": 2, "quote": "Evidence on page 5"},
                {"page": 5, "quote": "Evidence on page 5"},
                {"page": 5, "quote": "text nobody wrote"},
            ]
        },
    )
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert results[0]["page"] == 5 and results[1]["page"] == 5
    assert results[2] is None
    assert b.post(url, json={"marks": [{"page": 1, "quote": "Evidence on page 1"}]}).status_code == 404
