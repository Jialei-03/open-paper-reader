#!/bin/sh
# Entry point of the container image: picks the process to run.
set -eu
role="${1:-web}"
case "$role" in
  web)
    # Create or update the schema first; the application never creates tables itself.
    alembic upgrade head
    exec uvicorn backend.main:app --host 0.0.0.0 --port "${APP_PORT:-8765}" --workers 1 --proxy-headers --no-access-log
    ;;
  worker)
    exec python -m backend.agent_worker
    ;;
  translation-worker)
    exec python -m backend.translation_worker
    ;;
  *)
    exec "$@"
    ;;
esac
