#!/usr/bin/env bash
# Start or stop a LiveKit server and a MatrixRTC authorization service for one end-to-end slot,
# so the call specs can place real calls.
#
# Usage: scripts/e2e-rtc.sh <slot 0-99> up|down|env
#   up    start both (LiveKit in Docker, e2e/rtc/authorization-service.mjs in the background)
#   down  stop both
#   env   print the variables the slot's homeserver and specs read
#
# Run the specs with the printed variables, after restarting the slot's homeserver so it
# announces the service (`org.matrix.msc4143.rtc_foci`):
#   eval "$(scripts/e2e-rtc.sh 21 env)"; scripts/e2e-slot.sh 21 down; scripts/e2e-rtc.sh 21 up
#   scripts/e2e-slot.sh 21 npx playwright test e2e/calls/calls.spec.ts
#
# Ports for slot N: LiveKit signalling 29200+N, its WebRTC TCP 29300+N and UDP 29400+N, the
# authorization service 29500+N. Media stays on 127.0.0.1.
set -euo pipefail
slot="${1:?slot number}"
action="${2:?up, down or env}"
cd "$(dirname "$0")/.."
. scripts/private-dir.sh

livekit_port=$((29200 + slot))
tcp_port=$((29300 + slot))
udp_port=$((29400 + slot))
auth_port=$((29500 + slot))
matrix_port=$([ "$slot" = 0 ] && echo 28008 || echo $((28100 + slot)))
container="mindroom-client-e2e-rtc-$slot-livekit"
# Not under $TMPDIR, which `nix develop` sets per shell: `down` must find what any shell started.
state="/tmp/mindroom-client-e2e-rtc-$slot"
key=devkey
secret=mindroom-client-e2e-livekit-secret-0123456789

case "$action" in
  env)
    echo "export E2E_LIVEKIT_SERVICE_URL=http://127.0.0.1:$auth_port"
    echo "export E2E_LIVEKIT_URL=ws://127.0.0.1:$livekit_port"
    ;;
  up)
    private_dir "$state"
    if ! docker inspect "$container" >/dev/null 2>&1; then
      docker run -d --rm --name "$container" --network host livekit/livekit-server:latest \
        --bind 127.0.0.1 --port "$livekit_port" --node-ip 127.0.0.1 \
        --rtc.tcp_port "$tcp_port" --rtc.udp_port.start "$udp_port" --rtc.udp_port.end "$udp_port" \
        --keys "$key: $secret" >/dev/null
    fi
    if ! [ -s "$state/auth.pid" ] || ! kill -0 "$(cat "$state/auth.pid")" 2>/dev/null; then
      RTC_AUTH_PORT="$auth_port" RTC_HOMESERVER_URL="http://127.0.0.1:$matrix_port" \
        RTC_LIVEKIT_URL="ws://127.0.0.1:$livekit_port" RTC_LIVEKIT_KEY="$key" \
        RTC_LIVEKIT_SECRET="$secret" \
        nohup node e2e/rtc/authorization-service.mjs >"$state/auth.log" 2>&1 &
      echo $! >"$state/auth.pid"
    fi
    for _ in $(seq 1 60); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$livekit_port" 2>/dev/null &&
        curl -fsS -o /dev/null "http://127.0.0.1:$auth_port/healthz" 2>/dev/null; then
        echo "e2e-rtc $slot: LiveKit ws://127.0.0.1:$livekit_port, authorization http://127.0.0.1:$auth_port" >&2
        exit 0
      fi
      sleep 0.5
    done
    echo "e2e-rtc $slot: LiveKit or the authorization service did not start (log: $state/auth.log)" >&2
    exit 1
    ;;
  down)
    private_dir "$state"
    docker rm -f "$container" >/dev/null 2>&1 || true
    if [ -s "$state/auth.pid" ]; then kill "$(cat "$state/auth.pid")" 2>/dev/null || true; fi
    rm -rf "$state"
    ;;
  *)
    echo "e2e-rtc: unknown action $action" >&2
    exit 2
    ;;
esac
