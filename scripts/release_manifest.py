"""Identify the exact source and frontend build, including uncommitted candidates.

No Git checkout or credentials are required on a release host. A commit label alone
cannot identify files changed after checkout; verify this manifest before switching
the production symlink. Runtime data, environment files and dependencies are excluded.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOTS = ("backend", "frontend/src", "frontend/public", "frontend/scripts", "frontend/e2e",
         "agent-runtime", "scripts", "deploy", "docs", ".github")
FILES = ("Dockerfile", "docker-compose.yml", "compose.yaml", "alembic.ini",
         "LICENSE", "NOTICE.md", "Makefile", "README.md", "README.en.md", ".env.example",
         ".nvmrc", "pytest.ini",
         "frontend/package.json", "frontend/package-lock.json", "frontend/index.html",
         "frontend/vite.config.ts", "frontend/tsconfig.json", "frontend/tsconfig.app.json",
         "frontend/playwright.config.ts", "frontend/components.json",
         "frontend/tsconfig.node.json", "agent-runtime/package.json",
         "agent-runtime/package-lock.json", "agent-runtime/tsconfig.json")
SKIP = {"__pycache__", "node_modules", ".DS_Store", ".pytest_cache"}


def inventory(root, include_build=False):
    root = Path(root).resolve()
    paths = {root / name for name in FILES if (root / name).is_file()}
    for name in (*ROOTS, *(("frontend/dist",) if include_build else ())):
        directory = root / name
        if directory.exists():
            paths.update(p for p in directory.rglob("*") if p.is_file()
                         and not SKIP.intersection(p.relative_to(root).parts)
                         and p.name not in {".env", "release-manifest.json"}
                         and p.suffix not in {".pyc", ".key", ".pem", ".age", ".log"})
    hashes = {}
    for path in sorted(paths):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Release input must be a regular file: " + str(path))
        hashes[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    digest = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"format": 1, "include_build": include_build, "content_sha256": digest, "files": hashes}


def verify(root, manifest):
    current = inventory(root, manifest["include_build"])
    if current != manifest:
        expected, actual = manifest["files"], current["files"]
        changes = sorted(name for name in expected.keys() | actual.keys()
                         if expected.get(name) != actual.get(name))
        raise ValueError("Release content differs: " + ", ".join(changes[:20]))
    return current["content_sha256"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--write", type=Path)
    parser.add_argument("--verify", type=Path)
    parser.add_argument("--include-build", action="store_true")
    args = parser.parse_args()
    if bool(args.write) == bool(args.verify):
        parser.error("choose exactly one of --write or --verify")
    if args.verify:
        print(verify(args.root, json.loads(args.verify.read_text())))
    else:
        result = inventory(args.root, args.include_build)
        args.write.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(result["content_sha256"])


if __name__ == "__main__":
    main()
