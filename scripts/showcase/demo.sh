# Shared by build_demo.sh and reset_demo.sh (sourced, not run).
DEMO=${DEMO_DIR:-/tmp/zhijian-demo}
PORT=${DEMO_PORT:-8791}
WEB_ORIGIN=${DEMO_WEB:-http://127.0.0.1:5174}
PIDFILE=$DEMO/backend.pid

demo_env() {
  export DATABASE_URL="sqlite:///$DEMO/platform.db" STORAGE_DIR="$DEMO/files" PLATFORM_MODEL_CONFIG="$DEMO/platform-model.json" APP_ORIGIN="$WEB_ORIGIN"
}

stop_backend() {
  if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 1; fi
}

start_backend() {
  demo_env
  nohup .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --workers 1 > "$DEMO/backend.log" 2>&1 &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null && return 0; sleep 1; done
  echo "demo backend did not start; see $DEMO/backend.log" >&2
  return 1
}
