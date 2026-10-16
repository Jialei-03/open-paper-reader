import subprocess
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from pypdf import PdfWriter

from backend.pdf_text import extract_pdf_pages


def test_native_pdf_extraction_preserves_empty_pages_and_parallel_isolation(tmp_path):
    source = tmp_path / "blank.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=300)
    writer.add_blank_page(width=200, height=300)
    writer.write(source)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(extract_pdf_pages, [source, source]))
    assert results == [["", ""], ["", ""]]


def test_pdf_parse_failure_is_explicit(tmp_path):
    source = tmp_path / "broken.pdf"
    source.write_bytes(b"%PDF-1.7\nbroken")
    with pytest.raises(ValueError, match="未使用不完整正文"):
        extract_pdf_pages(source)


def test_pdf_parse_timeout_does_not_return_partial_text(tmp_path, monkeypatch):
    source = tmp_path / "timeout.pdf"
    source.touch()

    def timed_out(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"], output=b'["partial')

    monkeypatch.setattr("backend.pdf_text.subprocess.run", timed_out)
    with pytest.raises(ValueError, match="超时.*未使用不完整正文"):
        extract_pdf_pages(source, timeout=1)


def test_malformed_child_protocol_cannot_be_used(tmp_path, monkeypatch):
    source = tmp_path / "bad-result.pdf"
    source.touch()
    monkeypatch.setattr(
        "backend.pdf_text.subprocess.run",
        lambda *a, **k: SimpleNamespace(returncode=0, stdout=b'["text",null]'),
    )
    with pytest.raises(ValueError, match="结果无效"):
        extract_pdf_pages(source)
