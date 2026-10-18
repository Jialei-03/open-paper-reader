#!/usr/bin/env bash
# Build the open-paper-reader wheel and sdist into dist/ (see docs/LOCAL.md).
# The web app is built first because the wheel carries frontend/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix frontend run build
rm -rf dist
if command -v uv >/dev/null 2>&1; then
  uv build
else
  python3 -m pip install --quiet build
  python3 -m build
fi
ls -l dist
