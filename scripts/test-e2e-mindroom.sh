#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${E2E_USERNAME:-}" ] || [ -z "${E2E_PASSWORD:-}" ]; then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E)"
  echo "Provisioned disposable primary e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

if [ "${E2E_CREATE_SECOND_ACCOUNT:-0}" = "1" ] &&
  { [ -z "${E2E_SECOND_USERNAME:-}" ] || [ -z "${E2E_SECOND_PASSWORD:-}" ]; }
then
  eval "$("${ROOT_DIR}/scripts/create-mindroom-e2e-account.sh" E2E_SECOND)"
  echo "Provisioned disposable secondary e2e account via ${MINDROOM_SSH_HOST:-mindroom}." >&2
fi

"${ROOT_DIR}/scripts/with-mindroom-tunnel.sh" npx playwright test "$@"
