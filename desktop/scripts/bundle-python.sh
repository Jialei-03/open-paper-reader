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

# Git, for the projects' repositories (backend/research_repo.py): the portable
# build GitHub Desktop carries (dugite-native), so no Mac needs developer tools.
# Pinned with its published checksums. Git is GPL-2.0: its license comes along.
GIT_VERSION=v2.56.0
GIT_BUILD=a65444d
case "$(uname -m)" in
  arm64) git_arch=arm64; git_sha=dd1ed1ba1c1426e8117904b1eb233b1fbae43e1401e54de3c7c07b53c0cbf424 ;;
  x86_64) git_arch=x64; git_sha=14c4d59832c668e38b0d28d7d853d70e27d9bddc8204a662c9ceaddef71cf48d ;;
  *) echo "no portable git for $(uname -m)" >&2; exit 1 ;;
esac
git_tar="dugite-native-$GIT_VERSION-$GIT_BUILD-macOS-$git_arch.tar.gz"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/ora-build"
mkdir -p "$cache"
if [ ! -f "$cache/$git_tar" ] || ! echo "$git_sha  $cache/$git_tar" | shasum -a 256 -c - >/dev/null 2>&1; then
  curl -fsSL -o "$cache/$git_tar" \
    "https://github.com/desktop/dugite-native/releases/download/$GIT_VERSION/$git_tar"
fi
echo "$git_sha  $cache/$git_tar" | shasum -a 256 -c - >/dev/null
mkdir -p "$out/git"
tar -xzf "$cache/$git_tar" -C "$out/git"
# What research does not use: large files over LFS, credential helpers, docs, GUIs.
rm -rf "$out"/git/libexec/git-core/git-lfs "$out"/git/libexec/git-core/git-credential-manager* \
  "$out"/git/libexec/git-core/git-gui* "$out"/git/share/git-gui "$out"/git/share/gitk \
  "$out"/git/share/doc "$out"/git/share/man
# Git Credential Manager is a .NET program beside git's own helpers: everything
# in git-core that is not git's.
find "$out/git/libexec/git-core" -mindepth 1 -maxdepth 1 ! -name 'git*' ! -name scalar \
  ! -name mergetools -exec rm -rf {} +
# Git's license and where its source is (GPL-2.0).
curl -fsSL -o "$out/git/COPYING" "https://raw.githubusercontent.com/git/git/$GIT_VERSION/COPYING"
cat > "$out/git/SOURCE.txt" <<EOF_SOURCE
Git $GIT_VERSION, licensed under the GNU General Public License version 2 (COPYING).
Source: https://github.com/git/git/tree/$GIT_VERSION
This build: https://github.com/desktop/dugite-native/releases/tag/$GIT_VERSION
EOF_SOURCE
ORA_GIT_DIR="$out/git" "$out/git/bin/git" --version

"$out/python/bin/python3" -m backend.local --version
du -sh "$out/python" "$out/agent-runtime" "$out/git"
