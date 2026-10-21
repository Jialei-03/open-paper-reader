#!/usr/bin/env bash
# What the desktop app carries in its Resources, built into desktop/bundle/:
#   python/         a relocatable CPython (uv's python-build-standalone) with the
#                   app's package (scripts/build-local.sh) and its dependencies
#   agent-runtime/  the assistant runtime with its npm dependencies
# The app runs `python/bin/python3 -m backend.local --desktop`, with its own
# Electron as Node for the runtime. Run from the repository root.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY_VERSION="${PY_VERSION:-3.12}"
out=desktop/bundle
rm -rf "$out" && mkdir -p "$out"

# The package, with the web app inside.
sh scripts/build-local.sh >/dev/null
wheel=$(ls dist/open_research-*.whl | head -n 1)

# A Python that keeps working wherever the .app is moved.
uv python install --quiet "$PY_VERSION"
interpreter=$(uv python find --managed-python "$PY_VERSION")
home=$(cd "$(dirname "$interpreter")/.." && pwd -P)
cp -R "$home" "$out/python"
# A standalone build is marked externally managed; this copy is the app's own.
rm -f "$out"/python/lib/python3*/EXTERNALLY-MANAGED
uv pip install --quiet --python "$out/python/bin/python3" "$wheel"
# Nothing of the build tooling or caches needs to ship.
find "$out/python" -name "__pycache__" -type d -prune -exec rm -rf {} +
rm -rf "$out"/python/lib/python3*/test "$out"/python/lib/python3*/idlelib "$out"/python/lib/python3*/tkinter

# The assistant runtime, its dependencies installed (no npm on the user's Mac).
mkdir -p "$out/agent-runtime"
cp agent-runtime/*.mjs agent-runtime/*.json "$out/agent-runtime/"
rm -f "$out/agent-runtime/runner.test.mjs"
cp -R agent-runtime/skills "$out/agent-runtime/skills"
npm --prefix "$out/agent-runtime" ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null

"$out/python/bin/python3" -m backend.local --version
du -sh "$out/python" "$out/agent-runtime"
