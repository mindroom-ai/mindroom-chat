#!/usr/bin/env bash
# Run the e2e suite against one commit, spread over several slots, and write one TSV row per spec.
#
# Usage: scripts/e2e-suite.sh [--rev <rev>] [--slots <list>] [--dev] [--out <file.tsv>] [<spec>...] [-- <playwright options>]
#        scripts/e2e-suite.sh --resume <run directory> [--slots <list>] [--out <file.tsv>] [-- <playwright options>]
#   scripts/e2e-suite.sh --slots 25-30 --out e2e-results.tsv
#   scripts/e2e-suite.sh --slots 2 e2e/threads/pinned-threads.live.spec.ts -- --repeat-each 3
#
# Every spec file is its own `scripts/e2e-slot.sh <slot> --snapshot=<rev> --preview` run: a clean
# copy of the commit (default HEAD), its production build, and a homeserver that starts empty, so
# rooms from earlier specs never crowd the account. Specs that import /src/ modules, and all of them
# with --dev, get the dev server instead. Specs that name scripts/e2e-rtc.sh (the call specs) also
# get the slot's call service (`e2e-slot.sh --rtc`). Each slot takes the next spec when it finishes one.
# Without specs, every e2e/**/*.spec.ts of the commit runs, and with E2E_PLUGIN_DIRS each one in
# those directories, as e2e-plugins/<directory name>/e2e/<spec>, always on the production build,
# whose snapshot has their copies. Playwright options default to `--retries 1`; a test that passes on its retry counts as flaky. --slots takes `25-30` or `2,25,26`
# (default 25-30). The run directory ($E2E_SNAPSHOT_ROOT/suite-<commit>-<time>, with logs, JSON
# reports, traces and results.tsv; the root defaults to /tmp/mindroom-client-e2e, as in
# scripts/e2e-slot.sh) is printed at the start; --out copies results.tsv there too.
# results.tsv counts tests skipped because the run lacked a service, fixture, account or setting
# they need in its own last column, `skipped (no service)`, and the summary names those specs.
# Each start deletes the output/ and json/ of runs untouched for two days (logs and results stay).
# --resume finishes an interrupted run in its directory: the same commit and spec list, every spec
# it has no result for yet, including runs that left no report (pass the Playwright options again
# if the run had its own).
set -euo pipefail
# Everything runs from main, which bash reads whole before it starts: editing this file while a
# run is in progress (a shared checkout) cannot change what that run executes next.
main() {
  cd "$(dirname "$0")/.."
  repo="$PWD"

  rev=HEAD
  slot_list=25-30
  dev_all=0
  out=
  resume=
  specs=()
  playwright_options=(--retries 1)
  while [ $# -gt 0 ]; do
    case "$1" in
      --rev) rev="$2"; shift ;;
      --rev=*) rev="${1#--rev=}" ;;
      --slots) slot_list="$2"; shift ;;
      --slots=*) slot_list="${1#--slots=}" ;;
      --dev) dev_all=1 ;;
      --out) out="$2"; shift ;;
      --out=*) out="${1#--out=}" ;;
      --resume) resume="$2"; shift ;;
      --resume=*) resume="${1#--resume=}" ;;
      --) shift; playwright_options=("$@"); break ;;
      -*)
        echo "e2e-suite: unknown option $1" >&2
        exit 2
        ;;
      *) specs+=("$1") ;;
    esac
    shift
  done

  slots=()
  IFS=',' read -r -a slot_parts <<<"$slot_list"
  for part in "${slot_parts[@]}"; do
    if [[ "$part" =~ ^([0-9]+)-([0-9]+)$ ]]; then
      for ((n = BASH_REMATCH[1]; n <= BASH_REMATCH[2]; n++)); do slots+=("$n"); done
    elif [[ "$part" =~ ^[0-9]+$ ]]; then
      slots+=("$part")
    else
      echo "e2e-suite: bad slot list $slot_list" >&2
      exit 2
    fi
  done
  for slot in "${slots[@]}"; do
    for port in $((4300 + slot)) $((28100 + slot)); do
      if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        echo "e2e-suite: port $port of slot $slot is in use; stop it or pick other slots" >&2
        exit 2
      fi
    done
  done

  # The same default as scripts/e2e-slot.sh, whatever $TMPDIR says.
  snapshots="${E2E_SNAPSHOT_ROOT:-/tmp/mindroom-client-e2e}"
  . "$repo/scripts/private-dir.sh"
  private_dir "$snapshots"
  if [ -n "$resume" ]; then
    [ -f "$resume/manifest.tsv" ] || {
      echo "e2e-suite: $resume is not a suite run directory" >&2
      exit 2
    }
    # Runs record their commit; older ones only carry its first 12 digits in the directory name.
    rev="$(cat "$resume/commit" 2>/dev/null || basename "$resume" | sed -E 's/^suite-([0-9a-f]+)-.*/\1/')"
  fi
  sha="$(git rev-parse --verify --quiet "$rev^{commit}")" || {
    echo "e2e-suite: $rev is not a commit" >&2
    exit 2
  }
  # A resumed run keeps the spec list it started with (runs from before specs.txt ran them all).
  if [ ${#specs[@]} -eq 0 ] && [ -n "$resume" ] && [ -f "$resume/specs.txt" ]; then
    mapfile -t specs <"$resume/specs.txt"
  fi
  if [ ${#specs[@]} -eq 0 ]; then
    mapfile -t specs < <(git ls-tree -r --name-only "$sha" -- e2e | grep '\.spec\.ts$' | sort)
    # And the specs in the e2e/ of each plugin directory (E2E_PLUGIN_DIRS, relative to the
    # repository), by their path in the snapshot, whose e2e-plugins/ has a copy of the directory
    # (scripts/e2e-slot.sh --preview).
    IFS=: read -r -a plugin_dirs <<<"${E2E_PLUGIN_DIRS:-}"
    for dir in "${plugin_dirs[@]}"; do
      [ -n "$dir" ] || continue
      real="$(cd "$dir" && pwd -P)"
      if [ -d "$real/e2e" ]; then
        mapfile -t -O "${#specs[@]}" specs < <(cd "$real" && find e2e -name '*.spec.ts' | sort |
          sed "s|^|e2e-plugins/$(basename "$real")/|")
      fi
    done
  fi
  mapfile -t dev_specs < <(git grep -l "'/src/" "$sha" -- e2e | sed "s/^$sha://")
  mapfile -t rtc_specs < <(git grep -l 'scripts/e2e-rtc\.sh' "$sha" -- e2e | sed "s/^$sha://")
  # Traces, videos and reports of runs untouched for two days go; their logs and results.tsv stay.
  find "$snapshots" -mindepth 1 -maxdepth 1 -type d -name 'suite-*' -mmin +2880 -print0 |
    while IFS= read -r -d '' old; do
      if [ -z "$resume" ] || ! [ "$old" -ef "$resume" ]; then rm -rf "$old/output" "$old/json"; fi
    done
  if [ -n "$resume" ]; then
    run="$resume"
    # A run that left no Playwright report (Docker or the app server failed first) has no result.
    while IFS= read -r line; do
      if [ -s "$(cut -f 2 <<<"$line")" ]; then printf '%s\n' "$line"; fi
    done <"$run/manifest.tsv" >"$run/manifest.kept"
    mv "$run/manifest.kept" "$run/manifest.tsv"
    mapfile -t specs < <(printf '%s\n' "${specs[@]}" | grep -vxF -f <(cut -f 1 "$run/manifest.tsv") || true)
  else
    run="$snapshots/suite-${sha:0:12}-$(date +%Y%m%dT%H%M%S)"
    mkdir -p "$run/logs" "$run/json" "$run/output"
    : >"$run/manifest.tsv"
    printf '%s\n' "${specs[@]}" >"$run/specs.txt"
  fi
  echo "$sha" >"$run/commit"
  echo "e2e-suite: ${#specs[@]} spec files of ${sha:0:12} on slots ${slots[*]}; run directory $run" >&2

  # The queue: live specs (*.live.spec.ts) first, the slowest, one line per spec
  # with the server it needs.
  {
    for spec in "${specs[@]}"; do
      server=preview
      # A plugin directory's specs run only where the snapshot has its copy.
      if { [ "$dev_all" = 1 ] && [[ "$spec" != e2e-plugins/* ]]; } ||
        printf '%s\n' "${dev_specs[@]}" | grep -qxF "$spec"; then server=dev; fi
      case "$spec" in *.live.spec.ts) rank=0 ;; *) rank=1 ;; esac
      printf '%s\t%s\t%s\n' "$rank" "$server" "$spec"
    done
  } | sort -k1,1 -k3,3 | cut -f2- >"$run/queue"

  next_spec() {
    (
      flock 8
      head -n 1 "$run/queue"
      tail -n +2 "$run/queue" >"$run/queue.rest"
      mv "$run/queue.rest" "$run/queue"
    ) 8>"$run/queue.lock"
  }

  work() {
    local slot="$1" line server spec key started status load
    while line="$(next_spec)" && [ -n "$line" ]; do
      server="${line%%$'\t'*}"
      spec="${line#*$'\t'}"
      key="${spec#e2e/}"
      key="${key//\//__}"
      started=$SECONDS
      status=0
      # The machine's 1-minute load average when the spec starts, to tell load failures apart.
      load="$(cut -d ' ' -f 1 /proc/loadavg)"
      local options=(--snapshot="$sha")
      if [ "$server" = preview ]; then options+=(--preview); fi
      if printf '%s\n' "${rtc_specs[@]}" | grep -qxF "$spec"; then options+=(--rtc); fi
      PLAYWRIGHT_JSON_OUTPUT_FILE="$run/json/$key.json" \
        bash "$repo/scripts/e2e-slot.sh" "$slot" "${options[@]}" \
        npx playwright test "$spec" --reporter=list,json --output "$run/output/$key" \
        "${playwright_options[@]}" >"$run/logs/$key.log" 2>&1 || status=$?
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$spec" "$run/json/$key.json" "$run/logs/$key.log" "$server" \
        "$status" "$load" >>"$run/manifest.tsv"
      echo "e2e-suite: slot $slot $spec ($server) exit $status in $((SECONDS - started)) s" >&2
    done
  }

  for slot in "${slots[@]}"; do
    work "$slot" &
  done
  wait

  node "$repo/scripts/e2e-results-tsv.mjs" --manifest "$run/manifest.tsv" >"$run/results.tsv"
  if [ -n "$out" ]; then cp "$run/results.tsv" "$out"; fi
  awk -F'\t' 'NR > 1 { p += $2; f += $3; s += $4; k += $6; n += $10; if ($3 > 0) files++
      if ($10 > 0) lacking = lacking " " $1 }
    END { printf "e2e-suite: %d passed, %d failed in %d spec files, %d flaky, %d skipped", p, f, files, k, s
      if (n > 0) printf ", %d skipped for a missing service:%s", n, lacking
      printf "\n" }' "$run/results.tsv" >&2
  echo "e2e-suite: results in $run/results.tsv" >&2
}

# One line, read whole before main runs, so nothing after it is read from a file edited meanwhile.
main "$@"; exit
