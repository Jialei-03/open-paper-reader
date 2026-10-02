"""Translating is one model call over text the server already holds, not an agent loop."""

import json

import httpx
import pytest
from sqlalchemy import select

from backend import translation_settings
from backend.agent_worker import process
from backend.models import AgentRun, ModelUsage
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_reading_artifacts import setup


def paragraph(original, translation, kind="text"):
    return {"kind": kind, "original": original, "translation": translation}


def answer(*paragraphs):
    return json.dumps({"paragraphs": list(paragraphs)}, ensure_ascii=False)


def provider(monkeypatch, replies, *, on_request=None):
    """Answer provider requests in turn; return the request bodies that were sent."""
    sent = []
    real = httpx.AsyncClient

    def reply(request):
        sent.append(json.loads(request.content))
        if on_request:
            on_request()
        value = replies[min(len(sent) - 1, len(replies) - 1)]
        if isinstance(value, int):
            return httpx.Response(value, json={})
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": value}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    monkeypatch.setattr(
        translation_settings.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(reply)),
    )
    return sent


def work(app, run_id):
    with app.state.maker() as d:
        d.get(AgentRun, run_id).status = "running"
        d.commit()
    process(app, run_id)


def finished(a, row):
    return a.get(f"/api/v1/reading-artifacts/{row['id']}").json()


def page_translation(env, page=2):
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, "page_translation")
    row = a.post(endpoint, json={**body, "page": page}).json()
    assert row["status"] == "queued", row
    return app, a, owner, p, f, row


def selection_run(env, action="translate", source="selection", page=1, **extra):
    app, a, b, settings, owner, p, f, endpoint, body = setup(env)
    session = write(a, "/agent/sessions", {}).json()["id"]
    context = {
        "paper_id": p["id"],
        "file_id": f["id"],
        "page": page,
        "source": source,
        "action": action,
        **extra,
    }
    if source == "selection":
        context["quote"] = f"Evidence on page {page}"
    response = write(
        a,
        f"/agent/sessions/{session}/runs",
        {
            "prompt": "请将所选文字翻译成中文",
            "model_config_id": body["model_config_id"],
            "reader_context": context,
        },
    )
    assert response.status_code == 200, response.text
    return app, a, session, response.json()


def test_a_page_is_translated_in_one_call_over_that_page_only(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env, page=2)
    sent = provider(
        monkeypatch, [answer(paragraph("Evidence on page 2", "第 2 页的证据"))]
    )
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "completed", done
    assert done["result"]["paragraphs"][0]["translation"] == "第 2 页的证据"
    assert done["evidence_pages"] == [2]
    assert len(sent) == 1
    text = json.dumps(sent[0]["messages"], ensure_ascii=False)
    assert "Evidence on page 2" in text
    assert "Evidence on page 3" not in text
    # No tool loop, and the fastest thinking the model offers.
    assert "tools" not in sent[0]
    assert sent[0]["thinking"] == {"type": "disabled"}
    with app.state.maker() as d:
        assert d.get(AgentRun, row["run_id"]).status == "completed"


def test_the_language_asked_for_reaches_the_model(env, monkeypatch):
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, "page_translation")
    row = a.post(endpoint, json={**body, "page": 1, "language": "ja"}).json()
    sent = provider(
        monkeypatch, [answer(paragraph("Evidence on page 1", "ページ1の証拠"))]
    )
    work(app, row["run_id"])
    assert finished(a, row)["status"] == "completed"
    assert "Japanese" in json.dumps(sent[0]["messages"])


def test_an_answer_that_fails_verification_is_corrected_once(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(
        monkeypatch,
        [
            # The model paraphrased the page instead of copying it.
            answer(paragraph("There is evidence here", "这里有证据")),
            answer(paragraph("Evidence on page 2", "第 2 页的证据")),
        ],
    )
    work(app, row["run_id"])
    assert finished(a, row)["status"] == "completed"
    assert len(sent) == 2
    retry = json.dumps(sent[1]["messages"], ensure_ascii=False)
    assert "译文中的原句与指定页面不一致" in retry
    assert "Evidence on page 2" in retry


def test_an_answer_that_cannot_be_verified_fails_after_the_second_try(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(
        monkeypatch, [answer(paragraph("There is evidence here", "这里有证据"))]
    )
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "不一致" in done["error"]
    assert done["result"] == {}
    assert len(sent) == 2
    with app.state.maker() as d:
        assert d.get(AgentRun, row["run_id"]).status == "failed"


def test_a_page_without_text_is_not_sent_to_the_model(env, monkeypatch):
    from backend.tests.test_acceptance import attach, paper
    from backend.tests.test_agents import configure, pdf_bytes

    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "scan.pdf", pdf_bytes(text=False))
    row = write(
        a,
        f"/papers/{p['id']}/reading-artifacts",
        {"file_id": f["id"], "model_config_id": model, "kind": "page_translation"},
    ).json()
    sent = provider(monkeypatch, [answer(paragraph("x", "y"))])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "扫描页" in done["error"]
    assert sent == []


def test_a_provider_error_fails_the_page_with_its_reason(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)
    provider(monkeypatch, [500])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "500" in done["error"]


def test_stopping_a_page_keeps_it_stopped(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)

    def press_stop():
        with app.state.maker() as d:
            d.get(AgentRun, row["run_id"]).status = "cancelled"
            d.commit()

    provider(
        monkeypatch,
        [answer(paragraph("Evidence on page 2", "第 2 页的证据"))],
        on_request=press_stop,
    )
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "cancelled"
    assert done["result"] == {}


def test_direct_calls_are_counted_against_the_readers_usage(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)
    provider(monkeypatch, [answer(paragraph("Evidence on page 2", "第 2 页的证据"))])
    work(app, row["run_id"])
    with app.state.maker() as d:
        usage = d.scalars(select(ModelUsage)).all()
    assert [(u.source, u.status, u.total_tokens) for u in usage] == [
        ("translation", "completed", 15)
    ]


def test_a_selection_is_translated_in_one_call_without_tools(env, monkeypatch):
    app, a, session, run = selection_run(env)
    sent = provider(monkeypatch, ["第 1 页的证据"])
    work(app, run["id"])
    done = a.get(f"/api/v1/agent/sessions/{session}/runs").json()[0]
    assert done["status"] == "completed"
    assert done["response"] == "第 1 页的证据"
    assert len(sent) == 1
    assert "tools" not in sent[0]
    text = json.dumps(sent[0]["messages"], ensure_ascii=False)
    assert "Evidence on page 1" in text
    assert "Simplified Chinese" in text


def test_translating_a_page_from_the_menu_reads_it_on_the_server(env, monkeypatch):
    app, a, session, run = selection_run(env, source="page", page=2)
    sent = provider(monkeypatch, ["## 第 2 页\n\n第 2 页的证据"])
    work(app, run["id"])
    done = a.get(f"/api/v1/agent/sessions/{session}/runs").json()[0]
    assert done["status"] == "completed"
    assert done["response"].startswith("## 第 2 页")
    assert len(sent) == 1
    text = json.dumps(sent[0]["messages"], ensure_ascii=False)
    assert "Evidence on page 2" in text and "Evidence on page 1" not in text


@pytest.mark.parametrize(
    "action,source,direct",
    [
        ("translate", "selection", True),
        ("translate", "page", True),
        # A box is read from the page's text and, if the model can see, its picture.
        ("translate", "region", True),
        ("explain", "selection", False),
        ("explain", "page", False),
        ("ask", "selection", False),
    ],
)
def test_only_translating_text_skips_the_agent(env, action, source, direct):
    extra = {"rect": [0.1, 0.1, 0.4, 0.2]} if source == "region" else {}
    app, _a, _session, run = selection_run(env, action=action, source=source, **extra)
    with app.state.maker() as d:
        assert bool(d.get(AgentRun, run["id"]).runtime.get("direct")) is direct


def readable_pdf(text=True):
    """A PDF a real viewer (PDFium) can read: page content must be an indirect stream."""
    import io

    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for n in range(3):
        page = writer.add_blank_page(612, 792)
        if not text:
            continue
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        content = DecodedStreamObject()
        content.set_data(
            f"BT /F1 12 Tf 40 700 Td (Evidence on page {n + 1}) Tj ET".encode()
        )
        page[NameObject("/Contents")] = writer._add_object(content)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def boxed(env, rect=(0.03, 0.09, 0.5, 0.06), *, vision=False, text=True, page=1):
    from backend.tests.test_acceptance import attach, paper
    from backend.translation_settings import write_config

    app, a, _b, settings = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    model = write_config(
        settings,
        owner,
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3",
            "api_key": "test-private-key",
            "protocol": "openai",
            "vision": vision,
        },
        create=True,
    )["active_id"]
    p = paper(a)
    f = attach(a, p, "source.pdf", readable_pdf(text=text))
    session = write(a, "/agent/sessions", {}).json()["id"]
    context = {
        "paper_id": p["id"],
        "file_id": f["id"],
        "page": page,
        "source": "region",
        "action": "translate",
        "rect": list(rect),
    }
    response = write(
        a,
        f"/agent/sessions/{session}/runs",
        {
            "prompt": "请读取所选区域并翻译成中文",
            "model_config_id": model,
            "reader_context": context,
        },
    )
    assert response.status_code == 200, response.text
    return app, a, session, response.json()


def outcome(a, session):
    return a.get(f"/api/v1/agent/sessions/{session}/runs").json()[0]


def test_a_boxed_region_is_translated_from_the_text_under_it(env, monkeypatch):
    app, a, session, run = boxed(env)
    sent = provider(monkeypatch, ["第 1 页的证据"])
    work(app, run["id"])
    done = outcome(a, session)
    assert done["status"] == "completed", done
    assert done["response"] == "第 1 页的证据"
    assert len(sent) == 1
    assert "tools" not in sent[0]
    content = sent[0]["messages"][-1]["content"]
    # A model that cannot see is given the text alone.
    assert isinstance(content, str)
    assert "Evidence on page 1" in content


def test_only_the_text_inside_the_box_is_sent(env, monkeypatch):
    # The box sits on the page's first line; a box lower down holds nothing.
    app, a, session, run = boxed(env, rect=(0.03, 0.5, 0.5, 0.1))
    sent = provider(monkeypatch, ["x"])
    work(app, run["id"])
    done = outcome(a, session)
    assert done["status"] == "failed"
    assert sent == []


def test_a_boxed_picture_goes_to_a_vision_model_with_its_text(env, monkeypatch):
    app, a, session, run = boxed(env, vision=True)
    sent = provider(monkeypatch, ["译文"])
    work(app, run["id"])
    assert outcome(a, session)["status"] == "completed"
    content = sent[0]["messages"][-1]["content"]
    assert isinstance(content, list)
    pictures = [part for part in content if part["type"] == "image_url"]
    assert len(pictures) == 1
    assert pictures[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "Evidence on page 1" in json.dumps(content)


def test_a_box_over_a_scan_is_read_by_a_vision_model(env, monkeypatch):
    app, a, session, run = boxed(env, text=False, vision=True)
    sent = provider(monkeypatch, ["译文"])
    work(app, run["id"])
    assert outcome(a, session)["status"] == "completed"
    content = sent[0]["messages"][-1]["content"]
    assert [part["type"] for part in content].count("image_url") == 1


def test_a_box_over_a_scan_needs_a_model_that_can_see(env, monkeypatch):
    app, a, session, run = boxed(env, text=False)
    sent = provider(monkeypatch, ["x"])
    work(app, run["id"])
    done = outcome(a, session)
    assert done["status"] == "failed"
    assert "图片" in done["error"]
    assert sent == []


def test_a_translated_page_keeps_the_exact_original_and_is_found_again(
    env, monkeypatch
):
    app, a, _owner, p, f, row = page_translation(env, page=2)
    endpoint = f"/api/v1/papers/{p['id']}/reading-artifacts"
    body = {
        "file_id": f["id"],
        "model_config_id": row["model_config_id"],
        "kind": "page_translation",
        "page": 2,
    }
    # The model spaced the original differently from the PDF; what is kept is the
    # PDF's own text, so it can be found on the page again.
    provider(monkeypatch, [answer(paragraph("Evidence  on\npage 2", "第2页证据"))])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "completed", done
    assert done["result"] == {
        "paragraphs": [
            {
                "original": "Evidence on page 2",
                "translation": "第2页证据",
                "kind": "text",
            }
        ]
    }
    assert "evidence_text" not in done
    # The same page is not translated twice; regenerating starts a new run.
    assert a.post(endpoint, json=body).json()["run_id"] == row["run_id"]
    again = a.post(endpoint, json={**body, "regenerate": True}).json()
    assert again["id"] == row["id"] and again["run_id"] != row["run_id"]
    assert again["result"] == {}
    assert (
        a.post(endpoint, json={**body, "regenerate": True}).json()["run_id"]
        == again["run_id"]
    )
    with app.state.maker() as d:
        d.get(AgentRun, again["run_id"]).status = "failed"
        d.commit()
    # Another language or page is another translation.
    english = a.post(endpoint, json={**body, "language": "en"}).json()
    assert english["id"] != row["id"]
    with app.state.maker() as d:
        d.get(AgentRun, english["run_id"]).status = "failed"
        d.commit()
    assert a.post(endpoint, json={**body, "page": 3}).json()["id"] != row["id"]
    assert a.post(endpoint, json={**body, "page": 13}).status_code == 422


def test_a_translation_that_leaves_out_most_of_the_page_fails(env, monkeypatch):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(monkeypatch, [answer(paragraph("Evidence", "证据"))])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "不完整" in done["error"]
    assert len(sent) == 2


def whole_paper(env, kind, monkeypatch, **extra):
    from backend import direct_runs

    monkeypatch.setattr(direct_runs, "DIRECT_PAGES", 60)
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, kind)
    row = a.post(endpoint, json={**body, **extra}).json()
    return app, a, row


def guide_json(**changes):
    from backend.tests.test_reading_artifacts import guide

    return json.dumps({**guide(), **changes}, ensure_ascii=False)


@pytest.mark.parametrize(
    "kind,reply",
    [
        ("guide", None),
        ("quiz", None),
        (
            "outline",
            {
                "entries": [
                    {"title": "Evidence on page 1", "page": 1, "level": 1},
                    {"title": "Evidence on page 12", "page": 12, "level": 2},
                ]
            },
        ),
        (
            "highlights",
            {
                "highlights": [
                    {"page": 2, "quote": "Evidence on page 2", "category": "results"}
                ]
            },
        ),
    ],
)
def test_a_paper_wide_result_is_one_call_over_the_whole_paper(
    env, monkeypatch, kind, reply
):
    from backend.tests.test_reading_artifacts import guide, quiz

    app, a, row = whole_paper(env, kind, monkeypatch)
    with app.state.maker() as d:
        assert d.get(AgentRun, row["run_id"]).runtime["direct"] is True
    value = {"guide": guide(), "quiz": quiz(5)}.get(kind, reply)
    sent = provider(monkeypatch, [json.dumps(value, ensure_ascii=False)])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "completed", done
    assert len(sent) == 1
    assert "tools" not in sent[0]
    text = json.dumps(sent[0]["messages"], ensure_ascii=False)
    # The model is given every page, so nothing depends on it choosing to read.
    for n in range(1, 13):
        assert f"Evidence on page {n}" in text
    assert done["evidence_pages"] == list(range(1, 13))


def test_a_result_that_does_not_check_out_is_corrected_once(env, monkeypatch):
    app, a, row = whole_paper(env, "guide", monkeypatch)
    sent = provider(
        monkeypatch,
        [
            # Two sentences cannot be made into the three that were asked for.
            guide_json(summary=["研究记忆。采用图结构。"]),
            guide_json(),
        ],
    )
    work(app, row["run_id"])
    assert finished(a, row)["status"] == "completed"
    assert len(sent) == 2
    retry = json.dumps(sent[1]["messages"], ensure_ascii=False)
    assert "上一次的回答没有通过检查" in retry
    assert "summary" in retry


def test_a_result_that_is_still_wrong_fails_with_the_reason(env, monkeypatch):
    app, a, row = whole_paper(env, "guide", monkeypatch)
    sent = provider(monkeypatch, [guide_json(summary=["只有一句。"])])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "格式不完整" in done["error"]
    assert len(sent) == 2


def test_a_long_paper_stays_with_the_agent(env, monkeypatch):
    from backend import direct_runs

    monkeypatch.setattr(direct_runs, "DIRECT_PAGES", 5)
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, "guide")
    row = a.post(endpoint, json=body).json()
    with app.state.maker() as d:
        assert not d.get(AgentRun, row["run_id"]).runtime.get("direct")


def test_a_paper_without_readable_text_falls_back_to_the_agent(env, monkeypatch):
    from backend import agent_worker, direct_runs
    from backend.tests.test_acceptance import attach, paper
    from backend.tests.test_agents import configure

    monkeypatch.setattr(direct_runs, "DIRECT_PAGES", 60)
    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "scan.pdf", readable_pdf(text=False))
    row = a.post(
        f"/api/v1/papers/{p['id']}/reading-artifacts",
        json={"file_id": f["id"], "model_config_id": model, "kind": "guide"},
    ).json()
    handed_over = []
    monkeypatch.setattr(
        agent_worker, "_process", lambda *args: handed_over.append(args)
    )
    sent = provider(monkeypatch, ["unused"])
    work(app, row["run_id"])
    # Scanned pages can only be read by looking at them: that is the agent's job.
    assert len(handed_over) == 1
    assert sent == []


@pytest.fixture
def no_wait(monkeypatch):
    from backend import direct_runs

    monkeypatch.setattr(direct_runs, "RETRY_SECONDS", 0)


def test_a_passing_provider_hiccup_is_tried_again(env, monkeypatch, no_wait):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(
        monkeypatch, [503, answer(paragraph("Evidence on page 2", "第 2 页的证据"))]
    )
    work(app, row["run_id"])
    assert finished(a, row)["status"] == "completed"
    assert len(sent) == 2


def test_a_provider_that_keeps_failing_is_given_up_on_after_one_more_try(
    env, monkeypatch, no_wait
):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(monkeypatch, [500])
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "failed"
    assert "500" in done["error"]
    assert len(sent) == 2


def test_a_refusal_that_trying_again_cannot_change_is_not_repeated(
    env, monkeypatch, no_wait
):
    app, a, _owner, _p, _f, row = page_translation(env)
    sent = provider(monkeypatch, [401])
    work(app, row["run_id"])
    assert finished(a, row)["status"] == "failed"
    assert len(sent) == 1


def test_a_page_read_in_a_different_order_than_its_text_layer_still_completes(
    env, monkeypatch
):
    from backend.tests.test_acceptance import attach, paper
    from backend.tests.test_agents import configure
    from backend.tests.test_reading_artifacts import LINES, text_pdf

    app, a, _b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "lines.pdf", text_pdf([LINES]))
    row = a.post(
        f"/api/v1/papers/{p['id']}/reading-artifacts",
        json={
            "file_id": f["id"],
            "model_config_id": model,
            "kind": "page_translation",
            "page": 1,
        },
    ).json()
    # A contents page or a table: read in the order it is laid out.
    provider(
        monkeypatch,
        [
            answer(
                paragraph(LINES[1], "二"),
                paragraph(LINES[2], "三"),
                paragraph(LINES[0], "一"),
            )
        ],
    )
    work(app, row["run_id"])
    done = finished(a, row)
    assert done["status"] == "completed", done
    assert [x["translation"] for x in done["result"]["paragraphs"]] == [
        "二",
        "三",
        "一",
    ]


@pytest.mark.parametrize("interrupted", [False, True])
def test_artifact_stream_never_publishes_unvalidated_json(
    env, monkeypatch, interrupted
):
    app, client, _owner, _paper, _file, row = page_translation(env, page=2)
    payload = answer(paragraph("Evidence on page 2", "第2页的证据"))
    sent = []
    real = httpx.AsyncClient

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            first = {"choices": [{"delta": {"content": payload[:15]}}]}
            yield ("data: " + json.dumps(first) + "\n\n").encode()
            with app.state.maker() as db:
                run = db.get(AgentRun, row["run_id"])
                assert not run.response
            if not interrupted:
                last = {
                    "choices": [
                        {"delta": {"content": payload[15:]}, "finish_reason": "stop"}
                    ]
                }
                yield ("data: " + json.dumps(last) + "\n\n").encode()
            yield b"data: [DONE]\n\n"

    def reply(request):
        sent.append(json.loads(request.content))
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, stream=Stream()
        )

    monkeypatch.setattr(
        translation_settings.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(reply)),
    )
    work(app, row["run_id"])
    result = finished(client, row)
    assert sent[0]["stream"] is True
    assert result["status"] == ("failed" if interrupted else "completed")
    if interrupted:
        assert not result.get("result")
    else:
        assert result["result"]["paragraphs"][0]["translation"] == "第2页的证据"


@pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
def test_complete_stream_sentence_is_preview_until_final_validation(
    env, monkeypatch, terminal
):
    app, client, _owner, _paper, _file, row = page_translation(env, page=2)
    value = paragraph("Evidence on page 2", "第2页的证据")
    chunk = '{"paragraphs":[' + json.dumps(value) + "]"
    real = httpx.AsyncClient

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": chunk}}]})
                + "\n\n"
            ).encode()
            draft = finished(client, row)
            assert draft["status"] == "running"
            assert draft["preview"] == {"paragraphs": [value]}
            assert not draft.get("result")
            with app.state.maker() as db:
                run = db.get(AgentRun, row["run_id"])
                assert not run.response
                if terminal == "cancelled":
                    run.status = "cancelled"
                    db.commit()
            if terminal == "completed":
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "choices": [
                                {"delta": {"content": "}"}, "finish_reason": "stop"}
                            ]
                        }
                    )
                    + "\n\n"
                ).encode()
            yield b"data: [DONE]\n\n"

    monkeypatch.setattr(
        translation_settings.httpx,
        "AsyncClient",
        lambda **kw: real(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, headers={"content-type": "text/event-stream"}, stream=Stream()
                )
            )
        ),
    )
    work(app, row["run_id"])
    result = finished(client, row)
    assert result["status"] == terminal
    assert "preview" not in result
    with app.state.maker() as db:
        assert "artifact_preview" not in db.get(AgentRun, row["run_id"]).runtime
