#!/usr/bin/env sh
set -eu

BASE_PATH="${APP_BASE_PATH:-/}"

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__APP_BASE_PATH__ = "${BASE_PATH}";
EOF
