import json

from backend.translation_worker import preserve_layout_diagnostics


def test_failed_layout_tracking_and_engine_logs_remain_private(tmp_path):
    layout = tmp_path / "layout"
    (layout / "work").mkdir(parents=True)
    tracking = layout / "work/translate_tracking.json"
    tracking.write_text('{"page": [{"paragraph": [{"input": "private text"}]}]}')
    (layout / "engine-test.log").write_text("private engine trace")
    (layout / "output.pdf").write_bytes(b"%PDF-1.7")
    preserve_layout_diagnostics(tmp_path)
    destination = tmp_path / "layout-diagnostics"
    manifest = json.loads((destination / "manifest.json").read_text())
    assert len(manifest) == 2
    assert all(record["retained"] for record in manifest)
    assert (destination / manifest[0]["file"]).read_text() == tracking.read_text()
    assert destination.stat().st_mode & 0o777 == 0o700
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in destination.iterdir())
    assert not list(destination.glob("*.pdf"))


def test_layout_diagnostics_exclude_symlinks_and_oversized_logs(tmp_path):
    layout = tmp_path / "layout"
    layout.mkdir()
    outside = tmp_path / "private-secret"
    outside.write_text("must not retain")
    (layout / "translate_tracking.json").symlink_to(outside)
    with (layout / "engine-large.log").open("wb") as stream:
        stream.truncate(2 * 1024**2 + 1)
    preserve_layout_diagnostics(tmp_path)
    destination = tmp_path / "layout-diagnostics"
    records = json.loads((destination / "manifest.json").read_text())
    assert records == [{"source": "engine-large.log", "bytes": 2097153, "retained": False}]
    assert list(destination.iterdir()) == [destination / "manifest.json"]
