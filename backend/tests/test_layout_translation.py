import sys

import pytest

from backend import layout_translation


def fake_runtime(tmp_path, escaped=False):
    runtime = tmp_path / "runtime"
    runtime.write_text(
        f"#!{sys.executable}\n"
        "import sys,json,pathlib\n"
        "c=json.loads(sys.stdin.readline())\n"
        "assert 'api_key' not in json.dumps(c)\n"
        "print(json.dumps({'type':'translate','id':'request-1','text':'Hello'}),flush=True)\n"
        "r=json.loads(sys.stdin.readline());assert r['id']=='request-1' and r['text']=='你好'\n"
        + (
            "p=pathlib.Path(c['output_dir']).parent/'outside.pdf'\n"
            if escaped
            else "p=pathlib.Path(c['output_dir'])/'translated.pdf'\n"
        )
        + "p.write_bytes(b'%PDF-1.7\\nfixture')\n"
        "print(json.dumps({'type':'finish','pdf':str(p)}),flush=True)\n"
    )
    runtime.chmod(0o700)
    return runtime


def test_layout_bridge_keeps_model_credentials_in_parent(monkeypatch, tmp_path):
    calls = []

    def complete(config, system, content, **kwargs):
        calls.append((config["api_key"], content))
        return "你好"

    monkeypatch.setattr(layout_translation, "complete", complete)
    pdf, _ = layout_translation.translate_pdf(
        fake_runtime(tmp_path),
        tmp_path / "input.pdf",
        tmp_path / "out",
        {"api_key": "synthetic-secret"},
        lambda event: None,
        lambda: False,
    )
    assert pdf.parent == tmp_path / "out"
    assert calls == [("synthetic-secret", "Hello")]


def test_layout_bridge_opens_extensionless_stored_pdf(tmp_path):
    from pypdf import PdfWriter

    source = tmp_path / "opaque-file-id"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=300)
    writer.write(source)
    original = source.read_bytes()
    runtime = tmp_path / "pdf-runtime"
    runtime.write_text(
        f"#!{sys.executable}\n"
        "import sys,json,pathlib,shutil,pypdfium2\n"
        "c=json.loads(sys.stdin.readline());p=pathlib.Path(c['input_file'])\n"
        "assert p.suffix=='.pdf'\n"
        "d=pypdfium2.PdfDocument(p);assert len(d)==1;d.close()\n"
        "out=pathlib.Path(c['output_dir'])/'translated.pdf';shutil.copyfile(p,out)\n"
        "print(json.dumps({'type':'finish','pdf':str(out)}),flush=True)\n"
    )
    runtime.chmod(0o700)
    pdf, _ = layout_translation.translate_pdf(
        runtime, source, tmp_path / "out", {}, lambda _: None, lambda: False
    )
    assert pdf.read_bytes() == original
    assert source.read_bytes() == original


def test_layout_container_mounts_extensionless_source_as_readonly_pdf(
    monkeypatch, tmp_path
):
    import subprocess

    source = tmp_path / "opaque-file-id"
    source.write_bytes(b"%PDF-1.7\nfixture")
    runtime = tmp_path / "container-runtime"
    runtime.write_text(
        f"#!{sys.executable}\n"
        "import sys,json,pathlib\n"
        "c=json.loads(sys.stdin.readline());assert c['input_file']=='/input.pdf'\n"
        "p=pathlib.Path(c['output_dir'])/'translated.pdf';p.write_bytes(b'%PDF-1.7')\n"
        "print(json.dumps({'type':'finish','pdf':str(p)}),flush=True)\n"
    )
    runtime.chmod(0o700)
    calls = []
    popen = subprocess.Popen

    def launch(command, **kwargs):
        calls.append(command)
        return popen([str(runtime)], **kwargs)

    monkeypatch.setattr(layout_translation.subprocess, "Popen", launch)
    monkeypatch.setattr(layout_translation.subprocess, "run", lambda *a, **k: None)
    layout_translation.translate_pdf(
        None, source, tmp_path / "out", {}, lambda _: None, lambda: False,
        container_image="test-layout-image",
    )
    mounted = next(value for value in calls[0] if value.endswith("dst=/input.pdf,readonly"))
    staged = next((tmp_path / "out").glob("source-*.pdf"))
    assert mounted == f"type=bind,src={staged},dst=/input.pdf,readonly"
    assert staged.read_bytes() == source.read_bytes()
    assert staged.stat().st_mode & 0o777 == 0o600
    assert staged.stat().st_uid == layout_translation.os.getuid()
    assert calls[0][-1] == "test-layout-image"


def test_layout_bridge_rejects_output_outside_job(monkeypatch, tmp_path):
    monkeypatch.setattr(layout_translation, "complete", lambda *args, **kwargs: "你好")
    with pytest.raises(ValueError, match="输出不符合"):
        layout_translation.translate_pdf(
            fake_runtime(tmp_path, escaped=True),
            tmp_path / "input.pdf",
            tmp_path / "out",
            {},
            lambda event: None,
            lambda: False,
        )


@pytest.mark.parametrize("broken_status", [False, True])
def test_layout_bridge_cancels_idle_child_without_waiting_for_output(
    tmp_path, broken_status
):
    import time

    runtime = tmp_path / "slow-runtime"
    runtime.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(60)\n")
    runtime.chmod(0o700)
    start = time.monotonic()

    def cancelled():
        if broken_status:
            raise RuntimeError("status database unavailable")
        return True

    with pytest.raises(ValueError, match="已停止|无法确认"):
        layout_translation.translate_pdf(
            runtime,
            tmp_path / "input.pdf",
            tmp_path / "out",
            {},
            lambda event: None,
            cancelled,
        )
    assert time.monotonic() - start < 5


def test_layout_rejects_silent_partial_translation(tmp_path):
    import json

    from backend.layout_translation_worker import verify_tracking

    tracking = tmp_path / "tracking.json"
    data = {
        "page": [
            {
                "paragraph": [
                    {"input": "Translated text", "output": "已翻译"},
                    {"input": "Silently retained English", "output": None},
                ]
            }
        ]
    }
    tracking.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="1/2"):
        verify_tracking(tracking)
    data["page"][0]["paragraph"][1]["output"] = "已补全"
    tracking.write_text(json.dumps(data))
    assert verify_tracking(tracking) == 2
    tracking.write_text("{}")
    with pytest.raises(ValueError, match="不完整"):
        verify_tracking(tracking)


@pytest.mark.parametrize(
    "source, translated",
    [
        ("<b1>A scientific paragraph</b1>", "<b1>仅部分译文"),
        ("Equation {v1} and {v2}", "公式 {v1}"),
    ],
)
def test_layout_rejects_truncated_style_or_formula_markers(
    tmp_path, source, translated
):
    import json

    from backend.layout_translation_worker import verify_tracking

    tracking = tmp_path / "tracking.json"
    paragraph = {"input": source, "output": translated}
    data = {"page": [{"paragraph": [paragraph]}]}
    tracking.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="标记不一致"):
        verify_tracking(tracking)
    paragraph["output"] = source
    tracking.write_text(json.dumps(data))
    assert verify_tracking(tracking) == 1


def test_layout_worker_stops_after_valid_terminal_event(monkeypatch, tmp_path):
    import asyncio
    import json
    from types import ModuleType, SimpleNamespace

    from backend import layout_translation_worker as worker

    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-1.7")
    tracking = tmp_path / "tracking.json"
    tracking.write_text(
        json.dumps({"page": [{"paragraph": [{"input": "Hello", "output": "你好"}]}]})
    )
    events = []
    monkeypatch.setattr(worker, "emit", events.append)
    modules = {}
    for name in (
        "babeldoc",
        "babeldoc.format",
        "babeldoc.format.pdf",
        "babeldoc.format.pdf.high_level",
        "babeldoc.format.pdf.translation_config",
        "babeldoc.translator",
        "babeldoc.translator.translator",
    ):
        modules[name] = ModuleType(name)
        monkeypatch.setitem(sys.modules, name, modules[name])

    async def translate(config):
        yield {
            "type": "finish",
            "translate_result": SimpleNamespace(
                mono_pdf_path=tmp_path / "translated.pdf"
            ),
        }
        await asyncio.Event().wait()

    class Translator:
        def __init__(self, *args, **kwargs):
            pass

    modules["babeldoc.format.pdf.high_level"].ILTranslator = Translator
    modules["babeldoc.format.pdf.high_level"].ILTranslatorLLMOnly = Translator
    modules["babeldoc.format.pdf.high_level"].async_translate = translate
    modules["babeldoc.format.pdf.translation_config"].TranslationConfig = (
        lambda **kwargs: SimpleNamespace(get_working_file_path=lambda name: tracking)
    )
    modules[
        "babeldoc.format.pdf.translation_config"
    ].WatermarkOutputMode = SimpleNamespace(NoWatermark="none")
    modules["babeldoc.translator.translator"].BaseTranslator = Translator
    asyncio.run(
        asyncio.wait_for(
            worker.run({"input_file": str(source), "output_dir": str(tmp_path)}),
            timeout=1,
        )
    )
    assert events[-1]["type"] == "finish"
    assert events[-1]["translated_paragraphs"] == 1


def test_layout_stops_engine_exceeding_workspace_budget(tmp_path, monkeypatch):
    import time

    monkeypatch.setattr(layout_translation, "MAX_WORK_BYTES", 1024)
    runtime = tmp_path / "oversize-runtime"
    runtime.write_text(
        f"#!{sys.executable}\nimport json,sys,pathlib,time\n"
        "c=json.loads(sys.stdin.readline())\n"
        "(pathlib.Path(c['output_dir'])/'large.tmp').write_bytes(b'x'*2048)\n"
        "time.sleep(60)\n"
    )
    runtime.chmod(0o700)
    start = time.monotonic()
    with pytest.raises(ValueError, match="超过空间限制"):
        layout_translation.translate_pdf(
            runtime,
            tmp_path / "input.pdf",
            tmp_path / "out",
            {},
            lambda _: None,
            lambda: False,
        )
    assert time.monotonic() - start < 5


def test_workspace_guard_ignores_readonly_asset_links(tmp_path, monkeypatch):
    monkeypatch.setattr(layout_translation, "MAX_WORK_BYTES", 1024)
    assets = tmp_path / "asset"
    assets.write_bytes(b"x" * 2048)
    output = tmp_path / "out"
    output.mkdir()
    (output / "asset-link").symlink_to(assets)
    layout_translation.check_workspace(output)


def test_layout_cancel_closes_inflight_model_connection(monkeypatch, tmp_path):
    import socket
    import threading
    import time

    from backend import translation_settings

    received = threading.Event()
    disconnected = threading.Event()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(5)
    address = f"http://127.0.0.1:{listener.getsockname()[1]}"

    def upstream():
        with listener:
            connection, _ = listener.accept()
            with connection:
                connection.settimeout(5)
                raw = b""
                while b"\r\n\r\n" not in raw:
                    raw += connection.recv(8192)
                headers, body = raw.split(b"\r\n\r\n", 1)
                length = next(
                    int(line.split(b":", 1)[1])
                    for line in headers.lower().split(b"\r\n")
                    if line.startswith(b"content-length:")
                )
                while len(body) < length:
                    body += connection.recv(8192)
                received.set()
                if connection.recv(1) == b"":
                    disconnected.set()

    server = threading.Thread(target=upstream, daemon=True)
    server.start()
    monkeypatch.setattr(translation_settings, "validate_endpoint", lambda value: value)
    started = time.monotonic()
    with pytest.raises(ValueError, match="停止|未生成完整"):
        layout_translation.translate_pdf(
            fake_runtime(tmp_path),
            tmp_path / "input.pdf",
            tmp_path / "out",
            {"base_url": address, "model": "test", "api_key": "test-only"},
            lambda _: None,
            received.is_set,
        )
    server.join(timeout=2)
    assert received.is_set()
    assert disconnected.is_set(), "Cancellation must close the pending HTTP connection"
    assert time.monotonic() - started < 4


def test_layout_rejects_translated_code_constants(tmp_path):
    import json

    from backend.layout_translation_worker import verify_tracking

    tracking = tmp_path / "tracking.json"
    paragraph = {"input": 'M = {(id, f, "UPDATE")}', "output": 'M = {(id, f, "更新")}'}
    data = {"page": [{"paragraph": [paragraph]}]}
    tracking.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="代码常量"):
        verify_tracking(tracking)
    paragraph["output"] = paragraph["input"]
    tracking.write_text(json.dumps(data))
    assert verify_tracking(tracking) == 1


def test_cancellable_translation_retains_provider_options(monkeypatch):
    import httpx

    from backend import translation_settings

    real_client = httpx.AsyncClient
    requests = []

    async def respond(request):
        import json

        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": "译文"}}]
            },
        )

    monkeypatch.setattr(
        translation_settings.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond)),
    )
    config = {
        "base_url": "https://api.minimax.cn/v1",
        "api_key": "test-only",
        "model": "MiniMax-M3.1-Flash-Preview",
    }
    assert (
        translation_settings.complete(
            config, "Translate", "Text", cancelled=lambda: False
        )
        == "译文"
    )
    assert requests[0]["model"] == config["model"]
    assert requests[0]["max_completion_tokens"] == 32768
    with pytest.raises(ValueError, match="停止"):
        translation_settings.complete(
            config, "Translate", "Text", cancelled=lambda: True
        )
    assert len(requests) == 1


@pytest.mark.parametrize(
    "text", ["39.{v1}.38", "<b1>42</b1> ± 0.02", "{v1} = {v2} + 5", "2.1. {v1}"]
)
def test_symbol_only_translation_does_not_need_language_retry(text):
    from deploy.translation.patch_layout_quality import symbol_only

    assert symbol_only(text)


@pytest.mark.parametrize(
    "text",
    [
        "MemoryBank",
        "UPDATE",
        "M = {v1}",
        "The result is 42.",
        "结果",
        "Δx",
        "<b1>and</b1>",
    ],
)
def test_symbol_retry_exemption_does_not_hide_prose_or_identifiers(text):
    from deploy.translation.patch_layout_quality import symbol_only

    assert not symbol_only(text)
