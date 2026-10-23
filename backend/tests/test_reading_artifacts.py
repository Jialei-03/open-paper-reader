import io
import json
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import select, text

from backend.agent_worker import process
from backend.cli import backup, restore
from backend.config import Settings
from backend.main import create_app
from backend.models import AgentRun, AgentSession, Base, File, ReadingArtifact
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes
from backend.translation_settings import save_options


@pytest.fixture(autouse=True)
def through_the_agent(monkeypatch):
    """These tests are about the agent's tool loop; whole-paper jobs that the
    server can do in one call have their own tests in test_direct_runs."""
    from backend import direct_runs

    monkeypatch.setattr(direct_runs, "DIRECT_PAGES", 0)


def guide():
    return {
        "keywords": ["记忆", "智能体"],
        "summary": ["研究可扩展记忆。", "采用图结构。", "报告实验提升。"],
        "sections": [
            {"title": title, "body": "据第2页的测试证据分析。", "pages": [2]}
            for title in ["研究问题", "方法", "主要结果", "适用边界"]
        ],
    }


def quiz(count=5):
    return {
        "questions": [
            {
                "question": f"第{i + 1}项研究发现是什么？",
                "options": ["选项一", "选项二", "选项三", "选项四"],
                "answer": 0,
                "explanation": "对应论文第2页。",
                "pages": [2],
            }
            for i in range(count)
        ]
    }


def setup(env, kind="guide"):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "source.pdf", pdf_bytes())
    endpoint = f"/api/v1/papers/{p['id']}/reading-artifacts"
    body = {"file_id": f["id"], "model_config_id": model, "kind": kind}
    return app, a, b, settings, owner, p, f, endpoint, body


def mark_failed(app, run_id):
    with app.state.maker() as d:
        row = d.get(AgentRun, run_id)
        row.status, row.error = "failed", "测试失败"
        d.commit()


def run_fixture_model(
    app, settings, row, result, monkeypatch, *, read_all=True, batches=None
):
    """Real Pi runner, local deterministic protocol server, actual PDF tools."""
    calls = []
    batches = (
        batches
        if batches is not None
        else ([(1, 5), (6, 5), (11, 5)] if read_all else [])
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            calls.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            n = len(calls)
            tool = n <= len(batches)
            delta = (
                {
                    "role": "assistant",
                    "content": "正在读取论文页面。",
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": f"read_{n}",
                            "type": "function",
                            "function": {
                                "name": "read_file",
                                "arguments": json.dumps(
                                    {
                                        "id": row["file_id"],
                                        "page": batches[n - 1][0],
                                        "pages": batches[n - 1][1],
                                    }
                                ),
                            },
                        }
                    ],
                }
                if tool
                else {
                    "role": "assistant",
                    "content": result
                    if isinstance(result, str)
                    else json.dumps(result, ensure_ascii=False),
                }
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for choice in [
                {"delta": delta, "finish_reason": None},
                {"delta": {}, "finish_reason": "tool_calls" if tool else "stop"},
            ]:
                chunk = {
                    "id": "fixture",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "MiniMax-M3",
                    "choices": [{"index": 0, **choice}],
                }
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    import backend.agent_worker as worker

    original = worker.read_config
    monkeypatch.setattr(
        worker,
        "read_config",
        lambda *args: {
            **original(*args),
            "base_url": f"http://127.0.0.1:{server.server_port}/v1",
        },
    )
    monkeypatch.setattr(worker, "validate_endpoint", lambda value: value)
    try:
        with app.state.maker() as d:
            d.get(AgentRun, row["run_id"]).status = "running"
            d.commit()
        process(app, row["run_id"])
    finally:
        server.shutdown()
        server.server_close()
    return calls


@pytest.mark.parametrize(
    "kind,count", [("guide", 5), ("quiz", 5), ("quiz", 10), ("quiz", 15)]
)
def test_artifact_reads_real_pdf_validates_and_caches(env, monkeypatch, kind, count):
    app, a, b, settings, _, p, _, endpoint, body = setup(env, kind)
    body.update(question_count=count, difficulty="hard" if count == 15 else "easy")
    notes = a.get("/api/v1/items").json()
    response = a.post(endpoint, json=body)
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["status"] == "queued"
    assert a.delete("/api/v1/reading-artifacts/" + row["id"]).status_code == 409
    assert a.post(endpoint, json=body).json()["id"] == row["id"]
    assert b.get("/api/v1/reading-artifacts/" + row["id"]).status_code == 404
    assert b.get(endpoint).status_code == 404
    assert b.post(endpoint, json=body).status_code == 404
    expected = guide() if kind == "guide" else quiz(count)
    calls = run_fixture_model(app, settings, row, expected, monkeypatch)
    result = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert result["status"] == "completed", result
    # A guide also records that its citations were checked.
    assert result["result"] == (
        {**expected, "cited": True} if kind == "guide" else expected
    )
    assert result["evidence_pages"] == list(range(1, 13))
    assert len(calls) == 4
    assert a.post(endpoint, json=body).json()["run_id"] == row["run_id"]
    assert a.get("/api/v1/items").json() == notes
    with app.state.maker() as d:
        assert d.get(AgentRun, row["run_id"]).writable is False
    assert "test-private-key" not in json.dumps(result)
    removed = a.delete(
        "/api/v1/papers/" + p["id"],
        headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
    )
    assert removed.status_code == 200, removed.text
    assert a.get("/api/v1/reading-artifacts/" + row["id"]).status_code == 404


@pytest.mark.parametrize("mode", ["unread", "format", "pages", "count"])
def test_artifact_truthful_failure_and_retry(env, monkeypatch, mode):
    app, a, _, settings, _, _, _, endpoint, body = setup(
        env, "quiz" if mode == "count" else "guide"
    )
    row = a.post(endpoint, json=body).json()
    result = quiz(6) if mode == "count" else guide()
    if mode == "format":
        result = "这是一篇优秀论文，处理完成。"
    if mode == "pages":
        result["sections"][0]["pages"] = [999]
    run_fixture_model(
        app, settings, row, result, monkeypatch, read_all=mode != "unread"
    )
    failed = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert failed["status"] == "failed", failed
    assert failed["error"]
    assert failed["result"] == {}
    retried = a.post(endpoint, json=body)
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == row["id"]
    assert retried.json()["run_id"] != row["run_id"]
    assert retried.json()["evidence_pages"] == []


def test_artifact_cache_model_options_validation_and_budget(env):
    app, a, _, settings, owner, _, f, endpoint, body = setup(env)
    assert (
        a.post(endpoint, json={**body, "kind": "quiz", "question_count": 6}).status_code
        == 422
    )
    assert (
        a.post(
            endpoint, json={**body, "kind": "quiz", "difficulty": "maximum"}
        ).status_code
        == 422
    )
    settings.storage_limit = 1
    assert a.post(endpoint, json=body).status_code == 413
    settings.storage_limit = 1024**3
    row = a.post(endpoint, json=body).json()
    mark_failed(app, row["run_id"])
    cfg = save_options(
        settings,
        owner,
        body["model_config_id"],
        {"thinking_mode": "adaptive", "reasoning_effort": "default"},
    )
    assert cfg
    changed = a.post(endpoint, json=body).json()
    assert changed["id"] != row["id"]
    assert changed["model_options"]["thinking_mode"] == "adaptive"
    mark_failed(app, changed["run_id"])
    with app.state.maker() as d:
        d.get(File, f["id"]).sha256 = "a" * 64
        d.commit()
    changed_file = a.post(endpoint, json=body).json()
    assert changed_file["id"] != changed["id"]
    mark_failed(app, changed_file["run_id"])
    assert (
        a.delete("/api/v1/reading-artifacts/" + changed_file["id"]).status_code == 200
    )


def test_reading_artifact_backup_restore_and_migration(env, tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    app, a, _, settings, _, _, f, endpoint, body = setup(env)
    row = a.post(endpoint, json=body).json()
    mark_failed(app, row["run_id"])
    with zipfile.ZipFile(io.BytesIO(a.get("/api/v1/export").content)) as z:
        assert (
            len(json.loads(z.read("workspace.json"))["data"]["reading_artifacts"]) == 1
        )
    archive = tmp_path / "backup.zip"
    backup(settings, archive)
    restored = Settings(
        database_url="sqlite:///" + str(tmp_path / "restore.db"),
        storage=str(tmp_path / "restore-files"),
        testing=True,
    )
    other = create_app(restored)
    Base.metadata.create_all(other.state.engine)
    assert restore(restored, archive)["reading_artifacts"] == 1
    with other.state.maker() as d:
        assert d.get(ReadingArtifact, row["id"]).model == row["model"]
    other.state.engine.dispose()
    monkeypatch.setenv("DATABASE_URL", settings.database_url)
    with app.state.engine.begin() as conn:
        conn.execute(text("DROP TABLE reading_artifacts"))
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        )
        conn.execute(text("INSERT INTO alembic_version VALUES ('0015')"))
    command.upgrade(Config(toml_file="pyproject.toml"), "head")
    with app.state.maker() as d:
        assert d.get(File, f["id"]) is not None
        assert d.scalar(select(ReadingArtifact)) is None


def test_artifact_sessions_hidden_and_independent_of_conversation_limit(env):
    app, a, _, _, owner, _, _, endpoint, body = setup(env)
    with app.state.maker() as d:
        for i in range(100):
            d.add(AgentSession(owner=owner, title=f"User conversation {i}"))
        d.commit()
    assert a.post("/api/v1/agent/sessions", json={}).status_code == 409
    generated = a.post(endpoint, json=body)
    assert generated.status_code == 200, generated.text
    artifact = generated.json()
    sessions = a.get("/api/v1/agent/sessions").json()
    assert len(sessions) == 100
    assert artifact["session_id"] not in {s["id"] for s in sessions}
    mark_failed(app, artifact["run_id"])
    assert a.delete("/api/v1/reading-artifacts/" + artifact["id"]).status_code == 200
    assert len(a.get("/api/v1/agent/sessions").json()) == 100
    assert a.delete("/api/v1/agent/sessions/" + sessions[0]["id"]).status_code == 200
    assert a.post("/api/v1/agent/sessions", json={}).status_code == 200


def test_artifact_retry_does_not_import_previous_generated_conversation(
    env, monkeypatch
):
    app, a, _, settings, _, _, _, endpoint, body = setup(env)
    original = a.post(endpoint, json=body).json()
    run_fixture_model(app, settings, original, "OLD_RESULT_MARKER", monkeypatch)
    retry = a.post(endpoint, json=body).json()
    assert retry["session_id"] == original["session_id"]
    calls = run_fixture_model(app, settings, retry, guide(), monkeypatch)
    assert "OLD_RESULT_MARKER" not in json.dumps(calls[0]["messages"])
    assert (
        a.get("/api/v1/reading-artifacts/" + retry["id"]).json()["status"]
        == "completed"
    )


def test_highlights_verify_original_text(env, monkeypatch):
    app, a, _, settings, _, _, _, endpoint, body = setup(env, "highlights")
    body.update(page=2, language="zh")
    row = a.post(endpoint, json=body).json()
    expected = {
        "highlights": [{"page": 2, "quote": "Evidence on page 2", "category": "results"}]
    }
    calls = run_fixture_model(
        app, settings, row, expected, monkeypatch, batches=[(2, 1)]
    )
    finished = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert finished["status"] == "completed", finished
    assert finished["evidence_pages"] == [2]
    assert finished["result"] == expected
    assert "evidence_text" not in finished
    assert len(calls) == 2
    assert a.post(endpoint, json=body).json()["run_id"] == row["run_id"]
    regenerated = a.post(endpoint, json={**body, "regenerate": True}).json()
    assert regenerated["id"] == row["id"]
    assert regenerated["run_id"] != row["run_id"]
    assert regenerated["result"] == {}
    assert (
        a.post(endpoint, json={**body, "regenerate": True}).json()["run_id"]
        == regenerated["run_id"]
    )
    mark_failed(app, regenerated["run_id"])


def text_pdf(pages):
    """A PDF whose pages hold the given lines, readable by pypdf and PDFium alike."""
    import io

    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for lines in pages:
        page = writer.add_blank_page(612, 792)
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
        body = "".join(f"BT /F1 12 Tf 40 {700 - 20 * i} Td ({line}) Tj ET\n" for i, line in enumerate(lines))
        content.set_data(body.encode())
        page[NameObject("/Contents")] = writer._add_object(content)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


LINES = [
    "Alpha method builds a memory graph.",
    "Beta results improve accuracy by ten percent.",
    "Gamma limits apply to long documents.",
]


def highlights_setup(env):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    f = attach(a, p, "lines.pdf", text_pdf([LINES, LINES]))
    endpoint = f"/api/v1/papers/{p['id']}/reading-artifacts"
    body = {"file_id": f["id"], "model_config_id": model, "kind": "highlights"}
    row = a.post(endpoint, json=body).json()
    return app, a, settings, row


def quote(page, text, category="method"):
    return {"page": page, "quote": text, "category": category}


def test_highlights_keep_what_can_be_verified_in_reading_order(env, monkeypatch):
    app, a, settings, row = highlights_setup(env)
    result = {
        "highlights": [
            # Listed out of order, and one is not in the paper at all.
            quote(2, LINES[2]),
            quote(1, LINES[1], "results"),
            quote(1, "A sentence the paper never contains."),
            quote(1, LINES[0]),
        ]
    }
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "completed", done
    assert [(h["page"], h["quote"]) for h in done["result"]["highlights"]] == [
        (1, LINES[0]),
        (1, LINES[1]),
        (2, LINES[2]),
    ]


def test_a_quote_listed_twice_is_kept_once(env, monkeypatch):
    app, a, settings, row = highlights_setup(env)
    result = {"highlights": [quote(1, LINES[0]), quote(1, LINES[0])]}
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "completed", done
    assert len(done["result"]["highlights"]) == 1


def test_highlights_with_nothing_verifiable_fail(env, monkeypatch):
    app, a, settings, row = highlights_setup(env)
    result = {"highlights": [quote(1, "Invented one."), quote(2, LINES[0] + " Extra.")]}
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "failed", done
    assert done["result"] == {} and done["error"]


def keypoint(page, text, category="method", reason="因为重要"):
    return {"page": page, "quote": text, "category": category, "reason": reason}


def keypoints_setup(env):
    app, a, settings, row = highlights_setup(env)
    body = {"file_id": row["file_id"], "model_config_id": row["model_config_id"]}
    row = a.post(
        f"/api/v1/papers/{row['paper_id']}/reading-artifacts",
        json={**body, "kind": "keypoints"},
    ).json()
    return app, a, settings, row


def test_keypoints_keep_only_quotes_found_in_the_paper(env, monkeypatch):
    app, a, settings, row = keypoints_setup(env)
    result = {
        "keypoints": [
            keypoint(2, LINES[2], "limits"),
            keypoint(1, LINES[1], "results"),
            keypoint(1, "A sentence the paper never contains.", "novelty"),
            keypoint(2, LINES[0] + " Extra.", "method"),
            keypoint(1, LINES[0], "novelty"),
            keypoint(1, LINES[0], "novelty"),
        ]
    }
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "completed", done
    assert [(k["page"], k["quote"], k["category"]) for k in done["result"]["keypoints"]] == [
        (1, LINES[0], "novelty"),
        (1, LINES[1], "results"),
        (2, LINES[2], "limits"),
    ]
    assert done["result"]["keypoints"][0]["reason"] == "因为重要"


def test_keypoints_with_nothing_verifiable_fail(env, monkeypatch):
    app, a, settings, row = keypoints_setup(env)
    result = {"keypoints": [keypoint(1, "Invented one.", "limits")]}
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "failed", done
    assert done["result"] == {}


def test_a_keypoint_with_an_unknown_category_is_refused(env, monkeypatch):
    app, a, settings, row = keypoints_setup(env)
    result = {"keypoints": [keypoint(1, LINES[0], "orange")]}
    run_fixture_model(app, settings, row, result, monkeypatch, batches=[(1, 2)])
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "failed", done


def test_a_summary_squeezed_into_one_item_is_split_into_three_sentences(
    env, monkeypatch
):
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, "guide")
    row = a.post(endpoint, json=body).json()
    value = guide()
    value["summary"] = ["研究可扩展记忆。采用图结构。报告实验提升。"]
    run_fixture_model(app, settings, row, value, monkeypatch)
    done = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert done["status"] == "completed", done
    assert done["result"]["summary"] == ["研究可扩展记忆。", "采用图结构。", "报告实验提升。"]


def test_the_runtime_gives_minimax_room_to_think_and_answer(env, monkeypatch):
    # Thinking shares the output budget: 8192 cut long answers off mid-sentence.
    app, a, b, settings, owner, p, f, endpoint, body = setup(env, "outline")
    row = a.post(endpoint, json=body).json()
    result = {"entries": [{"title": "Evidence on page 1", "page": 1, "level": 1}]}
    calls = run_fixture_model(app, settings, row, result, monkeypatch)
    assert calls[0]["max_completion_tokens"] == 32768
    assert "max_tokens" not in calls[0]


@pytest.mark.parametrize("valid", [True, False])
def test_outline_requires_headings_from_actual_pages(env, monkeypatch, valid):
    app, a, b, settings, _, _p, _, endpoint, body = setup(env, "outline")
    row = a.post(endpoint, json=body).json()
    result = {
        "entries": [
            {
                "title": "Evidence on page 1" if valid else "Fabricated heading",
                "page": 1,
                "level": 1,
            },
            {"title": "Evidence on page 12", "page": 12, "level": 2},
        ]
    }
    run_fixture_model(app, settings, row, result, monkeypatch)
    saved = a.get("/api/v1/reading-artifacts/" + row["id"]).json()
    assert saved["status"] == ("completed" if valid else "failed"), saved
    if valid:
        assert saved["result"] == result
    else:
        assert "目录标题" in saved["error"]
    assert b.get(endpoint).status_code == 404


def test_translation_target_languages_reach_prompt():
    from types import SimpleNamespace

    from pydantic import ValidationError

    from backend.reading_artifacts import ArtifactInput, artifact_prompt

    file = SimpleNamespace(id="00000000-0000-0000-0000-000000000001", pages=2)
    for language, expected in [
        ("zh-TW", "繁体中文"),
        ("ja", "日文"),
        ("fr", "法文"),
        ("en", "英文"),
    ]:
        body = ArtifactInput(
            file_id=file.id,
            model_config_id="model",
            kind="page_translation",
            language=language,
        )
        assert expected in artifact_prompt(file, body)
    with pytest.raises(ValidationError):
        ArtifactInput(
            file_id=file.id,
            model_config_id="model",
            kind="page_translation",
            language="unsupported",
        )


def test_translation_typography_restores_exact_pdf_text():
    from backend.reading_artifacts import PageTranslation, verify_translation

    source = "These systems’ ﬁxed operations\nremain unchanged."
    result = PageTranslation(paragraphs=[{
        "original": "These systems' fixed operations remain unchanged.",
        "translation": "这些系统的固定操作保持不变。",
    }])
    verify_translation(result, source)
    assert result.paragraphs[0].original == source
    for original in ["These systems' improved operations remain unchanged.",
                     "These systems' fixed operations"]:
        result = PageTranslation(paragraphs=[{"original": original, "translation": "译文"}])
        with pytest.raises(ValueError):
            verify_translation(result, source)


def test_translation_structure_keeps_figure_text_and_full_source():
    from backend.reading_artifacts import PageTranslation, verify_translation
    source = "Agent Write Read\nFigure 2: Memory architecture.\n3 Method\nOur method evolves memory.\n3"
    kinds = ["figure_text", "caption", "heading", "text", "page_number"]
    result = PageTranslation(paragraphs=[
        {"original": text, "translation": "译文", "kind": kind}
        for text, kind in zip(source.splitlines(), kinds)
    ])
    verify_translation(result, source)
    assert [p.kind for p in result.paragraphs] == kinds
    assert "\n".join(p.original for p in result.paragraphs) == source
    # Collapsing presentation must never license dropping figure evidence.
    result.paragraphs.pop(0)
    with pytest.raises(ValueError, match="不完整"):
        verify_translation(result, source)


def test_translation_cannot_hide_body_as_page_number():
    from backend.reading_artifacts import PageTranslation, verify_translation
    source = "Our experiments support the method."
    result = PageTranslation(paragraphs=[{
        "original": source, "translation": "实验支持该方法。", "kind": "page_number"
    }])
    with pytest.raises(ValueError, match="页码分类包含正文"):
        verify_translation(result, source)


def test_translation_line_wrap_hyphens_restore_original_evidence():
    from backend.reading_artifacts import PageTranslation, verify_translation
    source = "LLM-\ngenerated rich rep-\nresentations retain x-y and re-sign."
    result = PageTranslation(paragraphs=[{
        "original": "LLM-generated rich representations retain x-y and re-sign.",
        "translation": "译文"
    }])
    verify_translation(result, source)
    assert result.paragraphs[0].original == source
    for changed in ["LLM-generated rich representations retain xy and re-sign.",
                    "LLM-generated rich representations retain x-y and resign."]:
        with pytest.raises(ValueError, match="不一致"):
            verify_translation(PageTranslation(paragraphs=[{"original": changed, "translation": "译文"}]), source)


def page_translation_of(*pairs):
    from backend.reading_artifacts import PageTranslation

    return PageTranslation.model_validate(
        {"paragraphs": [{"original": o, "translation": t} for o, t in pairs]}
    )


def test_a_paragraph_the_model_corrected_is_realigned_to_the_pdf_text():
    from backend.reading_artifacts import realign_originals, verify_translation

    page = "We conduct the ablation study by removing key components.\nResults improve on every benchmark we tried."
    result = page_translation_of(
        # The model fixed the paper's tense; the reader must still find it on the page.
        ("We conducted the ablation study by removing key components.", "我们进行了消融实验。"),
        ("Results improve on every benchmark we tried.", "结果在所有基准上提升。"),
    )
    with pytest.raises(ValueError, match="不一致"):
        verify_translation(result, page)  # the check itself stays strict
    realign_originals(result, page)
    verify_translation(result, page)
    assert result.paragraphs[0].original == (
        "We conduct the ablation study by removing key components."
    )
    assert result.paragraphs[1].original == "Results improve on every benchmark we tried."


def test_dot_leaders_of_a_different_length_are_realigned():
    from backend.reading_artifacts import realign_originals, verify_translation

    page = "2.2 Retrieval-Augmented Generation . . . . . . . . . . . . . . 3\n3 Methodology . . . . . . . . . . . . . . . . . . 3"
    result = page_translation_of(
        ("2.2 Retrieval-Augmented Generation . . . . . . . . 3", "2.2 检索增强生成 3"),
        ("3 Methodology . . . . . . . . 3", "3 方法 3"),
    )
    realign_originals(result, page)
    verify_translation(result, page)
    assert result.paragraphs[0].original.endswith(". 3")
    assert result.paragraphs[0].original.startswith("2.2 Retrieval-Augmented")


def test_a_paragraph_that_is_not_on_the_page_is_still_rejected():
    from backend.reading_artifacts import realign_originals, verify_translation

    page = "We conduct the ablation study by removing key components.\nResults improve."
    result = page_translation_of(
        ("A completely different sentence about unrelated matters entirely.", "无关。"),
        ("Results improve.", "结果提升。"),
    )
    realign_originals(result, page)
    with pytest.raises(ValueError, match="不一致"):
        verify_translation(result, page)


def test_paragraphs_in_the_readers_order_pass_when_the_pdf_lists_them_differently():
    from backend.reading_artifacts import realign_originals, verify_translation

    # A contents page or a two-column table: the text layer lists the lines in
    # one order, the model reads them in the order on the page.
    page = "4.5 Scaling . . . 8\n4.2 Details . . . 6\n4.3 Results . . . 7"
    result = page_translation_of(
        ("4.2 Details . . . 6", "4.2 细节 6"),
        ("4.3 Results . . . 7", "4.3 结果 7"),
        ("4.5 Scaling . . . 8", "4.5 扩展 8"),
    )
    realign_originals(result, page, ordered=False)
    with pytest.raises(ValueError, match="不一致"):
        verify_translation(result, page)  # the strict check still wants text order
    verify_translation(result, page, ordered=False)
    assert [p.original for p in result.paragraphs] == [
        "4.2 Details . . . 6",
        "4.3 Results . . . 7",
        "4.5 Scaling . . . 8",
    ]


def test_leaving_out_part_of_the_page_still_fails_when_order_does_not_matter():
    from backend.reading_artifacts import verify_translation

    page = "Alpha beta gamma delta epsilon.\nZeta eta theta iota kappa lambda."
    result = page_translation_of(("Zeta eta theta iota kappa lambda.", "译文"))
    with pytest.raises(ValueError, match="不完整"):
        verify_translation(result, page, ordered=False)
    # Saying the same stretch twice does not make up for the part left out.
    result = page_translation_of(
        ("Zeta eta theta iota kappa lambda.", "译文"),
        ("Zeta eta theta iota kappa lambda.", "译文"),
    )
    with pytest.raises(ValueError, match="不完整"):
        verify_translation(result, page, ordered=False)


def test_a_corrected_paragraph_far_from_the_reading_position_is_still_found():
    from backend.reading_artifacts import realign_originals, verify_translation

    filler = " ".join(f"Sentence number {n} stands here on the page." for n in range(40))
    page = filler + "\nWe conduct the ablation study by removing key components.\n" + filler
    result = page_translation_of(
        (filler, "译文一"),
        ("We conducted the ablation study by removing key components.", "译文二"),
        (filler, "译文三"),
    )
    # The corrected line is not near where the reading position was left.
    realign_originals(result, page, ordered=False)
    verify_translation(result, page, ordered=False)
    assert result.paragraphs[1].original == (
        "We conduct the ablation study by removing key components."
    )
