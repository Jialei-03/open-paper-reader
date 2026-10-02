import hashlib
import json
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

import pytest

from backend import ops_backup
from backend.cli import restore
from backend.config import Settings, database
from backend.models import Base
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import paper
from backend.tests.test_agents import configure


@pytest.fixture
def identity(tmp_path):
    if not shutil.which("age") or not shutil.which("age-keygen"):
        pytest.skip("age and age-keygen required for real encrypted recovery tests")
    key = tmp_path / "identity.txt"
    subprocess.run(["age-keygen", "-o", str(key)], check=True, capture_output=True)
    public = subprocess.run(
        ["age-keygen", "-y", str(key)], check=True, capture_output=True, text=True
    ).stdout.strip()
    return key, public


def test_encrypted_recovery_includes_private_config_and_checkpoints(
    env, tmp_path, monkeypatch, identity
):
    app, a, _, settings = env
    paper(a, "Recover this paper")
    credentials = tmp_path / "credentials"
    monkeypatch.setenv("TRANSLATION_CONFIG_DIR", str(credentials))
    owner, _ = configure(app, a, settings)
    platform = tmp_path / "platform.json"
    platform.write_text('{"api_key":"synthetic-platform-secret"}')
    monkeypatch.setenv("PLATFORM_MODEL_CONFIG", str(platform))
    deployment = tmp_path / "app.env"
    deployment.write_text("PRIVATE_SETTING=synthetic-deployment-secret\n")
    cache_id = str(uuid.uuid4())
    cache = Path(settings.storage).parent / "translation-work" / cache_id
    cache.mkdir(parents=True)
    (cache / "units.json").write_text('{"checkpoint":"translated text"}')
    key, public = identity
    encrypted = tmp_path / "recovery.age"
    result = ops_backup.package(settings, encrypted, public, deployment)
    assert result["files"] == 5
    assert b"synthetic" not in encrypted.read_bytes()
    assert encrypted.stat().st_mode & 0o777 == 0o600
    dest = tmp_path / "recovered"
    assert ops_backup.unpack(encrypted, key, dest)["verified"]
    assert (dest / "model-configs" / (owner + ".json")).read_bytes() == (
        credentials / (owner + ".json")
    ).read_bytes()
    assert (dest / "platform-model.json").read_bytes() == platform.read_bytes()
    assert (dest / "deployment/app.env").read_bytes() == deployment.read_bytes()
    assert (dest / f"translation-work/{cache_id}/units.json").read_bytes() == (
        cache / "units.json"
    ).read_bytes()
    restored = Settings(
        database_url="sqlite:///" + str(tmp_path / "restored.db"),
        storage=str(tmp_path / "restored-files"),
        testing=True,
    )
    engine, _ = database(restored)
    Base.metadata.create_all(engine)
    engine.dispose()
    assert restore(restored, dest / "workspace.zip")["papers"] == 1
    with pytest.raises(ValueError, match="must not exist"):
        ops_backup.unpack(encrypted, key, dest)
    before = encrypted.read_bytes()
    with pytest.raises(FileExistsError):
        ops_backup.package(settings, encrypted, public, deployment)
    assert encrypted.read_bytes() == before
    assert not list(tmp_path.glob(".paper-recovery-*"))
    assert not list(tmp_path.glob(".paper-decrypt-*"))


def test_wrong_key_and_tampering_leave_no_recovery_output(env, tmp_path, identity):
    _, _, _, settings = env
    key, public = identity
    encrypted = tmp_path / "recovery.age"
    ops_backup.package(settings, encrypted, public)
    wrong = tmp_path / "wrong.txt"
    subprocess.run(["age-keygen", "-o", str(wrong)], check=True, capture_output=True)
    dest = tmp_path / "recovered"
    with pytest.raises(ValueError, match="decryption failed"):
        ops_backup.unpack(encrypted, wrong, dest)
    damaged = bytearray(encrypted.read_bytes())
    damaged[-1] ^= 1
    encrypted.write_bytes(damaged)
    with pytest.raises(ValueError, match="decryption failed"):
        ops_backup.unpack(encrypted, key, dest)
    assert not dest.exists() and not list(tmp_path.glob(".paper-decrypt-*"))


@pytest.mark.parametrize(
    "name,bad_hash", [("../escape", False), ("platform-model.json", True)]
)
def test_authenticated_but_invalid_archive_rejected(tmp_path, identity, name, bad_hash):
    key, public = identity
    plain = tmp_path / "bad.zip"
    files = {"workspace.zip": b"placeholder", name: b"payload"}
    manifest = {
        "format": "paper-workspace-recovery",
        "version": 1,
        "files": {
            path: {
                "size": len(raw),
                "sha256": "0" * 64 if bad_hash else hashlib.sha256(raw).hexdigest(),
            }
            for path, raw in files.items()
        },
    }
    with zipfile.ZipFile(plain, "w") as archive:
        for path, raw in files.items():
            archive.writestr(path, raw)
        archive.writestr("manifest.json", json.dumps(manifest))
    encrypted = tmp_path / "bad.age"
    with plain.open("rb") as src, encrypted.open("wb") as out:
        ops_backup.age(["--encrypt", "--recipient", public], src, out)
    dest = tmp_path / "recovered"
    with pytest.raises(ValueError):
        ops_backup.unpack(encrypted, key, dest)
    assert not dest.exists() and not (tmp_path / "escape").exists()


def test_symlink_config_is_not_followed(env, tmp_path, monkeypatch, identity):
    _, _, _, settings = env
    secret = tmp_path / "secret"
    secret.write_text("not a model config")
    platform = tmp_path / "platform.json"
    platform.symlink_to(secret)
    monkeypatch.setenv("PLATFORM_MODEL_CONFIG", str(platform))
    output = tmp_path / "recovery.age"
    with pytest.raises(OSError):
        ops_backup.package(settings, output, identity[1])
    assert not output.exists()
