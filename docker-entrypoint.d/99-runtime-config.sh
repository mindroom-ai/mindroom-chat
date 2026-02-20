#!/usr/bin/env sh
set -eu

BASE_PATH="${APP_BASE_PATH:-/}"
RAW_ENABLE_SERVICE_WORKER="${APP_ENABLE_SERVICE_WORKER:-false}"
case "${RAW_ENABLE_SERVICE_WORKER}" in
  1|true|TRUE|yes|YES|on|ON)
    ENABLE_SERVICE_WORKER="true"
    ;;
  *)
    ENABLE_SERVICE_WORKER="false"
    ;;
esac

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__APP_BASE_PATH__ = "${BASE_PATH}";
window.__ENABLE_SERVICE_WORKER__ = ${ENABLE_SERVICE_WORKER};
EOF
