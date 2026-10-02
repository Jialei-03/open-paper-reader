#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "${APP_PORT:-8765}" --workers 1
