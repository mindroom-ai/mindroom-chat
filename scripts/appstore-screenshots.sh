#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
usage: npm run appstore:screenshots -- [playwright args...]

Captures App Store screenshots into ios/App/fastlane/screenshots/en-US/.

Default mode starts the local Docker Matrix stack, provisions a disposable
account, seeds the screenshot fixture room, and runs the Playwright capture spec.

Existing-account mode:
  APPSTORE_SCREENSHOTS_USE_EXISTING_E2E=1 \
  E2E_HOMESERVER=https://example.org \
  E2E_USERNAME=alice \
  E2E_PASSWORD=... \
  E2E_FIXTURE_ROOM_ALIAS="#mindroom-app-store-screenshots:example.org" \
  npm run appstore:screenshots
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

cd "${ROOT_DIR}"

export E2E_MATRIX_PORT="${E2E_MATRIX_PORT:-28008}"
if [ -z "${E2E_PORT:-}" ]; then
  E2E_PORT="$(
    node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });'
  )"
fi
export E2E_PORT
export E2E_REUSE_EXISTING_SERVER="${E2E_REUSE_EXISTING_SERVER:-0}"
export E2E_HOMESERVER="${E2E_HOMESERVER:-http://127.0.0.1:${E2E_MATRIX_PORT}}"
export E2E_FIXTURE_ROOM_ALIAS="${E2E_FIXTURE_ROOM_ALIAS:-#mindroom-app-store-screenshots:matrix.localhost}"
export E2E_SERVER_COMMAND="${E2E_SERVER_COMMAND:-npm run start -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort --force}"

SCREENSHOT_DIR="${ROOT_DIR}/ios/App/fastlane/screenshots/en-US"
mkdir -p "${SCREENSHOT_DIR}"
find "${SCREENSHOT_DIR}" -maxdepth 1 -type f \( \
  -name '*_iphone-6-9_*.png' -o \
  -name '*_ipad-13_*.png' \
\) -delete

if [ "${APPSTORE_SCREENSHOTS_USE_EXISTING_E2E:-0}" != "1" ]; then
  "${ROOT_DIR}/scripts/e2e-matrix-up.sh"
  eval "$(
    "${ROOT_DIR}/scripts/ensure-e2e-account.sh" \
      E2E \
      appstorescreenshots \
      'Pwappstorescreenshots123!'
  )"
  export E2E_USERNAME E2E_PASSWORD
elif [ -z "${E2E_USERNAME:-}" ] || [ -z "${E2E_PASSWORD:-}" ]; then
  echo "E2E_USERNAME and E2E_PASSWORD are required with APPSTORE_SCREENSHOTS_USE_EXISTING_E2E=1." >&2
  exit 64
fi

node "${ROOT_DIR}/scripts/seed-appstore-screenshot-room.mjs"

exec npx playwright test e2e/app-store-screenshots.spec.ts --project=chromium "$@"
