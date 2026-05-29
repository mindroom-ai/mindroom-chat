#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve browser (check PATH, then ~/.nix-profile, then /run/current-system, then nix-shell)
if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]]; then
  : # already set explicitly
elif command -v chromium &>/dev/null; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)"
elif [[ -x "$HOME/.nix-profile/bin/chromium" ]]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$HOME/.nix-profile/bin/chromium"
elif [[ -x /run/current-system/sw/bin/chromium ]]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/run/current-system/sw/bin/chromium
else
  echo "WARN: chromium not found, trying nix-shell fallback"
  exec nix-shell -p chromium --run "$0 $*" 2>/dev/null || {
    echo "ERROR: Cannot find chromium. Install it or set PLAYWRIGHT_CHROMIUM_EXECUTABLE."
    exit 1
  }
fi

# 2. Set defaults
export E2E_NO_WEB_SERVER=1
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:8090}"
export E2E_HOMESERVER="${E2E_HOMESERVER:-https://mindroom.lab.mindroom.chat}"

# 3. Preflight
curl -sf "$E2E_BASE_URL" > /dev/null || { echo "ERROR: Cinny not running at $E2E_BASE_URL"; exit 1; }

# 4. Determine test filter (always scoped to e2e/live/ directory)
FILTER="live/${1:-}"
shift 2>/dev/null || true

# 5. Resolve credentials (priority: E2E_* > LIVE_TEST_* > registration token)
if [[ -n "${LIVE_TEST_USERNAME:-}" && -z "${E2E_USERNAME:-}" ]]; then
  export E2E_USERNAME="$LIVE_TEST_USERNAME"
  export E2E_PASSWORD="$LIVE_TEST_PASSWORD"
fi

# 5b. Auto-register a disposable account if token is available and no creds set
if [[ -z "${E2E_USERNAME:-}" && -n "${MINDROOM_REGISTRATION_TOKEN:-}" ]]; then
  echo "  Auto-registering disposable e2e account..."
  DISPOSABLE_USER="cinny-e2e-$(date +%s)"
  DISPOSABLE_PASS="E2ePass_$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"
  REGISTER_URL="${E2E_HOMESERVER}/_matrix/client/v3/register"

  # Step 1: initiate registration to get a session ID (pass JSON via stdin to avoid ps exposure)
  INIT_RESPONSE=$(printf '{"username": "%s", "password": "%s"}' "$DISPOSABLE_USER" "$DISPOSABLE_PASS" \
    | curl -s -X POST "$REGISTER_URL" \
      -H "Content-Type: application/json" \
      --data @- 2>&1) || true

  SESSION_ID=$(echo "$INIT_RESPONSE" | grep -o '"session":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [[ -n "$SESSION_ID" ]]; then
    # Step 2: complete registration with token auth (pass JSON via stdin)
    REG_RESPONSE=$(printf '{
        "username": "%s",
        "password": "%s",
        "auth": {
          "type": "m.login.registration_token",
          "token": "%s",
          "session": "%s"
        }
      }' "$DISPOSABLE_USER" "$DISPOSABLE_PASS" "$MINDROOM_REGISTRATION_TOKEN" "$SESSION_ID" \
      | curl -s -X POST "$REGISTER_URL" \
        -H "Content-Type: application/json" \
        --data @- 2>&1) || true

    if echo "$REG_RESPONSE" | grep -q '"user_id"'; then
      export E2E_USERNAME="$DISPOSABLE_USER"
      export E2E_PASSWORD="$DISPOSABLE_PASS"
      echo "  Registered: @${DISPOSABLE_USER}:mindroom.lab.mindroom.chat"
    else
      # Redact response to only show errcode/error fields
      REG_ERRCODE=$(echo "$REG_RESPONSE" | grep -o '"errcode":"[^"]*"' | head -1 || true)
      REG_ERROR=$(echo "$REG_RESPONSE" | grep -o '"error":"[^"]*"' | head -1 || true)
      echo "  WARN: Auto-registration failed: ${REG_ERRCODE:-unknown} ${REG_ERROR:-}"
    fi
  else
    echo "  WARN: Could not obtain registration session from homeserver"
  fi
fi

# 6. Run
echo "=== Running live tests: $FILTER ==="
echo "  Browser: $PLAYWRIGHT_CHROMIUM_EXECUTABLE"
echo "  Base URL: $E2E_BASE_URL"
echo "  Homeserver: $E2E_HOMESERVER"
echo "  Credentials: $([ -n "${E2E_USERNAME:-}" ] && echo 'set' || echo 'not set (Tier 1 only)')"
echo ""

npx playwright test "$FILTER" --reporter=line "$@" && EXIT_CODE=0 || EXIT_CODE=$?

# 7. Output summary
echo ""
echo "=== LIVE TEST RESULT: $([ $EXIT_CODE -eq 0 ] && echo 'PASS' || echo 'FAIL') ==="
exit $EXIT_CODE
