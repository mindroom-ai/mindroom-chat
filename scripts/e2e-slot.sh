#!/usr/bin/env bash
# Run a command against an isolated end-to-end environment, so several runs can share a machine.
#
# Usage: scripts/e2e-slot.sh <slot 1-50> <command...>
#   scripts/e2e-slot.sh 3 just e2e e2e/password-login.spec.ts
#   scripts/e2e-slot.sh 3 down        # stop that slot's homeserver and delete its data
#
# Slot N gets its own disposable Tuwunel (compose project mindroom-client-e2e-N on port 28100+N)
# and its own Vite dev server port (4300+N). Slot 0 is the default `just hs-up` setup (28008, 4200).
set -euo pipefail
slot="${1:?slot number}"
shift
cd "$(dirname "$0")/.."
if [ "$slot" = 0 ]; then
  export E2E_MATRIX_PORT=28008 E2E_APP_PORT=4200 COMPOSE_PROJECT_NAME=mindroom-client-e2e
else
  export E2E_MATRIX_PORT=$((28100 + slot)) E2E_APP_PORT=$((4300 + slot)) COMPOSE_PROJECT_NAME="mindroom-client-e2e-$slot"
fi
# The imported scripts start their homeserver from E2E_MATRIX_COMPOSE_FILE (scripts/e2e-matrix-up.sh,
# which scripts/appstore-fixture-up.sh calls); point them at this slot's server.
export E2E_MATRIX_COMPOSE_FILE="${E2E_MATRIX_COMPOSE_FILE:-$PWD/e2e/docker-compose.yaml}"
if [ "${1:-}" = down ]; then
  exec docker compose -f e2e/docker-compose.yaml down --volumes --remove-orphans
fi
if ! curl -fsS -o /dev/null "http://127.0.0.1:$E2E_MATRIX_PORT/_matrix/client/versions" 2>/dev/null; then
  docker compose -f e2e/docker-compose.yaml up -d --wait
fi
# Dev servers started for this slot do not watch files (see vite.config.js); set E2E_NO_WATCH=0 to watch.
export E2E_NO_WATCH="${E2E_NO_WATCH:-1}"
export CHROMIUM_PATH="${CHROMIUM_PATH:-$(command -v chromium || true)}"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$CHROMIUM_PATH}"
exec "$@"
