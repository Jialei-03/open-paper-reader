#!/bin/sh
# Check that the assistant runtime can load its dependencies, e.g. before starting
# the worker or switching to a new release. Closed stdin loads the real runner and
# its dependencies without calling a model.
set -eu
cd "$(dirname "$0")/.."
"${AGENT_NODE:-node}" agent-runtime/runner.mjs </dev/null
printf '%s\n' 'Agent runtime imports verified.'
