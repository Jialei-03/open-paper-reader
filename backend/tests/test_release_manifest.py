import pytest

from scripts.release_manifest import inventory, verify


def test_content_identity_detects_same_commit_drift_and_excludes_private_runtime(tmp_path):
    (tmp_path / "backend").mkdir()
    source = tmp_path / "backend/main.py"
    source.write_text("original")
    (tmp_path / ".env").write_text("private")
    (tmp_path / "data").mkdir()
    (tmp_path / "data/secret.key").write_text("private")
    snapshot = inventory(tmp_path)
    assert set(snapshot["files"]) == {"backend/main.py"}
    assert verify(tmp_path, snapshot) == snapshot["content_sha256"]
    source.write_text("online change")
    with pytest.raises(ValueError, match="backend/main.py"):
        verify(tmp_path, snapshot)
    source.write_text("original")
    (tmp_path / "backend/unreviewed.py").write_text("extra source")
    with pytest.raises(ValueError, match="unreviewed.py"):
        verify(tmp_path, snapshot)


def test_built_frontend_is_part_of_deployable_identity(tmp_path):
    directory = tmp_path / "frontend/dist"
    directory.mkdir(parents=True)
    source = directory / "index.html"
    source.write_text("tested build")
    snapshot = inventory(tmp_path, include_build=True)
    assert "frontend/dist/index.html" in snapshot["files"]
    source.write_text("different build")
    with pytest.raises(ValueError, match="index.html"):
        verify(tmp_path, snapshot)
