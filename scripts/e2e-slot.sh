#!/usr/bin/env bash
# Run a command against an isolated end-to-end environment, so several runs can share a machine.
#
# Usage: scripts/e2e-slot.sh <slot 0-99> [--snapshot[=<rev>]] [--preview] [--fresh] [--rtc] <command...>
#   scripts/e2e-slot.sh 3 just e2e e2e/account/password-login.spec.ts
#   scripts/e2e-slot.sh 3 --preview npx playwright test e2e/threads/pinned-threads.live.spec.ts
#   scripts/e2e-slot.sh 3 --rtc --preview npx playwright test e2e/calls/calls.spec.ts
#   scripts/e2e-slot.sh 3 down        # stop that slot's homeserver and call service, delete its data
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
#                       (e2e/fixtures/*.html) and is shared by every slot that tests the same commit;
#                       with E2E_PLUGIN_DIRS, it also holds their fixture pages, and with
#                       MINDROOM_CLIENT_PLUGINS those plugins, and is the run's own. The snapshot
#                       gets copies of the directories of both in e2e-plugins/, each once, and both
#                       variables name the copies, so edits in the directories never reach the run;
#                       a copy's link to the app (.mindroom-chat) is a link to the snapshot, and its
#                       links that lead out of the directory (a local package) lead where they did.
#                       Specs that import /src/ modules need the dev server.
#   --fresh             Start the slot's homeserver empty and delete it when the command ends.
#   --rtc               Start the slot's call service (scripts/e2e-rtc.sh: LiveKit and a MatrixRTC
#                       authorization service, the snapshot's own with --snapshot) before the
#                       homeserver, which then announces it, and stop it when the command ends. The
#                       call specs skip without it. Without --fresh, a homeserver the slot already
#                       runs is recreated with the setting and again without it at the end; its
#                       data stays.
#
# At most E2E_MAX_CONCURRENT runs (default 6; 0 turns the cap off) go at once on this machine, over
# all slots and sessions: a run first takes one of that many lock files in
# $E2E_SNAPSHOT_ROOT/tokens (each names its holder), and waits, saying so once, while all are taken.
# Its exit releases it, also on failure or Ctrl-C. `down` takes none.
set -euo pipefail
# Everything runs from main, which bash reads whole before it starts: editing this file while a
# run is in progress (a shared checkout) cannot change what that run executes next. The scripts it
# sources (scripts/private-dir.sh) or runs are read when the run reaches them.
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
  rtc=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --snapshot) snapshot_rev=HEAD ;;
      --snapshot=*) snapshot_rev="${1#--snapshot=}" ;;
      --preview) preview=1 ;;
      --fresh) fresh=1 ;;
      --rtc) rtc=1 ;;
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

  # The homeserver definition: the checkout's, or after `cd "$tree"` below the snapshot's own, so
  # uncommitted edits to it never reach a snapshot run either.
  compose_file="$repo/e2e/docker-compose.yaml"
  compose() { docker compose -f "$compose_file" "$@"; }

  # The slot's MindRoom stack of the agent specs (scripts/agent-stack/stack.py) has its accounts on
  # the homeserver, so it stops with it. A root it refuses is named, and the rest still stops.
  agent_stack_down() { python3 "$repo/scripts/agent-stack/stack.py" "$slot" down || true; }

  if [ "$1" = down ]; then
    compose down --volumes --remove-orphans
    agent_stack_down
    bash "$repo/scripts/e2e-rtc.sh" "$slot" down
    exit
  fi

  # Not under $TMPDIR: `nix develop` gives each shell its own, and the run cap and the shared builds
  # must span every shell on the machine.
  snapshots="${E2E_SNAPSHOT_ROOT:-/tmp/mindroom-client-e2e}"
  . "$repo/scripts/private-dir.sh"
  private_dir "$snapshots"
  take_run_token "$@"

  if [ -n "$snapshot_rev" ]; then
    sha="$(git rev-parse --verify --quiet "$snapshot_rev^{commit}")" || {
      echo "e2e-slot: $snapshot_rev is not a commit" >&2
      exit 2
    }
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
      # The plugin directories (E2E_PLUGIN_DIRS) and client plugins (MINDROOM_CLIENT_PLUGINS) are
      # copied into the snapshot's e2e-plugins/, where the fixture page build finds the pages of
      # each copy (scripts/e2e-plugin-pages.mjs). No commit pins them, so such a build is this run's own.
      if [ -n "${E2E_PLUGIN_DIRS:-}${MINDROOM_CLIENT_PLUGINS:-}" ]; then
        build="$snapshots/builds/slot-$slot"
        rm -rf "$build"
        mkdir -p "$tree/e2e-plugins"
        declare -A plugin_copies=()
        copy_plugin_dirs E2E_PLUGIN_DIRS :
        copy_plugin_dirs MINDROOM_CLIENT_PLUGINS ,
      fi
      mkdir -p "$snapshots/builds"
      (
        # One build per commit (per run with plugin directories); slots that start together wait for the first one.
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
    compose_file="$tree/e2e/docker-compose.yaml"
  fi

  # The imported scripts start their homeserver from E2E_MATRIX_COMPOSE_FILE (scripts/e2e-matrix-up.sh,
  # which scripts/appstore-fixture-up.sh calls); point them at this slot's server.
  export E2E_MATRIX_COMPOSE_FILE="${E2E_MATRIX_COMPOSE_FILE:-$compose_file}"
  # The call service of the run's own tree; its variables (E2E_LIVEKIT_SERVICE_URL, read by
  # e2e/docker-compose.yaml) must be set before the homeserver starts.
  rtc_script="$PWD/scripts/e2e-rtc.sh"
  if [ "$rtc" = 1 ]; then
    [ -f "$rtc_script" ] || {
      echo "e2e-slot: --rtc needs $rtc_script" >&2
      exit 2
    }
    eval "$(bash "$rtc_script" "$slot" env)"
  fi
  # What the run starts, it stops when it ends, also on failure or Ctrl-C.
  stop_run_services() {
    if [ "$rtc" = 1 ]; then bash "$rtc_script" "$slot" down || true; fi
    if [ "$rtc" = 1 ] && [ "$fresh" = 0 ]; then
      # The homeserver outlives the run: it stops naming the call service that is gone.
      E2E_LIVEKIT_SERVICE_URL='' compose --progress quiet up -d --wait >/dev/null 2>&1 || true
    fi
    if [ "$fresh" = 1 ]; then
      compose down --volumes --remove-orphans >/dev/null 2>&1 || true
      agent_stack_down
    fi
  }
  if [ "$fresh" = 1 ] || [ "$rtc" = 1 ]; then trap stop_run_services EXIT; fi
  if [ "$rtc" = 1 ]; then without_token bash "$rtc_script" "$slot" up; fi
  if [ "$fresh" = 1 ]; then
    # Quiet, not silenced: a Docker failure here must say why the run stopped.
    compose --progress quiet down --volumes --remove-orphans
  fi
  # With --rtc, `up` also recreates a running homeserver that does not announce the call service yet.
  if [ "$rtc" = 1 ] ||
    ! curl -fsS -o /dev/null "http://127.0.0.1:$E2E_MATRIX_PORT/_matrix/client/versions" 2>/dev/null; then
    compose --progress quiet up -d --wait
  fi
  # Dev servers started for this slot do not watch files (see vite.config.js); set E2E_NO_WATCH=0 to watch.
  export E2E_NO_WATCH="${E2E_NO_WATCH:-1}"
  export CHROMIUM_PATH="${CHROMIUM_PATH:-$(command -v chromium || true)}"
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$CHROMIUM_PATH}"
  without_token "$@"
}

# Copies the directories that the variable named $1 lists, split on $2 only (so a name such as
# plugin[1] stays itself), trimmed and relative to the snapshot $tree, into its e2e-plugins/, named as
# they are, and points the variable at the copies. A directory that plugin_copies already maps to its
# copy is not copied again. A name another copy has refuses the run for E2E_PLUGIN_DIRS, whose names
# the fixture page URLs and Playwright projects take, and gets a number for MINDROOM_CLIENT_PLUGINS.
copy_plugin_dirs() {
  local dir real copy name n parts link target copies=
  [ -n "${!1:-}" ] || return 0
  mapfile -t -d "$2" parts < <(printf '%s' "${!1}")
  for dir in "${parts[@]}"; do
    dir="${dir#"${dir%%[![:space:]]*}"}"
    dir="${dir%"${dir##*[![:space:]]}"}"
    [ -n "$dir" ] || continue
    real="$(cd "$tree" && cd "$dir" && pwd -P)"
    copy="${plugin_copies[$real]:-}"
    if [ -z "$copy" ]; then
      name="$(basename "$real")"
      copy="$tree/e2e-plugins/$name"
      n=1
      while [ -e "$copy" ]; do
        if [ "$1" = E2E_PLUGIN_DIRS ]; then
          echo "e2e-slot: two directories of E2E_PLUGIN_DIRS are named $name" >&2
          exit 2
        fi
        n=$((n + 1))
        copy="$tree/e2e-plugins/$name-$n"
      done
      plugin_copies[$real]="$copy"
      mkdir "$copy"
      # Its link to the app, a link or a submodule (docs/development.md), stays out: the copy's is
      # the snapshot.
      tar -C "$real" --exclude=./.mindroom-chat -cf - . | tar -C "$copy" -xf -
      # A link that leads out of the directory, as npm makes one for a local package, leads where it
      # did, and an absolute one into the directory leads into the copy.
      find "$copy" -type l -print0 | while IFS= read -r -d '' link; do
        target="$(readlink -f "$real/${link#"$copy"/}" || true)"
        case "$target" in
          "") ;;
          "$real" | "$real"/*)
            if [[ "$(readlink "$link")" == /* ]]; then ln -sfn "$copy${target#"$real"}" "$link"; fi
            ;;
          *) ln -sfn "$target" "$link" ;;
        esac
      done
      if [ -e "$real/.mindroom-chat" ]; then ln -s "$tree" "$copy/.mindroom-chat"; fi
    fi
    copies="${copies:+$copies$2}$copy"
  done
  export "$1=$copies"
}

# Runs a command without the run token's descriptor: only this script holds it, so a server the
# command leaves running in the background (the call service's authorization service, a server a
# spec starts) cannot keep the token after the run.
without_token() {
  if [ -n "${token_fd:-}" ]; then
    "$@" {token_fd}>&-
  else
    "$@"
  fi
}

# Takes one of E2E_MAX_CONCURRENT lock files (token_fd stays open on it until this script exits).
take_run_token() {
  local max="${E2E_MAX_CONCURRENT:-6}" tokens="$snapshots/tokens" i round=0 said=0
  [ "$max" -gt 0 ] || return 0
  mkdir -p "$tokens"
  while :; do
    for ((i = 1; i <= max; i++)); do
      exec {token_fd}<>"$tokens/token-$i"
      if flock -n "$token_fd"; then
        printf 'slot %s, pid %s, since %s: %s\n' "$slot" "$$" "$(date +%H:%M:%S)" "$*" >"$tokens/token-$i"
        return 0
      fi
      exec {token_fd}>&-
    done
    if [ "$said" = 0 ]; then
      echo "e2e-slot $slot: waiting: all $max e2e runs this machine allows (E2E_MAX_CONCURRENT) are going; each file in $tokens names its last holder" >&2
      said=1
    fi
    # Block on one token at a time, up to a second each, instead of spinning.
    i=$((round % max + 1))
    round=$((round + 1))
    exec {token_fd}<>"$tokens/token-$i"
    if flock -w 1 "$token_fd"; then
      printf 'slot %s, pid %s, since %s: %s\n' "$slot" "$$" "$(date +%H:%M:%S)" "$*" >"$tokens/token-$i"
      return 0
    fi
    exec {token_fd}>&-
  done
}

# One line, read whole before main runs, so nothing after it is read from a file edited meanwhile.
main "$@"; exit
