"""Offline encrypted recovery bundle. Never exposed through the web API."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

from .cli import backup
from .config import Settings

UUID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
ALLOWED = re.compile(
    rf"(?:workspace\.zip|deployment/app\.env|platform-model\.json|model-configs/{UUID}\.json|translation-work/{UUID}/(?:units\.json|units\.tmp|compile\.log))"
)
MAX_SIZE = 10 * 1024**3


def age(command, source, output):
    binary = shutil.which("age")
    if not binary:
        raise ValueError("Install age before creating or opening recovery bundles")
    result = subprocess.run(
        [binary, *command],
        stdin=source,
        stdout=output,
        stderr=subprocess.PIPE,
        timeout=900,
        check=False,
    )
    if result.returncode:
        raise ValueError(
            "age encryption/decryption failed; check the recipient or identity"
        )


def sources(settings, deployment_env=None):
    parent = Path(settings.storage).parent
    credentials = Path(
        os.getenv("TRANSLATION_CONFIG_DIR", str(parent / "translation-credentials"))
    )
    cache = parent / "translation-work"
    platform = Path(
        os.getenv("PLATFORM_MODEL_CONFIG", str(parent / "platform-model.json"))
    )
    for root in (credentials, cache):
        if root.is_symlink():
            raise ValueError("Recovery source directories cannot be symlinks")
    if credentials.exists():
        for path in credentials.glob("*.json"):
            if re.fullmatch(UUID + r"\.json", path.name):
                yield path, "model-configs/" + path.name
    if platform.exists() or platform.is_symlink():
        yield platform, "platform-model.json"
    if cache.exists():
        for directory in cache.iterdir():
            if not re.fullmatch(UUID, directory.name):
                continue
            if directory.is_symlink():
                raise ValueError("Recovery cache directories cannot be symlinks")
            for name in ("units.json", "units.tmp", "compile.log"):
                path = directory / name
                if path.exists() or path.is_symlink():
                    yield path, f"translation-work/{directory.name}/{name}"
    if deployment_env:
        yield Path(deployment_env), "deployment/app.env"


def package(settings, output, recipient, deployment_env=None):
    """Caller must stop all writers. Plaintext staging is private and temporary."""
    if not recipient.startswith("age1") or not recipient.isalnum():
        raise ValueError("Use an age1 public recipient, never a private identity")
    if not shutil.which("age"):
        raise ValueError("Install age before creating recovery bundles")
    output = Path(output)
    with tempfile.TemporaryDirectory(
        prefix=".paper-recovery-", dir=output.parent
    ) as work:
        workspace = Path(work) / "workspace.zip"
        backup(settings, workspace)
        bundle = Path(work) / "bundle.zip"
        manifest = {"format": "paper-workspace-recovery", "version": 1, "files": {}}
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, name in [
                (workspace, "workspace.zip"),
                *sources(settings, deployment_env),
            ]:
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, "rb") as source:
                    if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                        raise ValueError("Recovery inputs must be regular files")
                    digest, size = hashlib.sha256(), 0
                    with archive.open(name, "w", force_zip64=True) as dest:
                        while chunk := source.read(1024**2):
                            size += len(chunk)
                            if size > MAX_SIZE:
                                raise ValueError("Recovery member exceeds size limit")
                            digest.update(chunk)
                            dest.write(chunk)
                    if (
                        size + sum(row["size"] for row in manifest["files"].values())
                        > MAX_SIZE
                    ):
                        raise ValueError("Recovery bundle exceeds size limit")
                    manifest["files"][name] = {
                        "size": size,
                        "sha256": digest.hexdigest(),
                    }
            archive.writestr("manifest.json", json.dumps(manifest))
        fd = os.open(
            output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        try:
            with os.fdopen(fd, "wb") as dest, bundle.open("rb") as source:
                age(["--encrypt", "--recipient", recipient], source, dest)
                dest.flush()
                os.fsync(dest.fileno())
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    return {"files": len(manifest["files"]), "encrypted_bytes": output.stat().st_size}


def unpack(source, identity, destination):
    """Validate and stage recovery material; never modifies a live database or /etc."""
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("Recovery destination must not exist")
    if (
        source.stat().st_size > MAX_SIZE
        or shutil.disk_usage(destination.parent).free < source.stat().st_size + 1024**3
    ):
        raise ValueError("Encrypted bundle exceeds size limit")
    with tempfile.TemporaryDirectory(
        prefix=".paper-decrypt-", dir=destination.parent
    ) as work:
        decoded = Path(work) / "bundle.zip"
        with source.open("rb") as src, decoded.open("wb") as dest:
            age(["--decrypt", "--identity", str(identity)], src, dest)
        with zipfile.ZipFile(decoded) as archive:
            entries = archive.infolist()
            names = [row.filename for row in entries]
            if (
                len(entries) > 100000
                or len(names) != len(set(names))
                or "manifest.json" not in names
            ):
                raise ValueError("Invalid or duplicate recovery members")
            if archive.getinfo("manifest.json").file_size > 20 * 1024**2:
                raise ValueError("Recovery manifest exceeds size limit")
            total = sum(row.file_size for row in entries)
            if (
                total > MAX_SIZE
                or shutil.disk_usage(destination.parent).free < total + 1024**3
            ):
                raise ValueError("Recovery exceeds available space or size limit")
            manifest = json.loads(archive.read("manifest.json"))
            if (
                not isinstance(manifest, dict)
                or manifest.get("format") != "paper-workspace-recovery"
                or manifest.get("version") != 1
            ):
                raise ValueError("Unsupported recovery format")
            expected = manifest.get("files", {})
            if (
                not isinstance(expected, dict)
                or "workspace.zip" not in expected
                or set(expected) != set(names) - {"manifest.json"}
            ):
                raise ValueError("Recovery manifest does not match archive")
            for row in entries:
                if row.filename == "manifest.json":
                    continue
                if not ALLOWED.fullmatch(row.filename) or stat.S_ISLNK(
                    row.external_attr >> 16
                ):
                    raise ValueError("Unsafe recovery member")
            for description in expected.values():
                if (
                    not isinstance(description, dict)
                    or type(description.get("size")) is not int
                    or description["size"] < 0
                    or not re.fullmatch(
                        r"[0-9a-f]{64}", str(description.get("sha256", ""))
                    )
                ):
                    raise ValueError("Invalid recovery member metadata")
            destination.mkdir(mode=0o700)
            try:
                for name, description in expected.items():
                    path = destination / name
                    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    digest, size = hashlib.sha256(), 0
                    fd = os.open(
                        path,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                    )
                    with os.fdopen(fd, "wb") as dest, archive.open(name) as src:
                        while chunk := src.read(1024**2):
                            digest.update(chunk)
                            size += len(chunk)
                            dest.write(chunk)
                    if (
                        size != description["size"]
                        or digest.hexdigest() != description["sha256"]
                    ):
                        raise ValueError("Recovery member checksum mismatch")
            except BaseException:
                shutil.rmtree(destination)
                raise
    return {"files": len(expected), "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("output")
    create.add_argument("--recipient", required=True)
    create.add_argument("--deployment-env")
    create.add_argument("--offline", action="store_true", required=True)
    recover = sub.add_parser("unpack")
    recover.add_argument("source")
    recover.add_argument("destination")
    recover.add_argument("--identity", required=True)
    args = parser.parse_args()
    if args.command == "create":
        result = package(
            Settings.env(), args.output, args.recipient, args.deployment_env
        )
    else:
        result = unpack(args.source, args.identity, args.destination)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
