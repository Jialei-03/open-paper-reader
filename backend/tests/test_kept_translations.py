"""Translations that were made are kept, and a newer one replaces the older."""

import io
from pathlib import Path

from pypdf import PdfWriter
from sqlalchemy import select

from backend import pdf_layout_jobs, translation_worker
from backend.models import (
    AgentRun,
    File,
    InkStroke,
    Paper,
    ReadingArtifact,
    TranslationJob,
    Version,
)
from backend.storage_budget import usage
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write
from backend.tests.test_direct_runs import (
    answer,
    finished,
    page_translation,
    paragraph,
    provider,
    work,
)
from backend.tests.test_pdf_layout_jobs import setup_pdf
from backend.tests.test_reading_artifacts import setup
from backend.translation_keep import supersede
from backend.translations import store_file

# --- selections -------------------------------------------------------------


def start_selection(a, session, p, f, model, quote, prompt="请将所选文字翻译成中文"):
    response = write(
        a,
        f"/agent/sessions/{session}/runs",
        {
            "prompt": prompt,
            "model_config_id": model,
            "reader_context": {
                "paper_id": p["id"],
                "file_id": f["id"],
                "page": 1,
                "source": "selection",
                "action": "translate",
                "quote": quote,
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def saved(a, f, quote):
    response = write(a, f"/files/{f['id']}/saved-translation", {"quote": quote})
    assert response.status_code == 200, response.text
    return response.json()["translation"]


def test_a_translated_selection_is_kept_and_a_new_one_replaces_it(env, monkeypatch):
    app, a, b, _settings, _owner, p, f, _endpoint, body = setup(env)
    session = write(a, "/agent/sessions", {}).json()["id"]
    quote = "Evidence on page 1"
    assert saved(a, f, quote) is None

    first = start_selection(a, session, p, f, body["model_config_id"], quote)
    # The failing run is tried twice (a busy provider gets one more chance).
    provider(monkeypatch, ["第一次的译文", 500, 500, "第二次的译文"])
    work(app, first["id"])
    assert saved(a, f, quote) == "第一次的译文"
    # Other spacing of the same words finds it; other words or another file do not.
    assert saved(a, f, "Evidence   on\npage 1") == "第一次的译文"
    assert saved(a, f, "Evidence on page 2") is None
    # Not the reader's other people.
    assert (
        b.post(
            f"/api/v1/files/{f['id']}/saved-translation", json={"quote": quote}
        ).status_code
        == 404
    )

    # A translation that fails leaves the kept one alone.
    failing = start_selection(
        a, session, p, f, body["model_config_id"], quote, "再译一次"
    )
    work(app, failing["id"])
    with app.state.maker() as d:
        assert d.get(AgentRun, failing["id"]).status == "failed"
    assert saved(a, f, quote) == "第一次的译文"

    # A new one replaces it in place: one row, newer text.
    second = start_selection(
        a, session, p, f, body["model_config_id"], quote, "重新翻译"
    )
    work(app, second["id"])
    assert saved(a, f, quote) == "第二次的译文"
    with app.state.maker() as d:
        rows = list(
            d.scalars(
                select(ReadingArtifact).where(
                    ReadingArtifact.kind == "text_translation"
                )
            )
        )
    assert len(rows) == 1 and rows[0].file_id == f["id"]
    # They are not among the paper's guides and page translations.
    listed = a.get(f"/api/v1/papers/{p['id']}/reading-artifacts").json()
    assert all(row["kind"] != "text_translation" for row in listed)


def test_only_a_translated_selection_is_kept(env, monkeypatch):
    app, a, _b, _settings, _owner, p, f, _endpoint, body = setup(env)
    session = write(a, "/agent/sessions", {}).json()["id"]
    run = write(
        a,
        f"/agent/sessions/{session}/runs",
        {
            "prompt": "解释",
            "model_config_id": body["model_config_id"],
            "reader_context": {
                "paper_id": p["id"],
                "file_id": f["id"],
                "page": 1,
                "source": "selection",
                "action": "explain",
                "quote": "Evidence on page 1",
            },
        },
    ).json()
    provider(monkeypatch, ["answer"])
    work(app, run["id"])
    assert saved(a, f, "Evidence on page 1") is None


# --- pages side by side -----------------------------------------------------


def test_a_regenerated_page_translation_overwrites_the_old_one(env, monkeypatch):
    app, a, _owner, p, f, row = page_translation(env, page=2)
    provider(
        monkeypatch,
        [
            answer(paragraph("Evidence on page 2", "旧译文")),
            answer(paragraph("Evidence on page 2", "新译文")),
        ],
    )
    work(app, row["run_id"])
    assert finished(a, row)["result"]["paragraphs"][0]["translation"] == "旧译文"
    # Reloading (another device) reads the same row without a new run.
    endpoint = f"/api/v1/papers/{p['id']}/reading-artifacts"
    body = {
        "file_id": f["id"],
        "model_config_id": row["model_config_id"],
        "kind": "page_translation",
        "page": 2,
    }
    again = a.post(endpoint, json=body).json()
    assert again["id"] == row["id"] and again["run_id"] == row["run_id"]
    assert again["status"] == "completed"

    regenerated = a.post(endpoint, json={**body, "regenerate": True}).json()
    assert regenerated["id"] == row["id"]
    work(app, regenerated["run_id"])
    assert finished(a, row)["result"]["paragraphs"][0]["translation"] == "新译文"
    with app.state.maker() as d:
        rows = list(
            d.scalars(
                select(ReadingArtifact).where(
                    ReadingArtifact.kind == "page_translation"
                )
            )
        )
    assert len(rows) == 1


def test_a_page_keeps_one_translation_when_another_model_made_a_newer_one(
    env, monkeypatch
):
    app, a, _owner, _p, _f, row = page_translation(env, page=2)
    with app.state.maker() as d:
        mine = d.get(ReadingArtifact, row["id"])
        sibling = ReadingArtifact(
            owner=mine.owner,
            paper_id=mine.paper_id,
            file_id=mine.file_id,
            version_id=mine.version_id,
            file_sha256=mine.file_sha256,
            cache_key="x" * 64,
            kind="page_translation",
            model_config_id="another-model",
            model="another",
            parameters={"page": 2, "language": "zh"},
            status="completed",
            result={"paragraphs": []},
        )
        other_page = ReadingArtifact(
            owner=mine.owner,
            paper_id=mine.paper_id,
            file_id=mine.file_id,
            version_id=mine.version_id,
            file_sha256=mine.file_sha256,
            cache_key="y" * 64,
            kind="page_translation",
            model_config_id="another-model",
            model="another",
            parameters={"page": 3, "language": "zh"},
            status="completed",
            result={"paragraphs": []},
        )
        d.add_all([sibling, other_page])
        d.commit()
    provider(monkeypatch, [answer(paragraph("Evidence on page 2", "译文"))])
    work(app, row["run_id"])
    with app.state.maker() as d:
        pages = sorted(
            r.parameters["page"]
            for r in d.scalars(
                select(ReadingArtifact).where(
                    ReadingArtifact.kind == "page_translation"
                )
            )
        )
    assert pages == [2, 3]


# --- full translations ------------------------------------------------------


def run_pdf_job(env, monkeypatch, paper, source, raw, outcome="success"):
    app, a, _, settings = env
    settings.pdf_layout_image = "fixture-layout"
    job = write(
        a,
        f"/papers/{paper['id']}/translations",
        {"engine": "pdf", "source_file_id": source},
    ).json()
    with app.state.maker() as d:
        d.get(TranslationJob, job["id"]).status = "running"
        d.commit()

    def translate(runtime, original, output, config, progress, cancelled, **kwargs):
        if outcome == "failure":
            raise ValueError("版面译文不完整")
        output.mkdir(parents=True)
        target = output / "result.pdf"
        target.write_bytes(raw + b"\n%" + job["id"].encode())
        return target, {}

    monkeypatch.setattr(pdf_layout_jobs, "translate_pdf", translate)
    translation_worker.process(settings, app.state.maker, job["id"])
    return job["id"]


def stored(settings, identifier):
    return (Path(settings.storage) / identifier).is_file()


def test_the_newest_finished_translation_replaces_the_previous_one(env, monkeypatch):
    app, a, _b, settings = env
    paper, source, raw = setup_pdf(env)
    listing = f"/api/v1/papers/{paper['id']}/translations"

    first = run_pdf_job(env, monkeypatch, paper, source, raw)
    with app.state.maker() as d:
        old_file = d.get(TranslationJob, first).translated_file
        before = usage(d, d.get(TranslationJob, first).owner)["papers"]
    assert old_file and stored(settings, old_file)

    # A re-run that fails changes nothing: the first stays, with the failure beside it.
    failed = run_pdf_job(env, monkeypatch, paper, source, raw, "failure")
    rows = {row["id"]: row for row in a.get(listing).json()}
    assert rows[first]["status"] == "completed" and rows[failed]["status"] == "failed"
    assert stored(settings, old_file)

    # A re-run that succeeds takes the first one's place, and the failure with it.
    third = run_pdf_job(env, monkeypatch, paper, source, raw)
    rows = a.get(listing).json()
    assert [row["id"] for row in rows] == [third]
    assert rows[0]["status"] == "completed"
    with app.state.maker() as d:
        new_file = d.get(TranslationJob, third).translated_file
        assert d.get(File, old_file) is None
        files = {
            f.id for f in d.scalars(select(File).where(File.paper_id == paper["id"]))
        }
        after = usage(d, d.get(TranslationJob, third).owner)["papers"]
    assert files == {source, new_file}
    assert (
        not stored(settings, old_file)
        and stored(settings, new_file)
        and stored(settings, source)
    )
    assert after <= before + 64  # one translation is counted, not two


def test_a_job_that_is_stopped_or_running_never_removes_anything(env, monkeypatch):
    app, a, _b, settings = env
    paper, source, raw = setup_pdf(env)
    first = run_pdf_job(env, monkeypatch, paper, source, raw)
    with app.state.maker() as d:
        old_file = d.get(TranslationJob, first).translated_file
    settings.pdf_layout_image = "fixture-layout"
    queued = write(
        a,
        f"/papers/{paper['id']}/translations",
        {"engine": "pdf", "source_file_id": source},
    ).json()
    assert supersede(settings, app.state.maker, queued["id"]) == []
    assert stored(settings, old_file)
    rows = a.get(f"/api/v1/papers/{paper['id']}/translations").json()
    assert {row["id"] for row in rows} == {first, queued["id"]}


def pdf(name):
    document = PdfWriter()
    document.add_blank_page(612, 792)
    document.add_metadata({"/Title": name})
    buffer = io.BytesIO()
    document.write(buffer)
    return buffer.getvalue()


def finished_job(d, paper, version, engine, name, *, settings, created, source=""):
    translated = store_file(d, settings, paper, version, name, pdf(name))
    job = TranslationJob(
        owner=paper.owner,
        paper_id=paper.id,
        version_id=version,
        arxiv_id="2504.19413v1" if engine == "latex" else "",
        engine=engine,
        status="completed",
        source_file=source,
        translated_file=translated.id,
        created_at=created,
    )
    d.add(job)
    d.flush()
    return job, translated.id


def test_a_newer_version_supersedes_older_versions_translations_per_engine(env):
    app, a, _b, settings = env
    paper = write(
        a, "/papers", {"title": "Versions", "external_id": "arxiv:2504.19413v1"}
    ).json()
    with app.state.maker() as d:
        p = d.get(Paper, paper["id"])
        v1 = p.current_version
        v2 = Version(owner=p.owner, paper_id=p.id, label="v2")
        d.add(v2)
        d.flush()
        old_latex, old_latex_file = finished_job(
            d,
            p,
            v1,
            "latex",
            "zh-v1.pdf",
            settings=settings,
            created="2026-01-01T00:00:00",
        )
        old_pdf, old_pdf_file = finished_job(
            d,
            p,
            v1,
            "pdf",
            "zh-pdf-v1.pdf",
            settings=settings,
            created="2026-01-01T00:00:01",
        )
        d.commit()
        v2_id = v2.id
        p.current_version = v2_id
        d.commit()
        owner = p.owner
        old_ids = (old_latex.id, old_pdf.id)
    # While the newer version has no finished translation, the old ones stay.
    assert {
        row["id"] for row in a.get(f"/api/v1/papers/{paper['id']}/translations").json()
    } == set(old_ids)
    with app.state.maker() as d:
        p = d.get(Paper, paper["id"])
        new_latex, new_latex_file = finished_job(
            d,
            p,
            v2_id,
            "latex",
            "zh-v2.pdf",
            settings=settings,
            created="2026-02-01T00:00:00",
        )
        d.commit()
        new_id = new_latex.id
    assert supersede(settings, app.state.maker, new_id) == [old_latex.id]
    ids = {
        row["id"] for row in a.get(f"/api/v1/papers/{paper['id']}/translations").json()
    }
    # The other engine is its own thing: its translation stays.
    assert ids == {new_id, old_pdf.id}
    assert (
        not stored(settings, old_latex_file)
        and stored(settings, new_latex_file)
        and stored(settings, old_pdf_file)
    )
    with app.state.maker() as d:
        assert d.get(File, old_latex_file) is None
        assert (
            d.get(File, new_latex_file) is not None
            and d.get(File, old_pdf_file) is not None
        )
        assert d.get(TranslationJob, new_id).owner == owner


def test_a_translation_with_the_readers_own_marks_is_not_removed(env):
    app, a, _b, settings = env
    paper = write(a, "/papers", {"title": "Marked"}).json()
    with app.state.maker() as d:
        p = d.get(Paper, paper["id"])
        old, old_file = finished_job(
            d,
            p,
            p.current_version,
            "pdf",
            "zh-old.pdf",
            settings=settings,
            created="2026-01-01T00:00:00",
        )
        new, _new_file = finished_job(
            d,
            p,
            p.current_version,
            "pdf",
            "zh-new.pdf",
            settings=settings,
            created="2026-02-01T00:00:00",
        )
        d.add(
            InkStroke(
                id="s" * 36,
                owner=p.owner,
                paper_id=p.id,
                file_id=old_file,
                page=1,
                data={},
                size=10,
            )
        )
        d.commit()
        old_id, new_id = old.id, new.id
    assert supersede(settings, app.state.maker, new_id) == []
    assert stored(settings, old_file)
    assert {
        row["id"] for row in a.get(f"/api/v1/papers/{paper['id']}/translations").json()
    } == {old_id, new_id}
