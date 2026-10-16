import io
import tarfile

import pytest

from backend.arxiv_import import extract_source, identifier
from backend.models import TranslationJob
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.translation_engine import locate, protect, restore, translate_project


def test_arxiv_identifiers_pin_versions_and_reject_urls():
    assert identifier("https://arxiv.org/pdf/2504.19413v1.pdf") == "2504.19413v1"
    assert identifier("arxiv:hep-th/9901001v2") == "hep-th/9901001v2"
    for value in [
        "https://evil.test/2504.19413v1",
        "https://arxiv.org@localhost/pdf/2504.19413",
        "2504.19413/../../etc/passwd",
    ]:
        with pytest.raises(ValueError):
            identifier(value)


@pytest.mark.parametrize(
    "value",
    [
        "https://arxiv.org/abs/2504.19413v1?utm_source=share#abstract",
        "https://arxiv.org/html/2504.19413v1#S3.SS1",
        "https://arxiv.org/html/2504.19413v1/",
        "https://www.arxiv.org/pdf/2504.19413v1.pdf?download=1",
        "http://export.arxiv.org/abs/2504.19413v1",
        "https://arxiv.org/src/2504.19413v1",
        "https://arxiv.org/e-print/2504.19413v1",
        "arxiv.org/html/2504.19413v1",
        "arXiv:2504.19413v1",
    ],
)
def test_arxiv_page_variants_resolve_to_the_same_version(value):
    assert identifier(value) == "2504.19413v1"


@pytest.mark.parametrize(
    "value",
    [
        "https://arxiv.org.evil.test/html/2504.19413v1",
        "https://someone@arxiv.org/html/2504.19413v1",
        "https://arxiv.org:8080/html/2504.19413v1",
        "https://arxiv.org/html/2504.19413v1/../../other",
        "https://arxiv.org/html/2504.19413v1%2F..",
        "https://arxiv.org/search/?query=2504.19413v1",
    ],
)
def test_arxiv_link_variants_do_not_accept_other_fetch_destinations(value):
    with pytest.raises(ValueError):
        identifier(value)


def test_source_archive_rejects_links_and_traversal(tmp_path):
    for name, kind in [
        ("../outside.tex", tarfile.REGTYPE),
        ("escape", tarfile.SYMTYPE),
    ]:
        b = io.BytesIO()
        with tarfile.open(fileobj=b, mode="w:gz") as t:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.linkname = "/etc/passwd"
            t.addfile(info)
        with pytest.raises(ValueError):
            extract_source(b.getvalue(), tmp_path / "source")


def test_tex_protection_preserves_formula_citations_and_rejects_missing_tokens():
    source = r"Our method $x_i = 2$ improves \textbf{memory} by 20\% \citep{paper}."
    masked, tokens = protect(source)
    translated = (
        masked.replace("Our method", "我们的方法")
        .replace("improves", "提升")
        .replace("memory", "记忆")
        .replace("by", "达到")
    )
    target = restore(translated, masked, tokens)
    assert (
        r"$x_i = 2$" in target
        and r"\citep{paper}" in target
        and r"\textbf{记忆}" in target
    )
    with pytest.raises(ValueError):
        restore(translated.replace("__PW_KEEP_0__", ""), masked, tokens)


def test_model_config_is_private_and_provider_change_requires_key(env):
    _app, a, b, _settings = env
    key = "test-key-do-not-expose"
    response = write(
        a,
        "/translation-settings",
        {
            "base_url": "https://api.deepseek.com/v1",
            "model": "test-model",
            "api_key": key,
            "context_length": 128000,
        },
        "PUT",
    )
    assert response.status_code == 200 and key not in response.text
    assert (
        a.get("/api/v1/translation-settings").json()["models"][0]["context_length"]
        == 128000
    )
    assert b.get("/api/v1/translation-settings").json()["configured"] is False
    assert key not in a.get("/api/v1/translation-settings").text
    assert (
        write(
            a,
            "/translation-settings",
            {"base_url": "http://127.0.0.1", "model": "x", "api_key": key},
            "PUT",
        ).status_code
        == 422
    )
    assert (
        write(
            a,
            "/translation-settings",
            {"base_url": "https://api.openai.com/v1", "model": "x"},
            "PUT",
        ).status_code
        == 422
    )
    assert (
        write(
            a,
            "/translation-settings",
            {"base_url": "https://api.deepseek.com/v1", "model": "y"},
            "PUT",
        ).status_code
        == 200
    )


def test_translation_job_owner_cancel_and_delete_guard(env):
    app, a, b, _ = env
    p = write(
        a, "/papers", {"title": "Mem0", "external_id": "arxiv:2504.19413v1"}
    ).json()
    assert write(a, f"/papers/{p['id']}/translations", {}).status_code == 409
    write(
        a,
        "/translation-settings",
        {"base_url": "https://api.openai.com/v1", "model": "test", "api_key": "fake"},
        "PUT",
    )
    job = write(a, f"/papers/{p['id']}/translations", {}).json()
    assert job["status"] == "queued"
    assert write(a, f"/papers/{p['id']}/translations", {}).json()["id"] == job["id"]
    with app.state.maker() as d:
        failed = d.get(TranslationJob, job["id"])
        failed.status = "failed"
        failed.completed = 5
        failed.error = "Fixture failure"
        d.commit()
    resumed = write(a, f"/papers/{p['id']}/translations", {}).json()
    assert resumed["id"] == job["id"] and resumed["status"] == "queued"
    assert resumed["completed"] == 5 and resumed["error"] == ""
    assert b.get(f"/api/v1/papers/{p['id']}/translations").status_code == 404
    assert write(b, f"/translations/{job['id']}/cancel", {}).status_code == 404
    assert (
        a.delete(
            f"/api/v1/papers/{p['id']}",
            headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
        ).status_code
        == 409
    )
    assert (
        write(a, f"/translations/{job['id']}/cancel", {}).json()["status"]
        == "cancelled"
    )
    assert (
        a.delete(
            f"/api/v1/papers/{p['id']}",
            headers={"If-Match": str(p["revision"]), "X-Confirm-Delete": p["id"]},
        ).status_code
        == 200
    )


def test_source_reconstruction_keeps_structure_and_builds_alignment(
    tmp_path, monkeypatch
):
    import json

    import backend.translation_engine as engine

    source = tmp_path / "source"
    source.mkdir()
    (source / "main.tex").write_text(
        r"\documentclass{article}"
        + "\n"
        + r"\title{Memory research paper}"
        + "\n"
        + r"\begin{document}\maketitle"
        + "\n"
        + r"\section{A research method}"
        + "\n\n"
        + r"The memory method preserves $x=2$ and stores facts."
        + "\n\n"
        + r"\end{document}"
    )

    def fake(config, system, content):
        rows = json.loads(content)
        for row in rows:
            # A deterministic fixture exercises structure, not translation quality.
            row["text"] = "中文测试 " + row["text"]
        return json.dumps(rows)

    monkeypatch.setattr(engine, "complete", fake)
    units = translate_project(source, tmp_path / "out", {}, lambda *args: None)
    output = (tmp_path / "out/main.tex").read_text()
    assert "\\usepackage[UTF8]{ctex}" in output
    assert "$x=2$" in output and "中文测试" in output
    assert units and all(u["source_text"] and u["translated_text"] for u in units)
    assert (
        locate(
            "An exact sentence that is sufficiently long.",
            ["Unrelated", "An exact sentence that is sufficiently long."],
        )["page"]
        == 2
    )
    assert (
        locate(
            "An exact sentence that is sufficiently long.",
            ["An exact sentence that is sufficiently long."] * 2,
        )
        is None
    )


def test_arxiv_metadata_uses_official_page_when_api_limited(monkeypatch):
    import httpx

    import backend.arxiv_import as arxiv

    page = b'<meta name="citation_title" content="A paper"><meta name="citation_author" content="Author"><td class="arxividv"><a href="https://arxiv.org/abs/2504.19413v1">version</a></td>'

    def fetch(path, limit=0):
        if path.startswith("/api"):
            raise httpx.ConnectError("fixture unavailable")
        assert path == "/abs/2504.19413v1"
        return page

    monkeypatch.setattr(arxiv, "download", fetch)
    assert arxiv.metadata("2504.19413v1")["arxiv_id"] == "2504.19413v1"


def test_worker_publishes_files_and_alignment_and_backup_roundtrips(
    env, tmp_path, monkeypatch
):
    from pypdf import PdfWriter

    import backend.translation_worker as worker
    from backend.cli import backup
    from backend.cli import restore as restore_backup
    from backend.config import Settings, database
    from backend.models import Base

    app, a, b, settings = env
    p = write(
        a, "/papers", {"title": "Worker fixture", "external_id": "arxiv:2504.19413v1"}
    ).json()
    write(
        a,
        "/translation-settings",
        {
            "base_url": "https://api.openai.com/v1",
            "model": "test",
            "api_key": "fixture-secret",
        },
        "PUT",
    )
    job = write(a, f"/papers/{p['id']}/translations", {}).json()
    with app.state.maker() as d:
        d.get(TranslationJob, job["id"]).status = "running"
        d.commit()
    pdf = PdfWriter()
    pdf.add_blank_page(612, 792)
    raw = io.BytesIO()
    pdf.write(raw)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as t:
        text = b"\\documentclass{article}\\begin{document}Fixture text.\\end{document}"
        info = tarfile.TarInfo("main.tex")
        info.size = len(text)
        t.addfile(info, io.BytesIO(text))
    monkeypatch.setattr(
        worker,
        "download",
        lambda path: raw.getvalue() if path.startswith("/pdf/") else archive.getvalue(),
    )

    def translate(source, target, config, progress, cached=None):
        import shutil

        assert config["api_key"] == "fixture-secret"
        shutil.copytree(source, target)
        progress(1, 1, "fixture")
        return [{"id": "u1", "source_text": "fixture", "translated_text": "测试"}]

    monkeypatch.setattr(worker, "translate_project", translate)

    def compile_(directory):
        target = directory / "main.pdf"
        target.write_bytes(raw.getvalue())
        return target

    monkeypatch.setattr(worker, "compile_project", compile_)
    worker.process(settings, app.state.maker, job["id"])
    result = a.get(f"/api/v1/papers/{p['id']}/translations").json()[0]
    assert result["status"] == "completed"
    assert not result["translated_archive"] and not result["source_archive"]
    assert result["alignment"] == [
        {
            "id": "u1",
            "source_text": "fixture",
            "translated_text": "测试",
            "source": None,
            "translated": None,
        }
    ]
    assert (
        a.get("/api/v1/files/" + result["translated_file"] + "/content").content
        == raw.getvalue()
    )
    assert (
        b.get("/api/v1/files/" + result["translated_file"] + "/content").status_code
        == 404
    )
    saved = tmp_path / "backup.zip"
    backup(settings, saved)
    import zipfile

    with zipfile.ZipFile(saved) as z:
        assert b"fixture-secret" not in z.read("backup.json")
    destination = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    engine, _ = database(destination)
    Base.metadata.create_all(engine)
    engine.dispose()
    assert restore_backup(destination, saved)["translation_jobs"] == 1


def test_arxiv_download_retries_transient_errors(monkeypatch):
    import httpx

    from backend import arxiv_import

    calls = []

    def retrieve(path, limit):
        calls.append(path)
        if len(calls) < 3:
            raise httpx.ReadTimeout("timeout")
        return b"paper"

    monkeypatch.setattr(arxiv_import, "_download_once", retrieve)
    assert arxiv_import.download("/pdf/2504.19413v1") == b"paper"
    assert len(calls) == 3
    monkeypatch.setattr(
        arxiv_import,
        "_download_once",
        lambda *args: (_ for _ in ()).throw(
            httpx.ReadTimeout("private network details")
        ),
    )
    with pytest.raises(ValueError, match="已重试 3 次"):
        arxiv_import.download("/pdf/2504.19413v1")


def test_hyperlinks_keep_destinations_and_extract_visible_text():
    from backend.translation_engine import plain

    source = r"Read \href{https://example.com/EnglishPaper}{the original paper} here."
    assert "the original paper" in plain(source)
    masked, tokens = protect(source)
    assert "https://" not in masked
    result = restore(masked.replace("the original paper", "原始论文"), masked, tokens)
    assert r"\href{https://example.com/EnglishPaper}{原始论文}" in result


@pytest.mark.parametrize("model", ["MiniMax-M3", "MiniMax-M3.1-Flash-Preview"])
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
@pytest.mark.parametrize("base_url", ["https://api.minimax.cn/v1", "https://llm.example.test/v1"])
def test_minimax_reasoning_is_separated_from_translation(monkeypatch, model, protocol, base_url):
    import httpx

    from backend import translation_settings as settings

    monkeypatch.setenv("TRANSLATION_ALLOWED_HOSTS", "llm.example.test")

    real_client = httpx.Client

    def reply(request):
        import json

        body = json.loads(request.content)
        if protocol == "openai":
            assert body["reasoning_split"] is True
        if model == "MiniMax-M3":
            assert body["thinking"] == {"type": "disabled"}
        else:
            assert "thinking" not in body
        if protocol == "openai":
            assert body["max_completion_tokens"] == 32768
            assert "max_tokens" not in body
            assert body["temperature"] == 1
        else:
            assert body["max_tokens"] == 32768
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [
                        {"type": "thinking", "thinking": "internal reasoning"},
                        {"type": "text", "text": '[{"id":"u1","text":"中文"}]'},
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": '<think>internal reasoning</think>\n[{"id":"u1","text":"中文"}]'
                        },
                    }
                ]
            },
        )

    monkeypatch.setattr(
        settings.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(reply)),
    )
    result = settings.complete(
        {
            "base_url": base_url,
            "model": model,
            "api_key": "fixture",
            "protocol": protocol,
        },
        "translate",
        "input",
    )
    assert result == '[{"id":"u1","text":"中文"}]'


@pytest.mark.parametrize("missing", [False, True])
def test_translation_retries_only_invalid_paragraphs(tmp_path, monkeypatch, missing):
    import json

    from backend import translation_engine as engine

    source = tmp_path / "source"
    source.mkdir()
    (source / "main.tex").write_text(
        r"\documentclass{article}\begin{document}\section{Method}"
        + "\n\n"
        + r"The first method preserves $x=2$ in memory."
        + "\n\n"
        + r"The second method preserves $y=3$ in memory."
        + "\n\n"
        + r"\end{document}"
    )
    calls = []

    def fake(config, system, content):
        rows = json.loads(content)
        calls.append([r["id"] for r in rows])
        for index, r in enumerate(rows):
            r["text"] = "中文 " + r["text"]
            if len(calls) == 1 and index == 0:
                r["text"] = r["text"].replace("__PW_KEEP_0__", "")
        if missing and len(calls) == 1:
            rows = rows[1:]
        return json.dumps(rows)

    monkeypatch.setattr(engine, "complete", fake)
    units = engine.translate_project(source, tmp_path / "out", {}, lambda *args: None)
    assert len(calls) == 2 and calls[1] == [calls[0][0]]
    assert len(units) == 3


def test_citations_can_follow_chinese_word_order_but_structure_cannot():
    source = (
        r"Algorithm \ref{algorithm} in Appendix \ref{appendix} uses \textbf{memory}."
    )
    masked, tokens = protect(source)
    translated = (
        masked.replace("__PW_KEEP_0__", "SWAP")
        .replace("__PW_KEEP_1__", "__PW_KEEP_0__")
        .replace("SWAP", "__PW_KEEP_1__")
    )
    assert r"\ref{appendix}" in restore(translated, masked, tokens)
    broken = (
        masked.replace("__PW_KEEP_2__", "SWAP")
        .replace("__PW_KEEP_3__", "__PW_KEEP_2__")
        .replace("SWAP", "__PW_KEEP_3__")
    )
    with pytest.raises(ValueError):
        restore(broken, masked, tokens)


def test_standalone_method_macros_can_move_without_losing_tex_structure():
    source = r"Compared to \baseline, \ourmethod improves \textbf{quality}."
    masked, tokens = protect(source)
    value = (
        masked.replace("__PW_KEEP_0__", "SWAP")
        .replace("__PW_KEEP_1__", "__PW_KEEP_0__")
        .replace("SWAP", "__PW_KEEP_1__")
    )
    assert r"\ourmethod" in restore(value, masked, tokens)
    with pytest.raises(ValueError):
        restore(value + "__PW_KEEP_0__", masked, tokens)


def test_chinese_text_does_not_become_part_of_a_tex_macro():
    from backend.translation_engine import plain

    masked, tokens = protect(r"The \method improves memory.")
    target = restore(masked.replace(" improves memory.", "改善记忆。"), masked, tokens)
    assert r"\method 改善记忆。" in target
    assert "Mem0" in plain(target, {"method": "Mem0"})
    assert "改善记忆" in plain(target, {"method": "Mem0"})


def test_tex_environment_definitions_are_not_translated(tmp_path, monkeypatch):
    import json

    from backend import translation_engine as engine

    source = tmp_path / "source"
    source.mkdir()
    declaration = (
        r"\NewTColorBox{EqBox}{ s O {!htbp} m }{floatplacement={#2},title={#3}}"
    )
    (source / "main.tex").write_text(
        "\\pdfoutput=1\n"
        + r"\documentclass{article}\begin{document}\section{Method}"
        + "\n\n"
        + declaration
        + "\n\n"
        + "This is a research paragraph."
        + "\n\n"
        + r"\end{document}"
    )

    def fake(config, system, content):
        assert "floatplacement" not in content
        rows = json.loads(content)
        for row in rows:
            row["text"] = "中文 " + row["text"]
        return json.dumps(rows)

    monkeypatch.setattr(engine, "complete", fake)
    engine.translate_project(source, tmp_path / "out", {}, lambda *args: None)
    output = (tmp_path / "out/main.tex").read_text()
    assert declaration in output
    assert r"\ifdefined\pdfoutput\pdfoutput=1\fi" in output


def test_layout_arguments_are_not_sent_to_translation_and_cache_is_repaired():
    from backend.translation_engine import preserve_layout

    source = r"Paragraph \vspace{0.5cm} with \textcolor{blue}{visible words}."
    masked, tokens = protect(source)
    assert "0.5cm" not in masked and "blue" not in masked
    assert "visible words" in masked
    result = restore(masked.replace("visible words", "可见文字"), masked, tokens)
    assert r"\vspace{0.5cm}" in result
    assert r"\textcolor{blue}{可见文字}" in result
    assert preserve_layout(source, result.replace("0.5cm", "0.5厘米")) == result
    with pytest.raises(ValueError):
        preserve_layout(source, "Missing commands")


def test_parallel_translation_is_bounded_and_checkpoints_resume(tmp_path, monkeypatch):
    import json
    import threading

    from backend import translation_engine as engine

    source = tmp_path / "source"
    source.mkdir()
    paragraphs = [
        f"Paragraph number {i} describes a different research finding."
        for i in range(7)
    ]
    (source / "main.tex").write_text(
        r"\documentclass{article}\begin{document}\section{Method}"
        + "\n\n"
        + "\n\n".join(paragraphs)
        + "\n\n"
        + r"\end{document}"
    )
    monkeypatch.setattr(
        engine, "translation_batches", lambda units, **kwargs: [[u] for u in units]
    )
    barrier = threading.Barrier(3, timeout=5)
    lock = threading.Lock()
    active = peak = calls = 0

    def complete(config, system, content):
        nonlocal active, peak, calls
        with lock:
            active += 1
            calls += 1
            number = calls
            peak = max(peak, active)
        try:
            if number <= 3:
                barrier.wait()
            rows = json.loads(content)
            for row in rows:
                row["text"] = "中文 " + row["text"]
            return json.dumps(rows)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(engine, "complete", complete)
    progress = []
    saved = {}

    def checkpoint(done, total, stage, cache=None):
        progress.append(done)
        if cache:
            saved.update(json.loads(json.dumps(cache)))

    units = engine.translate_project(source, tmp_path / "out", {}, checkpoint)
    assert peak == 3 and calls == len(units) == 8
    assert progress == sorted(progress) and len(saved) == 8

    def unexpected(*args):
        raise AssertionError("Cached units must not call the model")

    monkeypatch.setattr(engine, "complete", unexpected)
    resumed = engine.translate_project(
        source, tmp_path / "resumed", {}, checkpoint, cached=saved
    )
    assert len(resumed) == 8


def test_batch_budget_keeps_whole_units_in_order():
    from backend.translation_engine import translation_batches

    units = [
        {"id": str(i), "masked": "word " * n, "tokens": []}
        for i, n in enumerate([20, 20, 4000, 20, 20])
    ]
    batches = translation_batches(units, budget=200, max_units=3)
    assert [u for b in batches for u in b] == units
    assert [units[2]] in batches
    assert all(len(b) <= 3 for b in batches)


def test_model_discovery_uses_owner_key_and_never_forwards_it_to_other_host(
    env, monkeypatch
):
    import httpx

    from backend import translation_settings as settings

    _app, a, b, _settings = env
    write(
        a,
        "/translation-settings",
        {
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3",
            "api_key": "fixture-secret",
        },
        "PUT",
    )
    real_client = httpx.Client
    calls = []

    def reply(request):
        calls.append(str(request.url))
        assert request.headers["Authorization"] == "Bearer fixture-secret"
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "MiniMax-M3"},
                    {"id": "MiniMax-M2.7"},
                    {"id": "MiniMax-M3"},
                ]
            },
        )

    monkeypatch.setattr(
        settings.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(reply)),
    )
    response = write(
        a, "/translation-settings/models", {"base_url": "https://api.minimax.cn/v1"}
    )
    assert response.status_code == 200
    assert response.json()["models"] == ["MiniMax-M2.7", "MiniMax-M3"]
    assert "fixture-secret" not in response.text
    for client, url in [
        (b, "https://api.minimax.cn/v1"),
        (a, "https://api.openai.com/v1"),
        (a, "http://127.0.0.1"),
    ]:
        assert (
            write(client, "/translation-settings/models", {"base_url": url}).status_code
            == 422
        )
    assert calls == ["https://api.minimax.cn/v1/models"]


def test_model_discovery_can_use_unsaved_key_without_persisting_it(env, monkeypatch):
    import httpx

    from backend import translation_settings as settings

    _app, a, _b, _settings = env
    real_client = httpx.Client

    def reply(request):
        assert request.headers["Authorization"] == "Bearer temporary-key"
        return httpx.Response(200, json={"data": [{"id": "MiniMax-M3"}]})

    monkeypatch.setattr(
        settings.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(reply)),
    )
    response = write(
        a,
        "/translation-settings/models",
        {"base_url": "https://api.minimax.cn/v1", "api_key": "temporary-key"},
    )
    assert response.status_code == 200
    assert a.get("/api/v1/translation-settings").json()["configured"] is False


def test_anthropic_protocol_models_pagination_and_messages(env, monkeypatch):
    import json

    import httpx

    from backend import translation_settings as settings

    _app, a, _b, _settings = env
    real_client = httpx.Client
    calls = []

    def reply(request):
        assert request.headers["x-api-key"] == "fixture-anthropic"
        assert request.headers["anthropic-version"] == "2023-06-01"
        assert "authorization" not in request.headers
        calls.append(str(request.url))
        if request.method == "GET":
            second = request.url.params.get("after_id") == "claude-a"
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "claude-b" if second else "claude-a"}],
                    "has_more": not second,
                    "last_id": "claude-a",
                },
            )
        body = json.loads(request.content)
        assert body["system"] == "translate"
        assert "thinking" not in body
        assert body["max_tokens"] > 0
        assert body["messages"] == [{"role": "user", "content": "input"}]
        return httpx.Response(
            200,
            json={
                "stop_reason": "end_turn",
                "content": [
                    {"type": "thinking", "thinking": "private"},
                    {"type": "text", "text": "中文结果"},
                ],
            },
        )

    monkeypatch.setattr(
        settings.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(reply)),
    )
    cfg = {
        "base_url": "https://api.anthropic.com",
        "protocol": "anthropic",
        "api_key": "fixture-anthropic",
        "model": "claude-a",
    }
    result = write(a, "/translation-settings/models", cfg)
    assert result.status_code == 200 and result.json()["models"] == [
        "claude-a",
        "claude-b",
    ]
    assert settings.complete(cfg, "translate", "input") == "中文结果"
    assert calls == [
        "https://api.anthropic.com/v1/models",
        "https://api.anthropic.com/v1/models?after_id=claude-a",
        "https://api.anthropic.com/v1/messages",
    ]


def test_saved_models_are_separate_private_and_jobs_pin_selection(env):
    app, a, b, settings = env
    from backend.translation_settings import read_config

    def add(model):
        response = write(
            a,
            "/translation-settings/configs",
            {
                "base_url": "https://api.minimax.cn/v1",
                "model": model,
                "api_key": "fixture-" + model,
            },
        )
        assert response.status_code == 200 and "fixture-" not in response.text
        return response.json()

    first = add("MiniMax-M3")
    first_id = first["active_id"]
    second = add("MiniMax-M2.7")
    second_id = second["models"][1]["id"]
    assert second["active_id"] == first_id
    assert b.get("/api/v1/translation-settings").json()["models"] == []
    p = write(
        a, "/papers", {"title": "Pinned model", "external_id": "arxiv:2504.19413v1"}
    ).json()
    job = write(a, f"/papers/{p['id']}/translations", {}).json()
    assert job["model_config_id"] == first_id
    assert (
        write(a, f"/translation-settings/configs/{second_id}/select", {}).status_code
        == 200
    )
    with app.state.maker() as d:
        current = d.get(TranslationJob, job["id"])
        assert (
            read_config(settings, current.owner, current.model_config_id)["model"]
            == "MiniMax-M3"
        )
    assert (
        write(a, f"/translation-settings/configs/{first_id}", {}, "DELETE").status_code
        == 409
    )
    assert (
        write(b, f"/translation-settings/configs/{first_id}/select", {}).status_code
        == 404
    )


def test_invalid_json_repairs_only_unfinished_spans_with_markup_outside_model(
    tmp_path, monkeypatch
):
    import json

    from backend import translation_engine as engine

    source = tmp_path / "source"
    source.mkdir()
    (source / "main.tex").write_text(
        r"\documentclass{article}\begin{document}\section{Method}"
        + "\n\n"
        + r"The result uses \textbf{memory} and $x=2$."
        + "\n\n"
        + r"\end{document}"
    )
    calls = []

    def fake(config, system, content):
        value = json.loads(content)
        calls.append(value)
        if isinstance(value, list):
            return "invalid json"
        assert "selected_fragment" in value
        assert "__PW_KEEP_" not in value["selected_fragment"]
        return "中文片段"

    monkeypatch.setattr(engine, "complete", fake)
    units = engine.translate_project(source, tmp_path / "out", {}, lambda *args: None)
    assert len(units) == 2
    translated = "".join(u["translated_tex"] for u in units)
    assert r"\textbf{中文片段}" in translated
    assert "$x=2$" in translated
    assert sum(isinstance(x, list) for x in calls) == 3


def test_compile_error_identifies_undefined_command(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from backend import translation_engine as engine

    (tmp_path / "main.tex").write_text(
        r"\documentclass{article}\begin{document}Test\end{document}"
    )
    log = b"./main.tex:2: Undefined control sequence.\nl.2 \\pdfoutput\n =1\n"
    monkeypatch.setattr(
        engine.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(returncode=1, stdout=log, stderr=b""),
    )
    with pytest.raises(ValueError, match=r"未定义的 LaTeX 命令.*pdfoutput.*main.tex:2"):
        engine.compile_project(tmp_path)


def test_alignment_rejects_repeated_same_page_anchor():
    text = "A sufficiently long sentence repeated in a paper."
    assert locate(text, [text + "\n" + text]) is None
    assert locate(text, [text]) == {"page": 1, "quote": text}


def test_recover_alignment_from_unique_latex_anchors(tmp_path):
    from scripts.rebuild_translation_alignment import recover_archives

    def archive(name, body):
        path = tmp_path / name
        raw = body.encode()
        with tarfile.open(path, "w:gz") as t:
            info = tarfile.TarInfo("main.tex")
            info.size = len(raw)
            t.addfile(info, io.BytesIO(raw))
        return path

    source = archive(
        "source.tar.gz",
        r"The method follows prior work \cite{memory2025} and improves retrieval.",
    )
    target = archive(
        "target.tar.gz", r"该方法遵循先前工作 \cite{memory2025} 并改进检索。"
    )
    units = recover_archives(source, target)
    assert len(units) == 1
    assert "method" in units[0]["source_text"]
    assert "该方法" in units[0]["translated_text"]
    repeated = archive(
        "repeated.tar.gz",
        r"First paragraph \cite{memory2025}."
        + "\n\n"
        + r"Second paragraph \cite{memory2025}.",
    )
    assert recover_archives(repeated, target) == []


def test_batch_size_follows_what_was_measured_for_the_model():
    from backend.translation_engine import batch_policy

    assert batch_policy({"model": "some-model"}) == (3500, 5)
    assert batch_policy({"model": "MiniMax-M3"}) == (12000, 20)
    # Measured on a real 106-unit paper: 22 small requests took 46 s, 6 large
    # ones 52 s. Three requests run at once, so one long batch at the end costs
    # more than the requests it saves; M3.1 keeps the small batches.
    assert batch_policy({"model": "MiniMax-M3.1-Flash-Preview"}) == (3500, 5)
