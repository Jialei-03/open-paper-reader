import fcntl
import sys
from pathlib import Path

from backend import pdf_structure as structure
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def test_structure_owner_failure_and_busy(env, monkeypatch):
    _app, a, b, settings = env
    p = paper(a)
    f = attach(a, p, "scan.pdf", pdf_bytes(False))
    url = f"/api/v1/files/{f['id']}/structure"
    body = {"page": 1, "model_config_id": "test"}
    monkeypatch.setenv("PDF_STRUCTURE_PYTHON", sys.executable)
    monkeypatch.setattr(
        structure, "read_config", lambda *args: {"vision": True, "model": "test-model"}
    )
    monkeypatch.setattr(
        structure,
        "recognize",
        lambda *args: {"blocks": [{"kind": "picture", "rect": [0.1, 0.2, 0.5, 0.3]}]},
    )
    assert b.get(url + "?page=1").status_code == 404
    assert b.post(url, json=body).status_code == 404
    assert a.post(url, json={**body, "page": 3000}).status_code == 422
    assert a.post(url, json=body).status_code == 202
    data = a.get(url + "?page=1").json()
    assert data["status"] == "completed"
    assert data["blocks"][0]["rect"] == [0.1, 0.2, 0.5, 0.3]
    assert a.get(url + "?page=2").json()["status"] == "idle"
    lockpath = Path(settings.storage).parent / "structure-cache" / "worker.lock"
    with lockpath.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert a.post(url, json=body).status_code == 409

    def failure(*args):
        raise ValueError("private credential details must not leak")

    monkeypatch.setattr(structure, "recognize", failure)
    assert a.post(url, json=body).status_code == 202
    data = a.get(url + "?page=1").json()
    assert data["status"] == "failed"
    assert "private" not in data["error"]
    monkeypatch.setattr(structure, "read_config", lambda *args: {})
    assert a.post(url, json=body).status_code == 422
