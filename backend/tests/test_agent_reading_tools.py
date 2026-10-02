"""Tools that let the agent find its way around a paper the way a reader does."""

import asyncio

import pytest

from backend import agent_limits
from backend.agent_tools import TOOL_MAP, execute
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes
from backend.tests.test_direct_runs import readable_pdf
from backend.tests.test_reading_artifacts import text_pdf


def call(app, owner, name, args):
    return asyncio.run(execute(app, owner, "session", name, args, "key", False))


def setup(env, raw=None, name="paper.pdf"):
    app, a, b, settings = env
    owner, _model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, name, raw or pdf_bytes())
    return app, a, b, owner, f


def test_the_new_tools_are_read_only_and_described_like_the_others():
    for name in ("search_file", "read_region", "list_figures"):
        assert TOOL_MAP[name]["write"] is False
        assert TOOL_MAP[name]["parameters"]["required"]
    assert (
        TOOL_MAP["search_file"]["parameters"]["properties"]["query"]["maxLength"] <= 200
    )


def test_search_finds_the_pages_a_phrase_is_on(env):
    app, _a, _b, owner, f = setup(env)
    found = call(
        app, owner, "search_file", {"id": f["id"], "query": "evidence  on\npage 7"}
    )
    assert found["total_matches"] == 1
    assert found["matches"][0]["page"] == 7
    assert "Evidence on page 7" in found["matches"][0]["snippet"]
    assert found["pages_searched"] == 12
    assert found["truncated"] is False


def test_search_reports_how_much_it_left_out(env):
    app, _a, _b, owner, f = setup(env)
    found = call(
        app, owner, "search_file", {"id": f["id"], "query": "Evidence", "limit": 5}
    )
    assert found["total_matches"] == 12
    assert [m["page"] for m in found["matches"]] == [1, 2, 3, 4, 5]
    assert found["truncated"] is True
    nothing = call(app, owner, "search_file", {"id": f["id"], "query": "no such words"})
    assert nothing["total_matches"] == 0 and nothing["matches"] == []


def test_search_says_when_pages_have_no_text_to_search(env):
    app, _a, _b, owner, f = setup(env, pdf_bytes(text=False), "scan.pdf")
    found = call(app, owner, "search_file", {"id": f["id"], "query": "anything"})
    assert found["total_matches"] == 0
    assert found["pages_without_text"] == 12
    assert "扫描" in found["notice"]


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("search_file", {"query": "Evidence"}),
        ("read_region", {"page": 1, "rect": [0, 0, 1, 1]}),
        ("list_figures", {}),
    ],
)
def test_reading_tools_are_only_for_the_readers_own_files(env, name, args):
    app, _a, b, _owner, f = setup(env)
    other = b.get("/api/v1/auth/me").json()["user"]["id"]
    with pytest.raises(ValueError, match="404"):
        call(app, other, name, {"id": f["id"], **args})


@pytest.mark.parametrize(
    "args",
    [
        {"query": " "},
        {"query": "x" * 201},
        {"query": 12},
        {"query": "Evidence", "limit": True},
        {"query": "Evidence", "limit": 1.5},
        {"query": "Evidence", "limit": 21},
    ],
)
def test_search_rejects_invalid_parameters(env, args):
    app, _a, _b, owner, f = setup(env)
    with pytest.raises(ValueError):
        call(app, owner, "search_file", {"id": f["id"], **args})


def test_unicode_search_keeps_the_original_match_in_the_snippet(env, monkeypatch):
    from backend import agent_reading

    app, _a, _b, owner, f = setup(env)
    text = "ß" * 150 + " Target Straße " + "z" * 100
    monkeypatch.setattr(agent_reading, "page_texts", lambda *_: [text])
    found = call(app, owner, "search_file", {"id": f["id"], "query": "TARGET STRASSE"})
    assert found["total_matches"] == 1
    assert "Target Straße" in found["matches"][0]["snippet"]


def test_search_cache_is_scoped_to_the_storage_directory(tmp_path):
    from types import SimpleNamespace

    from backend.agent_reading import page_texts

    file = SimpleNamespace(id="same-file-id")
    for name, phrase in [("first", "First paper"), ("second", "Other paper")]:
        storage = tmp_path / name
        storage.mkdir()
        path = storage / file.id
        path.write_bytes(text_pdf([[phrase]]))
        # Equal timestamps and IDs must not mix two isolated workspaces.
        import os

        os.utime(path, ns=(1_000_000_000, 1_000_000_000))
        app = SimpleNamespace(
            state=SimpleNamespace(settings=SimpleNamespace(storage=storage))
        )
        assert page_texts(app, file) == [phrase]


def test_read_region_returns_only_the_text_inside_the_box(env):
    app, _a, _b, owner, f = setup(env, readable_pdf(), "readable.pdf")
    inside = call(
        app,
        owner,
        "read_region",
        {"id": f["id"], "page": 2, "rect": [0.03, 0.09, 0.5, 0.06]},
    )
    assert inside["text"] == "Evidence on page 2"
    outside = call(
        app,
        owner,
        "read_region",
        {"id": f["id"], "page": 2, "rect": [0.03, 0.5, 0.5, 0.1]},
    )
    assert outside["text"] == ""
    assert "view_image" in outside["notice"]


def test_read_region_refuses_a_box_that_is_not_on_the_page(env):
    app, _a, _b, owner, f = setup(env, readable_pdf(), "readable.pdf")
    with pytest.raises(ValueError, match="选区"):
        call(
            app,
            owner,
            "read_region",
            {"id": f["id"], "page": 1, "rect": [0.9, 0.9, 0.5, 0.5]},
        )

    with pytest.raises(ValueError, match="选区"):
        call(app, owner, "read_region", {"id": f["id"], "page": 1, "rect": None})


def test_truncated_pages_do_not_count_as_whole_page_evidence(env):
    from backend.models import ReadingArtifact
    from backend.reading_artifacts import record_reading_evidence
    from backend.tests.test_acceptance import write

    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "source.pdf", pdf_bytes())
    artifact = write(
        a,
        f"/papers/{p['id']}/reading-artifacts",
        {"file_id": f["id"], "model_config_id": model, "kind": "outline"},
    ).json()
    record_reading_evidence(
        app,
        artifact["run_id"],
        "read_file",
        {
            "file_id": f["id"],
            "pages": [
                {"page": 1, "text": "Only part of page one", "truncated": True},
                {"page": 2, "text": "All of page two"},
            ],
        },
    )
    with app.state.maker() as d:
        stored = d.get(ReadingArtifact, artifact["id"])
        assert stored.evidence_pages == [2]
        assert stored.evidence_text == {"2": "All of page two"}


def test_list_figures_gives_captions_with_their_pages(env):
    lines = [
        ["Introduction text about memory."],
        ["Figure 1: Overview of the memory model.", "Table 2: Results on LoCoMo."],
    ]
    app, _a, _b, owner, f = setup(env, text_pdf(lines), "figures.pdf")
    found = call(app, owner, "list_figures", {"id": f["id"]})
    assert [(i["page"], i["kind"]) for i in found["items"]] == [
        (2, "figure"),
        (2, "table"),
    ]
    assert found["items"][0]["quote"].startswith("Figure 1")
    assert found["total_pages"] == 2


def test_a_page_is_cut_to_its_share_of_the_result_and_says_so(env, monkeypatch):
    long_line = "word " * 900
    app, _a, _b, owner, f = setup(env, text_pdf([[long_line]] * 5), "long.pdf")
    monkeypatch.setattr(agent_limits, "TOOL_RESULT_CHARS", 20000)
    result = call(app, owner, "read_file", {"id": f["id"], "page": 1, "pages": 5})
    assert len(result["pages"]) == 5
    assert all(len(p["text"]) <= 20000 // 5 for p in result["pages"])
    assert all(p.get("truncated") is True for p in result["pages"])
    short = call(app, owner, "read_file", {"id": f["id"], "page": 1, "pages": 1})
    assert len(short["pages"][0]["text"]) > 2000


def test_json_escaping_does_not_push_later_pages_out_of_the_tool_result(
    env, monkeypatch
):
    import json
    from types import SimpleNamespace

    import pypdf

    app, _a, _b, owner, f = setup(env)
    monkeypatch.setattr(agent_limits, "TOOL_RESULT_CHARS", 20000)
    monkeypatch.setattr(
        pypdf,
        "PdfReader",
        lambda *_args, **_kwargs: SimpleNamespace(
            is_encrypted=False,
            pages=[SimpleNamespace(extract_text=lambda: '\\"\n' * 3000)] * 5,
        ),
    )
    result = call(app, owner, "read_file", {"id": f["id"], "pages": 5})
    assert [p["page"] for p in result["pages"]] == [1, 2, 3, 4, 5]
    assert len(json.dumps(result, ensure_ascii=False)) <= agent_limits.TOOL_RESULT_CHARS
    assert all(p["truncated"] for p in result["pages"])


def test_a_boxed_region_reaches_the_agent_with_the_text_under_it(env, monkeypatch):
    import json

    from backend.tests.test_acceptance import write
    from backend.tests.test_reading_artifacts import run_fixture_model

    app, a, _b, settings = env
    _owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "readable.pdf", readable_pdf())
    session = write(a, "/agent/sessions", {}).json()["id"]
    context = {
        "paper_id": p["id"],
        "file_id": f["id"],
        "page": 3,
        "source": "region",
        "action": "explain",
        "rect": [0.03, 0.09, 0.5, 0.06],
    }
    run = write(
        a,
        f"/agent/sessions/{session}/runs",
        {"prompt": "解释这个选区", "model_config_id": model, "reader_context": context},
    ).json()
    row = {"run_id": run["id"], "file_id": f["id"]}
    # A model that cannot see still knows what is in the box, and the run does
    # not depend on it choosing to call a tool to find out.
    calls = run_fixture_model(
        app, settings, row, "这是第 3 页的一行文字。", monkeypatch, batches=[]
    )
    assert "Evidence on page 3" in json.dumps(calls[0]["messages"], ensure_ascii=False)
