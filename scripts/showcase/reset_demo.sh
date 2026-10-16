#!/usr/bin/env bash
# Put the demo workspace back to the state build_demo.sh left it in.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/showcase/demo.sh
[ -d "$DEMO.pristine" ] || { echo "no snapshot: run build_demo.sh first" >&2; exit 1; }
stop_backend
rm -rf "$DEMO" && cp -a "$DEMO.pristine" "$DEMO"
start_backend
echo "demo workspace reset"
