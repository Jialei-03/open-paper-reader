"""LaTeX translation's TeX engine (Tectonic) installed on demand by the local build.
Nothing is downloaded and nothing is compiled: the release download is replaced
by a small archive holding a stand-in program."""

import io
import tarfile
import threading
import time
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import latex_install
from backend import translation_engine as engine
from backend import translation_worker as worker
from backend.config import Settings
from backend.main import create_app
from backend.models import Base

LOCAL_URL = "http://127.0.0.1:8765"


def make_client(tmp_path, mode):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
        origin=LOCAL_URL,
        mode=mode,
    )
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    c = TestClient(app, base_url=LOCAL_URL, client=("127.0.0.1", 50000))
    return app, settings, c


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.delenv("LATEX_TOOLS_DIR", raising=False)
    monkeypatch.setattr(latex_install, "release_asset", lambda: "https://example.invalid/tectonic.tar.gz")
    app, settings, c = make_client(tmp_path, "local")
    with c:
        c.get("/api/v1/auth/me")
        c.headers["X-CSRF-Token"] = c.cookies["paper_csrf"]
        yield settings, c
    app.state.engine.dispose()


def archive(script):
    """A release archive whose tectonic is the given shell script."""
    raw = io.BytesIO()
    body = ("#!/bin/sh\n" + script).encode()
    with tarfile.open(fileobj=raw, mode="w:gz") as t:
        info = tarfile.TarInfo("tectonic")
        info.size = len(body)
        info.mode = 0o755
        t.addfile(info, io.BytesIO(body))
    return raw.getvalue()


def serve(monkeypatch, raw):
    def fetch(url, write, cancelled, report):
        assert url == "https://example.invalid/tectonic.tar.gz"
        for start in range(0, len(raw), 64):
            write(raw[start : start + 64])
            report(min(start + 64, len(raw)), len(raw))

    monkeypatch.setattr(latex_install, "fetch", fetch)


def wait(c, *statuses):
    for _ in range(200):
        state = c.get("/api/v1/latex-install").json()
        if state["status"] in statuses:
            return state
        time.sleep(0.05)
    raise AssertionError(state)


def flags(c):
    body = c.get("/api/v1/translation-settings").json()
    return body["latex_translation_available"], body["latex_installable"]


def test_install_downloads_unpacks_and_warms_up_then_latex_is_available(local, monkeypatch):
    settings, c = local
    serve(monkeypatch, archive('echo "compiling $4"\n: > warmup.pdf\n'))
    before = c.get("/api/v1/latex-install").json()
    assert before["supported"] and not before["installed"] and not before["available"]
    assert flags(c) == (False, True)
    assert latex_install.latex_runtime(settings) is None

    started = c.post("/api/v1/latex-install")
    assert started.status_code == 200 and started.json()["status"] == "running"
    done = wait(c, "completed", "failed")
    assert done["status"] == "completed", done
    assert done["installed"] and done["available"] and done["progress"] == 100
    assert flags(c) == (True, False)

    folder = latex_install.tools_dir(settings)
    assert folder.parts[-2:] == ("tools", "tectonic")
    assert not folder.with_name("tectonic.partial").exists()
    assert latex_install.latex_runtime(settings) == str(folder / "tectonic")


def test_cancel_stops_the_download_and_leaves_nothing(local, monkeypatch):
    settings, c = local
    downloading = threading.Event()

    def fetch(url, write, cancelled, report):
        downloading.set()
        while not cancelled():
            write(b"x")
            report(1, 100)
            time.sleep(0.01)
        raise RuntimeError("cancelled")

    monkeypatch.setattr(latex_install, "fetch", fetch)
    c.post("/api/v1/latex-install")
    assert downloading.wait(5)
    assert c.get("/api/v1/latex-install").json()["stage"] == "download"
    assert c.post("/api/v1/latex-install/cancel").status_code == 200
    state = wait(c, "cancelled", "failed")
    assert state["status"] == "cancelled" and not state["installed"]
    folder = latex_install.tools_dir(settings)
    assert not folder.exists() and not folder.with_name("tectonic.partial").exists()


def test_a_failed_warm_up_reports_its_output(local, monkeypatch):
    _, c = local
    serve(monkeypatch, archive('echo "error: network unreachable"\nexit 1\n'))
    c.post("/api/v1/latex-install")
    state = wait(c, "failed", "completed")
    assert state["status"] == "failed" and "network unreachable" in state["error"]
    assert not state["installed"] and flags(c) == (False, True)


def test_a_local_latex_job_needs_tectonic(local):
    settings, c = local
    key = {"Idempotency-Key": str(uuid.uuid4())}
    c.put(
        "/api/v1/translation-settings",
        json={"base_url": "https://api.openai.com/v1", "model": "test", "api_key": "k"},
    )
    paper = c.post(
        "/api/v1/papers", json={"title": "Fixture", "external_id": "arxiv:2504.19413v1"}, headers=key
    ).json()
    refused = c.post(f"/api/v1/papers/{paper['id']}/translations", json={"engine": "latex"})
    assert refused.status_code == 409 and "Tectonic" in refused.json()["detail"]
    with pytest.raises(ValueError, match="Tectonic"):
        worker.compiler(settings)

    # Installed, the job is made; when arXiv has no source the list says so plainly.
    folder = latex_install.tools_dir(settings)
    folder.mkdir(parents=True)
    (folder / "tectonic").write_text("#!/bin/sh\n")
    (folder / "installed.json").write_text("{}")
    job = c.post(f"/api/v1/papers/{paper['id']}/translations", json={"engine": "latex"})
    assert job.status_code == 200 and job.json()["engine"] == "latex"
    from backend.arxiv_import import NO_SOURCE
    from backend.models import TranslationJob

    with c.app.state.maker() as d:
        row = d.get(TranslationJob, job.json()["id"])
        row.status, row.error = "failed", NO_SOURCE
        d.commit()
    [listed] = c.get(f"/api/v1/papers/{paper['id']}/translations").json()
    assert listed["no_source"] is True and listed["version_id"] == paper["current_version"]


def test_the_hosted_site_keeps_its_tex_image(tmp_path):
    app, settings, c = make_client(tmp_path, "cloud")
    with c:
        from backend.main import PASSWORD
        from backend.models import User

        with app.state.maker() as d:
            d.add(User(username="owner", password=PASSWORD.hash("Hosted-password-2026!")))
            d.commit()
        login = c.post(
            "/api/v1/auth/login",
            json={"username": "owner", "password": "Hosted-password-2026!"},
        )
        c.headers["X-CSRF-Token"] = login.json()["csrf"]
        assert c.get("/api/v1/latex-install").json()["supported"] is False
        assert c.post("/api/v1/latex-install").status_code == 409
        assert flags(c) == (True, False)
        assert latex_install.latex_runtime(settings) is None
        assert worker.compiler(settings) == {}
    app.state.engine.dispose()


def test_the_worker_compiles_with_tectonic_in_the_local_build(tmp_path, monkeypatch):
    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        storage=str(tmp_path / "files"),
        testing=True,
        mode="local",
    )
    folder = latex_install.tools_dir(settings)
    folder.mkdir(parents=True)
    (folder / "tectonic").write_text("#!/bin/sh\n")
    (folder / "installed.json").write_text("{}")
    chosen = worker.compiler(settings)
    assert chosen["tectonic"] == str(folder / "tectonic")
    assert "fixture-secret" not in str(chosen["tex_env"])

    project = tmp_path / "translated"
    project.mkdir()
    (project / "main.tex").write_text(
        r"\documentclass{article}\usepackage[UTF8]{ctex}\begin{document}中文\end{document}"
    )
    calls = []

    def run(command, **options):
        calls.append((command, options))
        (project / "build" / "main.pdf").write_bytes(b"%PDF-1.7")
        return SimpleNamespace(returncode=0, stdout=b"note: Writing main.pdf", stderr=b"")

    monkeypatch.setattr(engine.subprocess, "run", run)
    target = engine.compile_project(project, **chosen)
    assert target == project / "build" / "main.pdf"
    [(command, options)] = calls
    assert command[:5] == [chosen["tectonic"], "-X", "compile", "--untrusted", "--keep-logs"]
    assert command[-1] == "main.tex" and options["cwd"] == project
    assert options["env"] == chosen["tex_env"]
    # The same CJK fonts as the hosted image: ctex's Fandol set.
    assert r"\PassOptionsToPackage{fontset=fandol}{ctex}" in (project / "main.tex").read_text()


def test_a_missing_cjk_font_is_said_plainly(tmp_path, monkeypatch):
    (tmp_path / "main.tex").write_text(r"\documentclass{article}\begin{document}中文\end{document}")
    log = b'! Package fontspec Error: The font "FandolSong-Regular" cannot be found.\n'
    monkeypatch.setattr(
        engine.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stdout=log, stderr=b"")
    )
    with pytest.raises(ValueError, match="找不到字体 FandolSong-Regular"):
        engine.compile_project(tmp_path, tectonic="/opt/tectonic", tex_env={})


def test_release_files_for_each_computer():
    assert latex_install.release_asset("Darwin", "arm64").endswith(
        f"tectonic%40{latex_install.TECTONIC_VERSION}/tectonic-{latex_install.TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz"
    )
    assert latex_install.release_asset("Linux", "x86_64").endswith("x86_64-unknown-linux-musl.tar.gz")
    assert latex_install.release_asset("Windows", "AMD64").endswith("x86_64-pc-windows-msvc.zip")
    with pytest.raises(ValueError):
        latex_install.release_asset("Plan9", "mips")
