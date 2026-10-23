#!/bin/sh
# Entry point of the container image: picks the process to run.
set -eu
role="${1:-web}"
case "$role" in
  web)
    # Create or update the schema first; the application never creates tables itself.
    alembic -c pyproject.toml upgrade head
    exec uvicorn backend.main:app --host 0.0.0.0 --port "${APP_PORT:-8765}" --workers 1 --proxy-headers --no-access-log
    ;;
  worker)
    exec python -m backend.agent_worker
    ;;
  translation-worker)
    exec python -m backend.translation_worker
    ;;
  preparation-worker)
    exec python -m backend.preparation_worker
    ;;
  healthcheck-worker)
    # A worker opens no port. It holds an exclusive lock on this file for as long as
    # it runs (that is how a second worker is refused), so if the lock cannot be
    # taken, a worker is alive.
    exec python - "$(dirname "${STORAGE_DIR:-/data/files}")/${2:-agent}-worker.lock" <<'PY'
import errno
import fcntl
import sys

try:
    with open(sys.argv[1], "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError as error:
    sys.exit(0 if error.errno in {errno.EAGAIN, errno.EWOULDBLOCK} else 1)
sys.exit(1)
PY
    ;;
  *)
    exec "$@"
    ;;
esac
