from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from backend import arxiv_import
from backend.import_progress import read, report, tracking


def test_progress_is_owner_scoped_and_tracks_real_stages(tmp_path):
    settings = SimpleNamespace(storage=str(tmp_path / "files"))
    token = str(uuid4())
    with tracking(settings, "alice", token):
        report("pdf", received=128, total=1024)
        assert read(settings, "alice", token)["received"] == 128
        assert read(settings, "bob", token)["stage"] == "waiting"
        report("saving")
        assert read(settings, "alice", token)["total"] is None
    assert read(settings, "alice", token)["stage"] == "done"
    with pytest.raises(HTTPException):
        read(settings, "alice", "../other")


def test_progress_failure_does_not_expose_exception_or_leak_context(tmp_path):
    settings = SimpleNamespace(storage=str(tmp_path / "files"))
    token = str(uuid4())
    with pytest.raises(ValueError), tracking(settings, "alice", token):
        raise ValueError("private path or credentials")
    assert read(settings, "alice", token)["stage"] == "failed"
    report("done")
    assert read(settings, "alice", token)["stage"] == "failed"
    assert "private" not in str(read(settings, "alice", token))


def test_download_does_not_hold_pacing_lock_during_transfer(monkeypatch):
    real_client = httpx.Client
    sleeps = []

    def respond(request):
        assert not arxiv_import._lock.locked()
        return httpx.Response(200, content=b"%PDF-small")

    monkeypatch.setattr(
        arxiv_import.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    monkeypatch.setattr(arxiv_import.time, "sleep", sleeps.append)
    monkeypatch.setattr(arxiv_import, "_last", 0)
    assert arxiv_import.download("/pdf/2504.19413v1") == b"%PDF-small"
    assert arxiv_import.download("/pdf/2504.19413v1") == b"%PDF-small"
    assert sleeps[0] == 0
    assert 0 < sleeps[1] <= 3


@pytest.mark.parametrize(
    "destination",
    [
        "https://arxiv.org:8080/pdf/2504.19413v1",
        "https://user:password@arxiv.org/pdf/2504.19413v1",
        "https://evil.example/pdf/2504.19413v1",
    ],
)
def test_download_rejects_unsafe_redirects(monkeypatch, destination):
    real_client = httpx.Client
    monkeypatch.setattr(
        arxiv_import.httpx,
        "Client",
        lambda **kwargs: real_client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(302, headers={"location": destination})
            ),
            **kwargs,
        ),
    )
    monkeypatch.setattr(arxiv_import.time, "sleep", lambda delay: None)
    with pytest.raises(ValueError, match="不受支持"):
        arxiv_import.download("/pdf/2504.19413v1")
