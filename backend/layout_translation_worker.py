"""Optional BabelDOC subprocess. Model calls are delegated to the parent, never keyed here.

Run with the separate, pinned layout runtime. One JSON configuration line is
followed by translation replies. Stdout is JSONL progress/requests/results only.
This is an internal worker protocol, not an externally exposed endpoint.
"""

import ast
import asyncio
import contextlib
import json
import os
import queue
import re
import sys
import threading
import uuid
from collections import Counter
from pathlib import Path

OUTPUT = sys.stdout
WRITE_LOCK = threading.Lock()
PENDING_LOCK = threading.Lock()
PENDING = {}


def cpu_layout_model():
    """Use one CPU thread and avoid retaining large ONNX allocation arenas."""
    import onnxruntime
    from babeldoc.assets.assets import get_doclayout_onnx_model_path
    from babeldoc.docvision.doclayout import OnnxModel

    class BoundedModel(OnnxModel):
        def __init__(self, path):
            self.model_path = str(path)
            self.lock = threading.Lock()
            self.load_session()

        def load_session(self):
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            options.enable_cpu_mem_arena = False
            options.enable_mem_pattern = False
            # Load directly from file, without keeping a second ONNX protobuf
            # plus its serialized bytes alongside the inference session.
            self.model = onnxruntime.InferenceSession(
                self.model_path,
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
            metadata = self.model.get_modelmeta().custom_metadata_map
            self._stride = ast.literal_eval(metadata["stride"])
            self._names = ast.literal_eval(metadata["names"])

        def predict(self, *args, **kwargs):
            result = super().predict(*args, **kwargs)
            # ONNX image tensors are temporary, but glibc retains their arenas
            # across pages. Return these freed arenas before the next page.
            import gc

            gc.collect()
            if sys.platform == "linux":
                import ctypes

                ctypes.CDLL(None).malloc_trim(0)
            return result

        def handle_document(self, *args, **kwargs):
            if self.model is None:
                self.load_session()
            try:
                yield from super().handle_document(*args, **kwargs)
            finally:
                # Layout is complete before tokenization/typesetting. Keeping
                # the ONNX weights resident during these stages wastes memory.
                import gc

                self.model = None
                gc.collect()
                if sys.platform == "linux":
                    import ctypes

                    ctypes.CDLL(None).malloc_trim(0)

    return BoundedModel(get_doclayout_onnx_model_path())


def verify_tracking(path):
    """BabelDOC may return a PDF after silently retaining failed paragraphs."""
    tracking = json.loads(Path(path).read_text())
    total = missing = damaged = changed_constants = 0
    for group in ("page", "cross_page", "cross_column"):
        for page in tracking.get(group, []):
            for paragraph in page.get("paragraph", []):
                if not (paragraph.get("input") or "").strip():
                    continue
                total += 1
                if not (paragraph.get("output") or "").strip():
                    missing += 1
                else:
                    source_tokens = placeholder_counts(paragraph["input"])
                    target_tokens = placeholder_counts(paragraph["output"])
                    if code_constants(paragraph["input"]) != code_constants(
                        paragraph["output"]
                    ):
                        changed_constants += 1
                    if source_tokens != target_tokens:
                        damaged += 1
    if not total or missing:
        raise ValueError(f"版面译文不完整：{missing}/{total} 个段落未返回译文")
    if damaged:
        raise ValueError(
            f"版面译文不完整：{damaged}/{total} 个段落的公式或样式标记不一致"
        )
    if changed_constants:
        raise ValueError(
            f"版面译文不完整：{changed_constants}/{total} 个段落的代码常量发生变化"
        )
    return total


def code_constants(text):
    # Uppercase quoted literals are code/data values, not prose to localize.
    return Counter(re.findall(r"[\"']([A-Z][A-Z0-9_]{1,40})[\"']", text))


def placeholder_counts(text):
    return Counter(
        re.sub(r"\s+", "", match.group()).lower()
        for match in re.finditer(
            r"<\s*/?\s*b\s*\d+\s*>|\{\s*v\s*\d+\s*\}", text, re.IGNORECASE
        )
    )


def emit(value):
    with WRITE_LOCK:
        OUTPUT.write(json.dumps(value, ensure_ascii=False) + "\n")
        OUTPUT.flush()


def replies():
    buffer = b""
    while True:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        buffer += chunk
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            if len(raw) > 1024 * 1024:
                return
            try:
                value = json.loads(raw)
                with PENDING_LOCK:
                    waiter = PENDING.get(value.get("id"))
                if waiter is not None:
                    waiter.put(value)
            except (ValueError, AttributeError):
                continue
        if len(buffer) > 1024 * 1024:
            break
    with PENDING_LOCK:
        for waiter in PENDING.values():
            waiter.put({"error": "模型连接已结束"})


def model_request(text, structured):
    if not isinstance(text, str) or len(text.encode()) > 512 * 1024:
        raise ValueError("翻译段落超出限制")
    identifier = str(uuid.uuid4())
    waiter = queue.Queue()
    with PENDING_LOCK:
        PENDING[identifier] = waiter
    try:
        emit(
            {
                "type": "translate",
                "id": identifier,
                "text": text,
                "structured": structured,
            }
        )
        value = waiter.get(timeout=600)
        if value.get("error"):
            raise ValueError(value["error"])
        answer = value.get("text")
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("模型未返回翻译")
        return answer
    finally:
        with PENDING_LOCK:
            PENDING.pop(identifier, None)


def document_worker_count(document):
    """The finite document workload sets concurrency, rather than an account cap."""
    return max(1, sum(len(page.pdf_paragraph) for page in document.page))


def install_document_dispatch(high_level):
    # BabelDOC requires an integer pool size. Compute it after parsing, when
    # the actual paragraph workload is known; do not use an arbitrary ceiling.
    for name in ("ILTranslator", "ILTranslatorLLMOnly"):
        original = getattr(high_level, name)

        class DocumentTranslator(original):
            def translate(self, document):
                self.translation_config.pool_max_workers = document_worker_count(
                    document
                )
                return super().translate(document)

        setattr(high_level, name, DocumentTranslator)


async def run(config):
    emit({"type": "progress_start", "stage": "准备版面引擎"})
    assets = os.environ.get("PAPER_LAYOUT_ASSETS")
    if assets:
        # Public assets stay read-only. The image patches BabelDOC's cache root
        # to this per-job path, so its import-time SQLite cache is never shared.
        cache = Path(os.environ["PAPER_LAYOUT_CACHE"])
        cache.mkdir(parents=True, exist_ok=True)
        for directory in Path(assets).iterdir():
            if directory.is_dir():
                link = cache / directory.name
                if link.is_symlink() and link.resolve() == directory.resolve():
                    continue
                link.symlink_to(directory, target_is_directory=True)
    from babeldoc.format.pdf import high_level

    install_document_dispatch(high_level)
    async_translate = high_level.async_translate
    from babeldoc.format.pdf.translation_config import (
        TranslationConfig,
        WatermarkOutputMode,
    )
    from babeldoc.translator.translator import BaseTranslator

    class BridgeTranslator(BaseTranslator):
        name = "paper-workspace"
        model = "parent-selected"

        def __init__(self):
            # No translation text is shared through BabelDOC's global cache.
            super().__init__("en", "zh", ignore_cache=True)

        def translate(self, text, ignore_cache=False, rate_limit_params=None):
            # Parent owns upstream retries; bypass BabelDOC's global QPS gate.
            self.translate_call_count += 1
            return self.do_translate(text, rate_limit_params)

        def llm_translate(self, text, ignore_cache=False, rate_limit_params=None):
            self.translate_call_count += 1
            return self.do_llm_translate(text, rate_limit_params)

        def do_translate(self, text, rate_limit_params=None):
            return model_request(text, False)

        def get_formular_placeholder(self, identifier):
            # Distinct formula tokens avoid models "closing" standalone <bN>
            # tokens as though they were formatting tags. BabelDOC's LLM path
            # also requires both a literal token and its recognition pattern.
            return "{v" + str(identifier) + "}", r"\{\s*v\s*" + str(
                identifier
            ) + r"\s*\}"

        def get_rich_text_left_placeholder(self, identifier):
            return f"<b{identifier}>", r"<\s*b\s*" + str(identifier) + r"\s*>"

        def get_rich_text_right_placeholder(self, identifier):
            return f"</b{identifier}>", r"<\s*/\s*b\s*" + str(identifier) + r"\s*>"

        def do_llm_translate(self, text, rate_limit_params=None):
            # BabelDOC probes LLM support with None before dispatching text.
            if text is None:
                return None
            return model_request(text, True)

    input_file = Path(config["input_file"]).resolve(strict=True)
    output = Path(config["output_dir"]).resolve()
    if input_file.stat().st_size > 50 * 1024**2:
        raise ValueError("PDF 超出 50 MB")
    options = TranslationConfig(
        translator=BridgeTranslator(),
        input_file=input_file,
        lang_in="en",
        lang_out="zh",
        doc_layout_model=cpu_layout_model() if assets else None,
        pages=config.get("pages"),
        output_dir=output,
        working_dir=output / "work",
        no_dual=True,
        use_rich_pbar=False,
        auto_extract_glossary=False,
        watermark_output_mode=WatermarkOutputMode.NoWatermark,
        only_include_translated_page=True,
        report_interval=1,
    )
    options.paper_batch_tokens = max(
        200, min(4000, int(config.get("batch_tokens", 1000)))
    )
    async for event in async_translate(options):
        if event["type"] == "finish":
            result = event["translate_result"]
            try:
                paragraphs = verify_tracking(
                    options.get_working_file_path("translate_tracking.json")
                )
            except ValueError as error:
                emit({"type": "error", "error": str(error)[:500]})
                raise
            emit(
                {
                    "type": "finish",
                    "pdf": str(result.mono_pdf_path),
                    "seconds": getattr(result, "total_seconds", None),
                    "memory_mb": getattr(result, "peak_memory_usage", None),
                    "translated_paragraphs": paragraphs,
                }
            )
            # 0.6.4's event iterator can remain open after its terminal event.
            # Do not await another progress event after output validation.
            return
        elif event["type"] == "error":
            emit(
                {
                    "type": "error",
                    "error": str(event.get("error", "版面翻译失败"))[:500],
                }
            )
            raise RuntimeError("版面翻译失败")
        else:
            progress = {
                key: value
                for key, value in event.items()
                if key
                in {
                    "type",
                    "stage",
                    "stage_current",
                    "stage_total",
                    "overall_progress",
                }
            }
            if assets and event["type"] == "progress_start":
                memory = Path("/sys/fs/cgroup/memory.current")
                if memory.is_file():
                    progress["container_memory_mb"] = int(memory.read_text()) / 1024**2
            emit(progress)


def main():
    raw = sys.stdin.buffer.readline(65537)
    if len(raw) > 65536:
        raise ValueError("Invalid worker configuration")
    config = json.loads(raw)
    threading.Thread(target=replies, daemon=True).start()
    # Keep library logging/print output out of the structured protocol.
    with contextlib.redirect_stdout(sys.stderr):
        asyncio.run(run(config))


if __name__ == "__main__":
    main()
