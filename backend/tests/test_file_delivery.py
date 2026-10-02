from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import (
    env as env,  # noqa: PLC0414 - pytest fixture re-export
)


def test_file_ranges_cache_and_authorization(env):
    _, alice, bob, _ = env
    data = b"hello file content\n"
    record = attach(alice, paper(alice), data=data)
    url = f"/api/v1/files/{record['id']}/content"
    response = alice.get(url)
    assert response.content == data
    assert response.headers["cache-control"] == "private, no-cache"
    assert response.headers["accept-ranges"] == "bytes"
    etag = response.headers["etag"]
    partial = alice.get(url, headers={"Range": "bytes=2-6"})
    assert partial.status_code == 206
    assert partial.content == data[2:7]
    assert partial.headers["content-range"] == f"bytes 2-6/{len(data)}"
    assert alice.get(url, headers={"Range": "bytes=-4"}).content == data[-4:]
    assert alice.get(url, headers={"Range": "bytes=999-"}).status_code == 416
    for value in ("bytes=" + "9" * 5000 + "-", "bytes=-" + "9" * 5000):
        ignored = alice.get(url, headers={"Range": value})
        assert ignored.status_code == 200 and ignored.content == data
    stale = alice.get(url, headers={"Range": "bytes=2-6", "If-Range": '"stale"'})
    assert stale.status_code == 200 and stale.content == data
    cached = alice.get(url, headers={"If-None-Match": etag})
    assert cached.status_code == 304 and not cached.content
    assert bob.get(url, headers={"If-None-Match": etag}).status_code == 404
    head = alice.head(url)
    assert head.status_code == 200 and not head.content
    assert int(head.headers["content-length"]) == len(data)


def test_file_delivery_rejects_symlinks(env, tmp_path):
    _, alice, _, settings = env
    record = attach(alice, paper(alice))
    from pathlib import Path
    blob = Path(settings.storage) / record["id"]
    target = tmp_path / "secret"
    target.write_bytes(blob.read_bytes())
    blob.unlink()
    blob.symlink_to(target)
    assert alice.get(f"/api/v1/files/{record['id']}/content").status_code == 404


def test_offline_worker_has_javascript_type_and_revalidates(env):
    _, alice, _, _ = env
    worker = alice.get("/offline-worker.js")
    assert worker.status_code == 200
    assert "javascript" in worker.headers["content-type"]
    assert worker.headers["cache-control"] == "no-cache"
    assert "PREPARE" in worker.text
    manifest = alice.get("/assets/offline-manifest.json").json()
    assert manifest["files"] and all(path.startswith("/assets/") for path in manifest["files"])
