#!/usr/bin/env bash
# Rebuild the demo workspace from nothing: a fresh database and storage, a demo
# account with a small library of public arXiv papers and reading notes, and the
# real model outputs. Usage: scripts/showcase/build_demo.sh <content.json> <layout.pdf>
# A copy of the finished workspace is kept (reset_demo.sh puts it back), so a
# scene that goes wrong never costs a rebuild.
set -euo pipefail
cd "$(dirname "$0")/../.."
CONTENT=${1:?content.json from real_content.py}
LAYOUT=${2:?the translated PDF}
. scripts/showcase/demo.sh
stop_backend
rm -rf "$DEMO" "$DEMO.pristine" && mkdir -p "$DEMO/files"
# A made-up password for the throwaway demo account, kept next to the data.
(umask 077; .venv/bin/python -c "import secrets; print(secrets.token_urlsafe(18))" > "$DEMO/password")
export DEMO_PASSWORD="$(cat "$DEMO/password")"
cat > "$DEMO/platform-model.json" <<JSON
{"base_url": "https://api.minimax.cn/v1", "protocol": "openai", "model": "MiniMax-M3.1-Flash-Preview", "api_key": "demo-key-never-used", "vision": true, "enabled": true, "name": "MiniMax-M3.1-Flash-Preview",
 "models": [{"id": "platform-minimax-m3", "name": "MiniMax-M3", "model": "MiniMax-M3", "vision": true, "context_length": 1000000}]}
JSON
demo_env
.venv/bin/alembic upgrade head >/dev/null
start_backend
.venv/bin/python scripts/showcase/seed.py "http://127.0.0.1:$PORT"
DEMO_API="http://127.0.0.1:$PORT" .venv/bin/python scripts/showcase/fill_ai.py artifacts "$CONTENT"
DEMO_API="http://127.0.0.1:$PORT" .venv/bin/python scripts/showcase/fill_ai.py layout "$LAYOUT"
stop_backend
cp -a "$DEMO" "$DEMO.pristine"
start_backend
echo "demo workspace ready on :$PORT (user linyu); reset_demo.sh restores this state"
