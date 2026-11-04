#!/usr/bin/env bash
# Run a command against an isolated end-to-end environment, so several runs can share a machine.
#
# Usage: scripts/e2e-slot.sh <slot 1-50> [--snapshot[=<rev>]] [--preview] [--fresh] <command...>
#   scripts/e2e-slot.sh 3 just e2e e2e/password-login.spec.ts
#   scripts/e2e-slot.sh 3 --preview npx playwright test e2e/live/pinned-threads.spec.ts
#   scripts/e2e-slot.sh 3 down        # stop that slot's homeserver and delete its data
#
# Slot N gets its own disposable Tuwunel (compose project mindroom-client-e2e-N on port 28100+N)
# and its own Vite dev server port (4300+N). Slot 0 is the default `just hs-up` setup (28008, 4200).
#
# Options, between the slot and the command:
#   --snapshot[=<rev>]  Run the command in a clean copy of a commit (default HEAD) instead of the
#                       shared checkout, so edits other sessions have not committed never reach the
#                       server or the specs. The copy lives in $E2E_SNAPSHOT_ROOT/slot-<N> (default
#                       /tmp/mindroom-client-e2e) until the slot's next snapshot run, and links the
#                       checkout's node_modules. Paths relative to the repository root work as usual.
#                       Implies --fresh.
#   --preview           Serve a production build (`vite build`, then `vite preview`) instead of the
#                       dev server; implies --snapshot. The build also holds the spec fixture pages
#                       (e2e/fixtures/*.html) and is shared by every slot that tests the same commit.
#                       Specs that import /src/ modules need the dev server.
#   --fresh             Start the slot's homeserver empty and delete it when the command ends.
set -euo pipefail
# Everything runs from main, which bash reads whole before it starts: editing this file while a
# run is in progress (a shared checkout) cannot change what that run executes next.
main() {
  slot="${1:?slot number}"
  shift
  cd "$(dirname "$0")/.."
  repo="$PWD"
  if [ "$slot" = 0 ]; then
    export E2E_MATRIX_PORT=28008 E2E_APP_PORT=4200 COMPOSE_PROJECT_NAME=mindroom-client-e2e
  else
    export E2E_MATRIX_PORT=$((28100 + slot)) E2E_APP_PORT=$((4300 + slot)) COMPOSE_PROJECT_NAME="mindroom-client-e2e-$slot"
  fi

  snapshot_rev=
  preview=0
  fresh=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --snapshot) snapshot_rev=HEAD ;;
      --snapshot=*) snapshot_rev="${1#--snapshot=}" ;;
      --preview) preview=1 ;;
      --fresh) fresh=1 ;;
      --*)
        echo "e2e-slot: unknown option $1" >&2
        exit 2
        ;;
      *) break ;;
    esac
    shift
  done
  [ $# -gt 0 ] || {
    echo 'e2e-slot: no command given' >&2
    exit 2
  }
  if [ "$preview" = 1 ] && [ -z "$snapshot_rev" ]; then snapshot_rev=HEAD; fi
  if [ -n "$snapshot_rev" ]; then fresh=1; fi

  compose() { docker compose -f "$repo/e2e/docker-compose.yaml" "$@"; }

  # The slot's MindRoom stack of the agent specs (scripts/agent-stack/stack.py) has its accounts on
  # the homeserver, so it stops with it.
  agent_stack_down() { python3 "$repo/scripts/agent-stack/stack.py" "$slot" down >/dev/null 2>&1 || true; }

  if [ "$1" = down ]; then
    compose down --volumes --remove-orphans
    agent_stack_down
    exit
  fi

  if [ -n "$snapshot_rev" ]; then
    sha="$(git rev-parse --verify --quiet "$snapshot_rev^{commit}")" || {
      echo "e2e-slot: $snapshot_rev is not a commit" >&2
      exit 2
    }
    snapshots="${E2E_SNAPSHOT_ROOT:-${TMPDIR:-/tmp}/mindroom-client-e2e}"
    tree="$snapshots/slot-$slot"
    rm -rf "$tree"
    mkdir -p "$tree"
    git archive "$sha" | tar -x -C "$tree"
    ln -s "$repo/node_modules" "$tree/node_modules"
    # The copy has no .git, so give the build the version the checkout would report.
    export MINDROOM_BUILD_VERSION="$sha"
    # A server already listening on the slot port serves other code: fail instead of reusing it.
    export E2E_REUSE_EXISTING_SERVER=0
    echo "e2e-slot $slot: snapshot of ${sha:0:12} in $tree" >&2

    if [ "$preview" = 1 ]; then
      build="$snapshots/builds/$sha"
      mkdir -p "$snapshots/builds"
      (
        # One build per commit; slots that start together wait for the first one.
        flock 9
        if [ ! -e "$build/.complete" ]; then
          echo "e2e-slot $slot: building ${sha:0:12} into $build" >&2
          partial="$build.partial"
          rm -rf "$partial"
          cd "$tree"
          if ! {
            npx vite build --outDir "$partial" --emptyOutDir &&
              E2E_FIXTURE_PAGES=1 npx vite build --outDir "$partial"
          } >"$build.log" 2>&1; then
            tail -n 30 "$build.log" >&2
            echo "e2e-slot $slot: the build failed; its log is $build.log" >&2
            exit 1
          fi
          touch "$partial/.complete"
          rm -rf "$build"
          mv "$partial" "$build"
        fi
        touch "$build"
        # Builds nobody used for a day go.
        find "$snapshots/builds" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} +
      ) 9>"$build.lock"
      export E2E_SERVER_COMMAND="npx vite preview --host 127.0.0.1 --port $E2E_APP_PORT --strictPort --outDir $build"
    fi
    cd "$tree"
  fi

  # The imported scripts start their homeserver from E2E_MATRIX_COMPOSE_FILE (scripts/e2e-matrix-up.sh,
  # which scripts/appstore-fixture-up.sh calls); point them at this slot's server.
  export E2E_MATRIX_COMPOSE_FILE="${E2E_MATRIX_COMPOSE_FILE:-$PWD/e2e/docker-compose.yaml}"
  if [ "$fresh" = 1 ]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1
  fi
  if ! curl -fsS -o /dev/null "http://127.0.0.1:$E2E_MATRIX_PORT/_matrix/client/versions" 2>/dev/null; then
    compose --progress quiet up -d --wait
  fi
  # Dev servers started for this slot do not watch files (see vite.config.js); set E2E_NO_WATCH=0 to watch.
  export E2E_NO_WATCH="${E2E_NO_WATCH:-1}"
  export CHROMIUM_PATH="${CHROMIUM_PATH:-$(command -v chromium || true)}"
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$CHROMIUM_PATH}"
  if [ "$fresh" = 0 ]; then
    exec "$@"
  fi
  trap 'compose down --volumes --remove-orphans >/dev/null 2>&1 || true; agent_stack_down' EXIT
  "$@"
}

# One line, read whole before main runs, so nothing after it is read from a file edited meanwhile.
main "$@"; exit
