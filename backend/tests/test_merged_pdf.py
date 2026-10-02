import hashlib
import io
import subprocess
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject

from backend.models import File, TranslationJob, Version
from backend.pdf_export import _EXPORT_SLOTS
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def setup_merge(env):
    app, a, _b, _settings = env
    p = paper(a)
    source = pdf_bytes()
    writer = PdfWriter()
    original = PdfReader(io.BytesIO(source))
    for page in reversed(original.pages[:3]):
        writer.add_page(page)
    writer.add_js("app.alert('never copied')")
    writer.pages[0][NameObject("/AA")] = DictionaryObject(
        {
            NameObject("/O"): DictionaryObject(
                {
                    NameObject("/S"): NameObject("/JavaScript"),
                    NameObject("/JS"): TextStringObject("evil()"),
                }
            )
        }
    )
    translated = io.BytesIO()
    writer.write(translated)
    f = attach(a, p, "source.pdf", source)
    t = attach(a, p, "translated.pdf", translated.getvalue())
    with app.state.maker() as d:
        file = d.get(File, f["id"])
        job = TranslationJob(
            owner=file.owner,
            paper_id=p["id"],
            version_id=file.version_id,
            arxiv_id="2501.00001",
            status="completed",
            source_file=f["id"],
            translated_file=t["id"],
            completed=12,
            total=12,
        )
        d.add(job)
        d.commit()
        job_id = job.id
    url = f"/api/v1/papers/{p['id']}/merged-pdf?translation_job_id={job_id}"
    return p, f, t, job_id, url, source, translated.getvalue()


def test_merged_pdf_real_page_order_safe_content_and_ownership(env):
    _, a, b, _ = env
    p, f, t, _job, url, source, translated = setup_merge(env)
    assert b.get(url).status_code == 404
    other = paper(a)
    assert a.get(url.replace(p["id"], other["id"])).status_code == 404
    expected = [p.extract_text() for p in PdfReader(io.BytesIO(source)).pages]
    translated_text = [
        p.extract_text() for p in PdfReader(io.BytesIO(translated)).pages
    ]
    for order, content in [
        ("original-first", expected + translated_text),
        ("translation-first", translated_text + expected),
    ]:
        response = a.get(url + "&order=" + order)
        assert response.status_code == 200, (
            response.text[:200] if response.status_code != 200 else ""
        )
        reader = PdfReader(io.BytesIO(response.content))
        assert [p.extract_text() for p in reader.pages] == content
        assert len(reader.pages) == 15
        assert "/OpenAction" not in reader.trailer["/Root"]
        assert "/Names" not in reader.trailer["/Root"]
        assert all("/AA" not in p and "/Annots" not in p for p in reader.pages)
        assert response.headers["content-disposition"].startswith("attachment;")
        assert "no-store" in response.headers["cache-control"]
    assert a.get("/api/v1/files/" + f["id"] + "/content").content == source
    assert a.get("/api/v1/files/" + t["id"] + "/content").content == translated
    assert a.get(url + "&order=invalid").status_code == 422


@pytest.mark.parametrize("status", ["queued", "running", "failed", "cancelled"])
def test_merged_requires_completed_job(env, status):
    app, a, _, _ = env
    _, _, _, job_id, url, _, _ = setup_merge(env)
    with app.state.maker() as d:
        d.get(TranslationJob, job_id).status = status
        d.commit()
    assert a.get(url).status_code == 409


def test_merged_rejects_version_mismatch_tampering_and_limits(env, monkeypatch):
    app, a, _, settings = env
    p, _f, t, _job_id, url, _, translated = setup_merge(env)
    with app.state.maker() as d:
        file = d.get(File, t["id"])
        old_version = file.version_id
        version = Version(owner=file.owner, paper_id=p["id"], label="v2")
        d.add(version)
        d.flush()
        file.version_id = version.id
        d.commit()
    assert a.get(url).status_code == 422
    with app.state.maker() as d:
        file = d.get(File, t["id"])
        file.version_id = old_version
        size = file.size
        file.size = 50 * 1024**2 + 1
        d.commit()
    assert a.get(url).status_code == 413
    with app.state.maker() as d:
        d.get(File, t["id"]).size = size
        d.commit()
    path = Path(settings.storage) / t["id"]
    path.write_bytes(b"%PDF-tampered")
    assert a.get(url).status_code == 404
    path.write_bytes(translated)
    _EXPORT_SLOTS.acquire()
    _EXPORT_SLOTS.acquire()
    try:
        assert a.get(url).status_code == 429
    finally:
        _EXPORT_SLOTS.release()
        _EXPORT_SLOTS.release()

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("pdf-export", 45)

    monkeypatch.setattr("backend.pdf_export.subprocess.run", timeout)
    assert a.get(url).status_code == 422


@pytest.mark.parametrize("encrypted", [True, False])
def test_merged_parser_rejects_encrypted_and_invalid_pdf(env, encrypted):
    app, a, _, settings = env
    _, _, t, _, url, _, _ = setup_merge(env)
    if encrypted:
        writer = PdfWriter()
        writer.add_blank_page(100, 100)
        writer.encrypt("secret")
        output = io.BytesIO()
        writer.write(output)
        raw = output.getvalue()
    else:
        raw = b"%PDF-not a parseable document"
    (Path(settings.storage) / t["id"]).write_bytes(raw)
    with app.state.maker() as d:
        file = d.get(File, t["id"])
        file.size = len(raw)
        file.sha256 = hashlib.sha256(raw).hexdigest()
        d.commit()
    assert a.get(url).status_code == 422
