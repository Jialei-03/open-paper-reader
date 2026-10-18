"""Papers that are hard to import: each is accepted, or refused with its reason.

The samples come from ``hard_pdfs`` and are made when the test runs. Uploads go
through the real media inspector subprocess; automatic preparation reads text
with the real PDFium extraction, so a page without a text layer is found the
way it would be in production; arXiv answers come from an ``httpx`` mock
transport, routed by path.
"""

import asyncio
import hashlib
import io
import json
import uuid
from pathlib import Path

import httpx
import pytest
from pypdf import PasswordType, PdfReader
from sqlalchemy import select

from backend import arxiv_import, preparation_worker
from backend.agent_tools import execute
from backend.models import (
    File,
    Paper,
    PaperPreparation,
    ReadingArtifact,
    TranslationJob,
    Version,
)
from backend.tests import hard_pdfs
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper, write

GENERIC = "Invalid, encrypted, oversized, or unsupported media"
NO_TEXT = "这篇论文没有文字层（可能是扫描版），自动导读需要 OCR；原文仍可阅读"


def upload(c, p, name, data):
    return c.post(
        "/api/v1/papers/" + p["id"] + "/files",
        data={"version_id": p["current_version"], "source_path": ""},
        files={"file": (name, data)},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )


# -- uploads ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "build", "mime", "pages"),
    [
        ("paper.pdf", hard_pdfs.text_pdf, "application/pdf", 3),
        ("paper.pdf", hard_pdfs.junk_prefixed_pdf, "application/pdf", 3),
        (
            "paper.pdf",
            lambda: hard_pdfs.owner_locked_pdf("AES-128"),
            "application/pdf",
            3,
        ),
        (
            "paper.pdf",
            lambda: hard_pdfs.owner_locked_pdf("RC4-128"),
            "application/pdf",
            3,
        ),
        ("scan.pdf", hard_pdfs.image_only_pdf, "application/pdf", 2),
        ("mixed.pdf", hard_pdfs.mixed_pdf, "application/pdf", 4),
        # A web page is still a valid attachment when it is not named as a PDF.
        ("notes.html", hard_pdfs.not_a_pdf, "application/octet-stream", None),
    ],
    ids=[
        "text",
        "junk_prefixed",
        "owner_locked_aes128",
        "owner_locked_rc4_128",
        "image_only",
        "mixed",
        "html_attachment",
    ],
)
def test_accepted(env, name, build, mime, pages):
    _app, a, _b, _settings = env
    r = upload(a, paper(a), name, build())
    assert r.status_code == 200, r.text
    assert r.json()["mime"] == mime
    assert r.json()["pages"] == pages


@pytest.mark.parametrize(
    ("name", "build", "detail"),
    [
        ("paper.pdf", hard_pdfs.password_pdf, "Encrypted PDF"),
        ("paper.pdf", hard_pdfs.truncated_pdf, "Unreadable PDF"),
        ("paper.pdf", hard_pdfs.not_a_pdf, "Not a PDF"),
        ("paper.pdf", hard_pdfs.many_pages_pdf, "Too many pages"),
        ("paper.pdf", lambda: b"", "Empty file"),
        # Images keep the message they had.
        ("figure.png", lambda: b"<script>not an image</script>", GENERIC),
    ],
    ids=["password", "truncated", "not_a_pdf", "too_many_pages", "empty", "bad_image"],
)
def test_refused_with_a_reason(env, name, build, detail):
    app, a, _b, _settings = env
    p = paper(a)
    r = upload(a, p, name, build())
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == detail
    with app.state.maker() as d:
        assert list(d.scalars(select(File))) == []


def call(app, owner, name, args):
    return asyncio.run(execute(app, owner, "session", name, args, "key", False))


@pytest.mark.parametrize("algorithm", ["AES-128", "RC4-128"])
def test_the_assistant_reads_an_owner_locked_paper(env, algorithm):
    app, a, _b, _settings = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    r = upload(a, paper(a), "locked.pdf", hard_pdfs.owner_locked_pdf(algorithm))
    assert r.status_code == 200, r.text
    f = r.json()
    read = call(app, owner, "read_file", {"id": f["id"], "page": 1, "pages": 3})
    assert [p["text"].strip() for p in read["pages"]] == [
        f"Evidence on page {n}" for n in (1, 2, 3)
    ]
    found = call(app, owner, "search_file", {"id": f["id"], "query": "page 2"})
    assert [m["page"] for m in found["matches"]] == [2]


def test_a_pdf_after_stray_bytes_works_like_any_other(env):
    """Accepted as a PDF, it must also read, render and share as one."""
    app, a, _b, _settings = env
    owner = a.get("/api/v1/auth/me").json()["user"]["id"]
    p = paper(a)
    raw = hard_pdfs.junk_prefixed_pdf()
    r = upload(a, p, "paper.pdf", raw)
    assert r.status_code == 200, r.text
    f = r.json()
    read = call(app, owner, "read_file", {"id": f["id"], "page": 2, "pages": 1})
    assert read["pages"][0]["text"].strip() == "Evidence on page 2"
    region = call(
        app,
        owner,
        "read_region",
        {"id": f["id"], "page": 2, "rect": [0.03, 0.09, 0.5, 0.06]},
    )
    assert region["text"] == "Evidence on page 2"
    assert call(app, owner, "list_figures", {"id": f["id"]})["total_pages"] == 3
    shown = call(app, owner, "view_image", {"id": f["id"], "page": 2})
    assert shown["images"][0]["page"] == 2
    note = next(n for n in a.get("/api/v1/items").json() if n["paper_id"] == p["id"])
    link = a.post(
        f"/api/v1/papers/{p['id']}/shares",
        json={"file_id": f["id"], "note_id": note["id"], "expires_days": 7},
    )
    assert link.status_code == 200, link.text
    shared = a.get("/api/v1/shared/" + link.json()["token"]).json()
    assert a.get(shared["pdf_url"]).content == raw


# -- automatic preparation ------------------------------------------------------

GUIDE = {
    "keywords": ["evidence"],
    "summary": ["一", "二", "三"],
    "sections": [
        {"title": t, "body": "正文", "pages": [1]}
        for t in ["研究问题", "方法", "主要结果", "适用边界"]
    ],
}


@pytest.fixture
def prepare(env, monkeypatch):
    """Prepare one uploaded PDF the way the worker does; return what was kept."""
    app, a, _b, settings = env
    maker = app.state.maker
    config = {
        "id": "test",
        "api_key": "test",
        "model": "test-model",
        "base_url": "https://api.openai.com/v1",
        "protocol": "openai",
    }
    monkeypatch.setattr(preparation_worker, "read_config", lambda *args: config)
    monkeypatch.setattr(preparation_worker, "bind", lambda cfg, *args: cfg)
    settings.pdf_layout_image = "test-image"
    asked = {"pages": [], "guide": []}

    def complete(cfg, system, content, **kwargs):
        if system.startswith("Translate each"):
            units = json.loads(content.split("\nPrevious result failed", 1)[0])
            asked["pages"].extend(u["original"] for u in units)
            return json.dumps(
                {
                    "sentences": [
                        {
                            "id": u["id"],
                            "kind": "text",
                            "translation": "译文 " + u["original"],
                        }
                        for u in units
                    ]
                },
                ensure_ascii=False,
            )
        assert not system.startswith("You translate one page"), "one-line pages split"
        asked["guide"].append(content)
        return json.dumps(GUIDE, ensure_ascii=False)

    monkeypatch.setattr("backend.translation_memory.complete", complete)

    def run(name, data):
        p = paper(a)
        r = upload(a, p, name, data)
        assert r.status_code == 200, r.text
        f = r.json()
        preparation_worker.reconcile(settings, maker)
        with maker() as d:
            row = d.scalar(select(PaperPreparation))
            row.status = "running"
            identifier = row.id
            # The layout PDF is another worker's job; here it is already done.
            d.add(
                TranslationJob(
                    arxiv_id="",
                    owner=row.owner,
                    paper_id=p["id"],
                    version_id=p["current_version"],
                    source_file=f["id"],
                    status="completed",
                )
            )
            d.commit()
        preparation_worker.process(settings, maker, identifier)
        with maker() as d:
            row = d.get(PaperPreparation, identifier)
            translated = {
                artifact.parameters["page"]: artifact.result
                for artifact in d.scalars(
                    select(ReadingArtifact).where(
                        ReadingArtifact.kind == "page_translation",
                        ReadingArtifact.status == "completed",
                    )
                )
            }
            guides = list(
                d.scalars(
                    select(ReadingArtifact).where(
                        ReadingArtifact.kind == "guide",
                        ReadingArtifact.status == "completed",
                    )
                )
            )
            return {
                "status": row.status,
                "error": row.error,
                "total": row.total,
                "completed": row.completed,
                "guide_status": row.guide_status,
                "translation_status": row.translation_status,
                "translated": translated,
                "guides": [guide.evidence_pages for guide in guides],
                "asked": asked,
            }

    return run


def test_a_text_pdf_prepares(prepare):
    done = prepare("paper.pdf", hard_pdfs.text_pdf())
    assert done["status"] == "completed", done
    assert done["error"] == ""
    assert (done["total"], done["completed"]) == (3, 3)
    assert sorted(done["translated"]) == [1, 2, 3]
    assert done["guides"] == [[1, 2, 3]]


def test_a_scan_fails_with_its_reason_and_does_not_stay_running(prepare):
    done = prepare("scan.pdf", hard_pdfs.image_only_pdf())
    assert done["status"] == "failed", done
    assert done["error"] == NO_TEXT
    assert done["translated"] == {}
    assert done["guides"] == []
    assert done["asked"] == {"pages": [], "guide": []}


def test_a_paper_with_one_scanned_page_prepares_the_others(prepare):
    done = prepare("mixed.pdf", hard_pdfs.mixed_pdf(text_pages=3, image_page=2))
    assert done["status"] == "completed", done
    assert done["error"] == ""
    assert done["guide_status"] == "completed"
    assert done["translation_status"] == "completed"
    # Page numbers stay the real ones: page 2 is skipped, not renumbered.
    assert (done["total"], done["completed"]) == (3, 3)
    assert sorted(done["translated"]) == [1, 3, 4]
    for number, result in done["translated"].items():
        assert [p["original"] for p in result["paragraphs"]] == [
            f"Evidence on page {number}"
        ]
    # The guide's evidence is the pages it was made from, not the scanned one.
    assert done["guides"] == [[1, 3, 4]]
    (guide,) = done["asked"]["guide"]
    assert "【第 2 页】" not in guide
    assert all(f"【第 {n} 页】\nEvidence on page {n}" in guide for n in (1, 3, 4))


# -- arXiv ------------------------------------------------------------------------

NOT_FOUND = "arXiv 上找不到这篇论文（或这个版本），请检查编号"
NO_PDF = "arXiv 没有提供这篇论文的 PDF，可能还在生成或只有网页版"
OFFLINE = "arXiv 下载连接中断或超时，已重试 3 次，请稍后重试"
PDF_FAILED = "原版 PDF 下载失败，请重试；未保存本次导入"


def feed(*versions):
    entries = "".join(
        f"<entry><id>http://arxiv.org/abs/{v}</id><title>Hard import sample</title>"
        "<summary>An abstract.</summary><author><name>A. Researcher</name></author>"
        "</entry>"
        for v in versions
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<feed xmlns="http://www.w3.org/2005/Atom">{entries}</feed>'
    ).encode()


@pytest.fixture
def arxiv(monkeypatch):
    """Answer arXiv requests by the first path segment: ``api``, ``abs`` or ``pdf``.

    A route is ``(status, body)``, or an exception class to raise for every request.
    """
    routes = {}
    seen = []
    real = httpx.Client

    def handler(request):
        kind = request.url.path.split("/")[1]
        seen.append(kind)
        answer = routes[kind]
        if isinstance(answer, type) and issubclass(answer, Exception):
            raise answer("arXiv is unreachable", request=request)
        status, body = answer
        return httpx.Response(status, content=body)

    def client(**options):
        options.pop("transport", None)
        options.pop("proxy", None)
        return real(transport=httpx.MockTransport(handler), **options)

    monkeypatch.setattr(arxiv_import.httpx, "Client", client)
    monkeypatch.setattr(arxiv_import.time, "sleep", lambda seconds: None)
    return routes, seen


def import_arxiv(c, value):
    return write(c, "/import/arxiv", {"url": value})


def nothing_kept(app):
    with app.state.maker() as d:
        assert list(d.scalars(select(Paper))) == []
        assert list(d.scalars(select(Version))) == []
        assert list(d.scalars(select(File))) == []


def test_an_arxiv_paper_imports(env, arxiv):
    app, a, _b, _settings = env
    routes, _seen = arxiv
    routes.update(api=(200, feed("2401.00001v2")), pdf=(200, hard_pdfs.text_pdf()))
    r = import_arxiv(a, "https://arxiv.org/abs/2401.00001")
    assert r.status_code == 200, r.text
    assert r.json()["external_id"] == "arxiv:2401.00001v2"
    with app.state.maker() as d:
        (f,) = d.scalars(select(File))
        assert (f.mime, f.pages) == ("application/pdf", 3)


@pytest.mark.parametrize(
    ("value", "api"),
    [
        ("https://arxiv.org/abs/2401.00001", feed()),
        ("https://arxiv.org/abs/2401.00001v9", feed("2401.00001v2")),
    ],
    ids=["no_such_paper", "no_such_version"],
)
def test_an_arxiv_paper_that_does_not_exist(env, arxiv, value, api):
    app, a, _b, _settings = env
    routes, seen = arxiv
    routes.update(api=(200, api), abs=(404, b"Not Found"))
    r = import_arxiv(a, value)
    assert (r.status_code, r.json()["detail"]) == (422, NOT_FOUND), r.text
    # A missing page is not asked for again.
    assert seen == ["api", "abs"]
    nothing_kept(app)


def test_arxiv_unreachable_while_reading_metadata(env, arxiv):
    app, a, _b, _settings = env
    routes, _seen = arxiv
    routes.update(api=httpx.ConnectError, abs=httpx.ConnectError)
    r = import_arxiv(a, "2401.00001")
    assert (r.status_code, r.json()["detail"]) == (422, OFFLINE), r.text
    nothing_kept(app)


def test_arxiv_has_no_pdf_for_the_paper(env, arxiv):
    app, a, _b, _settings = env
    routes, seen = arxiv
    routes.update(api=(200, feed("2401.00001v2")), pdf=(404, b"Not Found"))
    r = import_arxiv(a, "2401.00001")
    assert (r.status_code, r.json()["detail"]) == (422, NO_PDF), r.text
    assert seen == ["api", "pdf"]
    nothing_kept(app)


def test_arxiv_pdf_keeps_failing(env, arxiv):
    app, a, _b, _settings = env
    routes, seen = arxiv
    routes.update(api=(200, feed("2401.00001v2")), pdf=(503, b"Unavailable"))
    r = import_arxiv(a, "2401.00001")
    assert (r.status_code, r.json()["detail"]) == (502, PDF_FAILED), r.text
    assert seen == ["api", "pdf", "pdf", "pdf"]
    nothing_kept(app)


def test_arxiv_pdf_that_needs_a_password(env, arxiv):
    app, a, _b, _settings = env
    routes, _seen = arxiv
    routes.update(api=(200, feed("2401.00001v2")), pdf=(200, hard_pdfs.password_pdf()))
    r = import_arxiv(a, "2401.00001")
    assert (r.status_code, r.json()["detail"]) == (422, "Encrypted PDF"), r.text
    nothing_kept(app)


@pytest.mark.parametrize(
    ("missing", "reason"),
    [("pdf", arxiv_import.NO_PDF), ("src", arxiv_import.NO_SOURCE)],
    ids=["no_pdf", "no_latex_source"],
)
def test_translating_an_arxiv_paper_whose_file_is_missing(env, arxiv, missing, reason):
    """The paper exists; a 404 for one of its files says which file is missing."""
    from backend import translation_worker

    app, a, _b, settings = env
    routes, seen = arxiv
    routes.update(pdf=(200, hard_pdfs.text_pdf()), src=(404, b"Not Found"))
    routes[missing] = (404, b"Not Found")
    p = write(
        a,
        "/papers",
        {"title": "Translation sample", "external_id": "arxiv:2401.00001v2"},
    ).json()
    model = {
        "base_url": "https://api.openai.com/v1",
        "model": "test",
        "api_key": "test-key",
    }
    assert write(a, "/translation-settings", model, "PUT").status_code == 200
    job = write(a, f"/papers/{p['id']}/translations", {}).json()
    with app.state.maker() as d:
        d.get(TranslationJob, job["id"]).status = "running"
        d.commit()
    translation_worker.process(settings, app.state.maker, job["id"])
    with app.state.maker() as d:
        row = d.get(TranslationJob, job["id"])
        assert (row.status, row.error) == ("failed", reason)
    assert seen[-1] == missing


# -- exporting an owner-locked paper ----------------------------------------------

LOCKED_EXPORT = "这份 PDF 设有密码，无法导出带批注的版本"
LOCKED_MERGE = "原文或译文 PDF 设有密码，无法合并下载"


def permissions(raw):
    """The /P flags of an encrypted PDF, as 32 unsigned bits."""
    reader = PdfReader(io.BytesIO(raw))
    return int(reader.trailer["/Encrypt"].get_object()["/P"]) & 0xFFFFFFFF


def assert_protected_like(exported, source, pages):
    """Opens with an empty password, keeps the source's /P, has a new owner password."""
    reader = PdfReader(io.BytesIO(exported))
    assert reader.is_encrypted
    assert reader.decrypt("") != PasswordType.NOT_DECRYPTED
    assert permissions(exported) == permissions(source)
    assert [page.extract_text() for page in reader.pages] == pages
    again = PdfReader(io.BytesIO(exported))
    assert again.decrypt("publisher-owner") != PasswordType.OWNER_PASSWORD
    return reader


def replace_blob(app, settings, file_id, raw):
    """Put bytes the upload would refuse in place of a stored file."""
    (Path(settings.storage) / file_id).write_bytes(raw)
    with app.state.maker() as d:
        f = d.get(File, file_id)
        f.size = len(raw)
        f.sha256 = hashlib.sha256(raw).hexdigest()
        d.commit()


@pytest.mark.parametrize("algorithm", ["AES-128", "RC4-128"])
def test_annotated_export_of_an_owner_locked_paper_keeps_its_protection(env, algorithm):
    _app, a, _b, _settings = env
    source = hard_pdfs.owner_locked_pdf(algorithm)
    f = upload(a, paper(a), "locked.pdf", source).json()
    endpoint = "/api/v1/files/" + f["id"]
    highlight = {
        "page": 1,
        "quote": "Evidence on page 1",
        "color": "#FACC15",
        "comment": "Checked",
        "rects": [{"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.05}],
    }
    assert (
        a.put(f"{endpoint}/annotations/{uuid.uuid4()}", json=highlight).status_code
        == 200
    )
    exported = a.get(endpoint + "/annotated-pdf")
    assert exported.status_code == 200, exported.text
    reader = assert_protected_like(
        exported.content, source, [f"Evidence on page {n}" for n in (1, 2, 3)]
    )
    kinds = [x.get_object()["/Subtype"] for x in reader.pages[0]["/Annots"]]
    assert "/Highlight" in kinds


def test_annotated_export_of_a_pdf_that_needs_a_password_says_why(env):
    app, a, _b, settings = env
    f = upload(a, paper(a), "paper.pdf", hard_pdfs.text_pdf()).json()
    replace_blob(app, settings, f["id"], hard_pdfs.password_pdf())
    exported = a.get(f"/api/v1/files/{f['id']}/annotated-pdf")
    assert (exported.status_code, exported.json()["detail"]) == (422, LOCKED_EXPORT)


def merge_setup(env, source):
    app, a, _b, _settings = env
    p = paper(a)
    f = upload(a, p, "source.pdf", source).json()
    t = upload(a, p, "translated.pdf", hard_pdfs.text_pdf(2)).json()
    with app.state.maker() as d:
        job = TranslationJob(
            owner=d.get(File, f["id"]).owner,
            paper_id=p["id"],
            version_id=p["current_version"],
            arxiv_id="2401.00001v2",
            status="completed",
            source_file=f["id"],
            translated_file=t["id"],
        )
        d.add(job)
        d.commit()
        job_id = job.id
    return f, f"/api/v1/papers/{p['id']}/merged-pdf?translation_job_id={job_id}"


def test_merging_with_an_owner_locked_original_keeps_its_protection(env):
    _app, a, _b, _settings = env
    source = hard_pdfs.owner_locked_pdf("AES-128")
    _f, url = merge_setup(env, source)
    merged = a.get(url)
    assert merged.status_code == 200, merged.text
    assert_protected_like(
        merged.content,
        source,
        [f"Evidence on page {n}" for n in (1, 2, 3, 1, 2)],
    )


def test_merging_with_an_original_that_needs_a_password_says_why(env):
    app, a, _b, settings = env
    f, url = merge_setup(env, hard_pdfs.text_pdf())
    replace_blob(app, settings, f["id"], hard_pdfs.password_pdf())
    merged = a.get(url)
    assert (merged.status_code, merged.json()["detail"]) == (422, LOCKED_MERGE)


def test_a_plain_export_stays_unencrypted(env):
    _app, a, _b, _settings = env
    f = upload(a, paper(a), "paper.pdf", hard_pdfs.text_pdf()).json()
    exported = a.get(f"/api/v1/files/{f['id']}/annotated-pdf")
    assert exported.status_code == 200, exported.text
    assert not PdfReader(io.BytesIO(exported.content)).is_encrypted


def test_an_export_that_cannot_keep_the_protection_is_refused(monkeypatch):
    """Never hand out an unprotected copy of a protected source."""
    from pypdf.errors import DependencyError

    from backend import pdf_export_worker as worker

    def unavailable(self, *args, **kwargs):
        raise DependencyError("cryptography is required for AES")

    source = hard_pdfs.owner_locked_pdf("RC4-128")
    monkeypatch.setattr(worker.PdfWriter, "encrypt", unavailable)
    with pytest.raises(worker.Refused) as refused:
        worker.render(source, {"highlights": [], "ink": []})
    assert refused.value.reason == "protection"
    # A source without protection is not affected.
    plain = worker.render(hard_pdfs.text_pdf(), {"highlights": [], "ink": []})
    assert not PdfReader(io.BytesIO(plain)).is_encrypted
