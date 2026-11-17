#!/usr/bin/env bash
# Production build into dist/ (`just build`, and `npm run build:ios` for the iOS and Mac apps); extra
# arguments go to `vite build`. While MINDROOM_CLIENT_PLUGINS is unset, it builds in the client plugins
# bundled-plugins.txt pins (scripts/bundled-plugins.mjs downloads and installs them); set, even empty,
# it builds the plugins it names, so `MINDROOM_CLIENT_PLUGINS= scripts/build.sh` builds none.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${MINDROOM_CLIENT_PLUGINS+set}" ]; then
  MINDROOM_CLIENT_PLUGINS=$(node scripts/bundled-plugins.mjs)
  export MINDROOM_CLIENT_PLUGINS
fi
exec npx vite build "$@"
