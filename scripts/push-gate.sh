#!/usr/bin/env bash
# The checks a commit passes before the coordinator pushes it to GitHub main.
#
# Usage: scripts/push-gate.sh <checkout> --slot <n> --corpus <upstream clone> [--rev <commit>] [--base <rev>]
#   scripts/push-gate.sh ~/Work/mindroom-client-new --slot 46 --corpus <upstream clone>
#
# <checkout> is the clone the push goes out from. --rev is the commit to push (default its HEAD) and
# --base what GitHub main already has (default origin/main), so base..rev is what the push adds.
# --slot is the e2e slot of the smoke specs, or a list such as 46,47 that shares them out
# (scripts/e2e-suite.sh --slots); --corpus, or $PUSH_GATE_CORPUS, the full upstream clone of the
# overlap check.
#
# Every check reads the commit, never the working tree: the code checks run in an archive copy of it
# that links the checkout's node_modules and has the commit's index, and the smoke specs in e2e-slot
# snapshots of it.
#   build     the production build (`e2e-slot.sh <slot> --preview --snapshot=<rev>`, kept per commit),
#             and what a first visit downloads before the app runs, against the commit's
#             scripts/perf/bundle-budget.json (scripts/perf/bundle-report.mjs)
#   tsc       tsc --noEmit -p tsconfig.app.json
#   strict    node scripts/strict-check.mjs
#   lint      ESLint on the files base...rev changes (on every file when .eslintrc.cjs changes)
#   vitest    the full unit suite; the files that fail run once more on their own, and only a
#             second failure counts (the detail says how many passed on the rerun)
#   overlap   scripts/upstream-overlap/check.py --history; it reads every ref of the checkout, but
#             only findings in blobs reachable from the commit fail the gate
#   keys      every object base..rev adds (files and commit messages) against the values in
#             $PUSH_GATE_KEY_FILE (default ~/.config/mindroom-chat/llm.env); it prints key names, never values
#   old-name  commit messages in base..rev that use the old name of the upstream client
#   e2e       the smoke specs below through scripts/e2e-suite.sh: each spec file on the build with
#             an empty homeserver of its own (in one shared run, the rooms earlier specs made pushed
#             a spec's room out of the room list), with one retry; a test that passes on its retry
#             counts as flaky
# The checks run side by side; the smoke specs start once the build and the unit suite are done, so
# the gate's own load does not slow them. It ends with one summary table and exits 0 only when every
# check passes. Logs stay in $PUSH_GATE_ROOT (default /tmp/mindroom-client-push-gate)/<commit>-<time>.
# The gate needs Node 24: from a shell without it, it starts itself again in the checkout's
# `nix develop`.
set -euo pipefail

# 15 specs over the main paths, none slower than about 40 s at a normal load.
SMOKE_SPECS=(
  e2e/shell/smoke.live.spec.ts                      # the app shell loads without critical errors
  e2e/account/login.live.spec.ts                      # password sign-in, a stable shell, a reload
  e2e/room/rooms.live.spec.ts                      # the room list and opening a room's timeline
  e2e/sidebar/room-unread-filter.spec.ts       # unread marks in the room list
  e2e/threads/thread-unread-receipts.live.spec.ts     # unread threads cleared by mark-read and opening
  e2e/activity/activity.spec.ts          # the Activity bell, an approval answered, a row's thread
  e2e/composer/long-composer-message.live.spec.ts      # sending and editing long messages, room and thread
  e2e/composer/slash-commands.spec.ts           # composer commands
  e2e/threads/threads.live.spec.ts                    # thread overview, opening threads, a new root
  e2e/room/room-view-defaults.spec.ts       # Threads for people, Compact for agent rooms
  e2e/threads/compact-scroll-memory.live.spec.ts      # Compact view keeps its scroll position
  e2e/threads/compact-card-display-names.live.spec.ts # Compact cards' names
  e2e/command-palette/command-palette.live.spec.ts            # the palette, desktop and phone widths
  e2e/settings/settings-search.spec.ts          # Settings pages and search, phone included
  e2e/ui/phone-back-button.spec.ts        # the phone layout's back chevron, light, dark, RTL
)

# Everything runs from main, which bash reads whole before it starts: editing this file while a
# gate runs (a shared checkout) cannot change what that run executes next.
main() {
  local args=("$@") script
  script="$(readlink -f "${BASH_SOURCE[0]}")"
  [ $# -gt 0 ] || {
    sed -n '3,4p' "$script" >&2
    exit 2
  }
  checkout="$1"
  shift
  slot=''
  corpus="${PUSH_GATE_CORPUS:-}"
  local rev=HEAD base=origin/main
  while [ $# -gt 0 ]; do
    case "$1" in
      --slot) slot="$2"; shift ;;
      --slot=*) slot="${1#--slot=}" ;;
      --corpus) corpus="$2"; shift ;;
      --corpus=*) corpus="${1#--corpus=}" ;;
      --rev) rev="$2"; shift ;;
      --rev=*) rev="${1#--rev=}" ;;
      --base) base="$2"; shift ;;
      --base=*) base="${1#--base=}" ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done
  [ -n "$slot" ] || die '--slot <n> is required'
  checkout="$(git -C "$checkout" rev-parse --show-toplevel)" || die "$checkout is not a checkout"

  if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' 2>/dev/null; then
    [ -z "${PUSH_GATE_NIX:-}" ] || die 'Node 24 is missing even in nix develop'
    exec env PUSH_GATE_NIX=1 nix develop "$checkout" --command bash "$script" "${args[@]}"
  fi

  sha="$(git -C "$checkout" rev-parse --verify --quiet "$rev^{commit}")" || die "$rev is not a commit"
  base_sha="$(git -C "$checkout" rev-parse --verify --quiet "$base^{commit}")" || die "$base is not a commit"
  local modules
  modules="$(readlink -f "$checkout/node_modules")"
  [ -d "$modules" ] || die "$checkout has no node_modules"

  local root="${PUSH_GATE_ROOT:-/tmp/mindroom-client-push-gate}"
  . "$(dirname "$script")/private-dir.sh"
  private_dir "$root"
  # Logs of gates nobody looked at for two days go.
  find "$root" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} +
  work="$root/${sha:0:12}-$(date +%Y%m%dT%H%M%S)"
  logs="$work/logs"
  results="$work/results"
  tree="$work/tree"
  mkdir -p "$logs" "$results" "$tree"
  git -C "$checkout" archive "$sha" | tar -x -C "$tree"
  ln -s "$modules" "$tree/node_modules"
  # A repository whose index and HEAD are the commit's, reading the checkout's objects: unit tests
  # read the index (src/build/executableScripts.test.ts checks the executable bits there).
  git init -q "$tree"
  echo "$(git -C "$checkout" rev-parse --path-format=absolute --git-common-dir)/objects" \
    >"$tree/.git/objects/info/alternates"
  git -C "$tree" read-tree "$sha"
  git -C "$tree" update-ref HEAD "$sha"

  trap 'rm -rf "$tree"' EXIT
  trap interrupted INT TERM

  local started=$SECONDS commits
  commits="$(git -C "$checkout" rev-list --count "$base_sha..$sha")"
  echo "push-gate: ${sha:0:12}, $commits commits after ${base_sha:0:12}; logs in $logs" >&2

  # Every check runs in the background, the e2e run too: `wait` returns on a signal, so an
  # interrupted gate stops its checks at once.
  run_check build check_build &
  local build_pid=$!
  run_check vitest check_vitest &
  local vitest_pid=$!
  run_check tsc check_tsc &
  run_check strict check_strict &
  run_check lint check_lint &
  run_check overlap check_overlap &
  run_check keys check_keys &
  run_check old-name check_old_name &
  wait "$build_pid" "$vitest_pid"
  if [ "$(cut -f 1 "$results/build")" = PASS ]; then
    run_check e2e check_e2e &
  else
    printf 'FAIL\t0\tnot run: the build failed\n' >"$results/e2e"
  fi
  wait

  local name verdict seconds detail status=PASS
  printf '\n%-9s %-6s %8s  %s\n' check result seconds detail
  for name in build tsc strict lint vitest overlap keys old-name e2e; do
    verdict=FAIL seconds=- detail='no result'
    if [ -s "$results/$name" ]; then IFS=$'\t' read -r verdict seconds detail <"$results/$name"; fi
    printf '%-9s %-6s %8s  %s\n' "$name" "$verdict" "$seconds" "$detail"
    [ "$verdict" = PASS ] || status=FAIL
  done
  printf '\npush-gate: %s for %s in %d s; logs in %s\n' "$status" "${sha:0:12}" \
    "$((SECONDS - started))" "$logs"
  [ "$status" = PASS ]
}

die() {
  echo "push-gate: $*" >&2
  exit 2
}

interrupted() {
  local pid part n
  for pid in $(jobs -p); do kill_tree "$pid"; done
  # Every slot of the list (46, 46,47 or 46-48), whose homeserver a spec may have left running.
  for part in ${slot//,/ }; do
    for n in $(seq "${part%-*}" "${part#*-}"); do
      bash "$checkout/scripts/e2e-slot.sh" "$n" down >/dev/null 2>&1 || true
    done
  done
  exit 130
}

# Stops a process the gate started and everything under it (tsc, the vitest workers, the browser),
# by PID: children first, so none is left to be adopted.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}

# Runs one check: its own output goes to its log, and $results/<name> gets PASS or FAIL, the seconds
# it took and the last line the check printed, tab-separated.
run_check() {
  local name="$1" check="$2" started=$SECONDS detail rc=0 verdict=PASS
  detail="$("$check" 2>>"$logs/$name.log")" || rc=$?
  [ "$rc" = 0 ] || verdict=FAIL
  printf '%s\t%s\t%s\n' "$verdict" "$((SECONDS - started))" "${detail##*$'\n'}" >"$results/$name"
}

check_build() {
  local rc=0
  # `true` as the command: the run builds the commit (once per commit, for every slot) and starts
  # nothing else. The first slot of a list does it.
  bash "$checkout/scripts/e2e-slot.sh" "${slot%%[,-]*}" --preview --snapshot="$sha" true \
    >"$logs/build.log" 2>&1 || rc=$?
  if [ "$rc" != 0 ]; then
    echo "exit $rc"
    return "$rc"
  fi
  # What a first visit downloads before the app runs must stay within the commit's own budget.
  local build="${E2E_SNAPSHOT_ROOT:-/tmp/mindroom-client-e2e}/builds/$sha" sizes
  node "$tree/scripts/perf/bundle-report.mjs" "$build" --budget "$tree/scripts/perf/bundle-budget.json" \
    >"$logs/bundle.log" 2>&1 || rc=$?
  sizes="$(grep -E '^(ok  |FAIL) initial JS' "$logs/bundle.log" | sed -E 's/^(ok  |FAIL) //')"
  if [ "$rc" = 0 ]; then
    echo "vite build and the spec fixture pages; $sizes"
  else
    echo "over the bundle budget (scripts/perf/bundle-budget.json): $sizes; see $logs/bundle.log"
  fi
  return "$rc"
}

check_tsc() {
  local rc=0
  (cd "$tree" && npx tsc --noEmit -p tsconfig.app.json) >"$logs/tsc.log" 2>&1 || rc=$?
  echo "$(grep -c 'error TS' "$logs/tsc.log") errors, exit $rc"
  return "$rc"
}

check_strict() {
  local rc=0
  (cd "$tree" && node scripts/strict-check.mjs) >"$logs/strict.log" 2>&1 || rc=$?
  tail -n 1 "$logs/strict.log" | sed 's/^strict-check: //'
  return "$rc"
}

check_lint() {
  local rc=0 files=() scope problems
  mapfile -t files < <(
    git -C "$checkout" diff --name-only --diff-filter=ACMR "$base_sha...$sha" -- \
      src e2e scripts vite.config.js vitest.config.ts .eslintrc.cjs .eslintrc.plugin.cjs | grep -E '\.(ts|tsx|js|mjs|cjs)$' || true
  )
  if printf '%s\n' "${files[@]}" | grep -qxE '\.eslintrc\.cjs|scripts/eslint-shared\.cjs'; then
    scope='every file (the ESLint config changed)'
    (cd "$tree" && npm run lint) >"$logs/lint.log" 2>&1 || rc=$?
  elif [ ${#files[@]} -eq 0 ]; then
    echo 'no changed files to lint'
    return 0
  else
    scope="${#files[@]} changed files"
    (cd "$tree" && npx eslint -- "${files[@]}") >"$logs/lint.log" 2>&1 || rc=$?
  fi
  problems="$(grep -oE '[0-9]+ problems? \([0-9]+ errors?' "$logs/lint.log" | tail -n 1 || true)"
  echo "$scope: ${problems:-0 problems (0 errors}), exit $rc"
  return "$rc"
}

check_vitest() {
  local rc=0 files tests failed=() again
  (cd "$tree" && bash scripts/with-fhs-bin.sh npx vitest run --reporter=default --reporter=json \
    --outputFile.json="$work/vitest.json") >"$logs/vitest.log" 2>&1 || rc=$?
  files="$(sed -nE 's/^ *Test Files +//p' "$logs/vitest.log" | tail -n 1)"
  tests="$(sed -nE 's/^ *Tests +//p' "$logs/vitest.log" | tail -n 1)"
  if [ "$rc" != 0 ] && [ -s "$work/vitest.json" ]; then
    mapfile -t failed < <(node -e 'for (const file of require(process.argv[1]).testResults)
      if (file.status === "failed") console.log(file.name)' "$work/vitest.json")
  fi
  if [ ${#failed[@]} -eq 0 ]; then
    echo "files ${files:-?}; tests ${tests:-?}"
    return "$rc"
  fi
  # A loaded machine can starve a test past its timeout or a timer window. The files that failed run
  # once more on their own, and only a second failure fails the gate; the detail names the count.
  rc=0
  (cd "$tree" && bash scripts/with-fhs-bin.sh npx vitest run "${failed[@]}") \
    >"$logs/vitest-rerun.log" 2>&1 || rc=$?
  again="$(sed -nE 's/^ *Test Files +//p' "$logs/vitest-rerun.log" | tail -n 1)"
  if [ "$rc" = 0 ]; then
    echo "files ${files:-?}; tests ${tests:-?}; the ${#failed[@]} failed files passed on a rerun (flaky)"
  else
    echo "files ${files:-?}; tests ${tests:-?}; rerun of the ${#failed[@]} failed files: ${again:-?}"
  fi
  return "$rc"
}

check_overlap() {
  local rc=0 found all
  [ -n "$corpus" ] || {
    echo 'no corpus: pass --corpus <upstream clone> or set PUSH_GATE_CORPUS'
    return 1
  }
  # --history reads the commits of every ref and HEAD; a commit on none of them would go unread.
  if ! git -C "$checkout" merge-base --is-ancestor "$sha" HEAD &&
    [ -z "$(git -C "$checkout" for-each-ref --contains "$sha" --count=1)" ]; then
    echo "${sha:0:12} is on no ref of the checkout, so --history would not read it"
    return 1
  fi
  python3 "$checkout/scripts/upstream-overlap/check.py" --corpus "$corpus" --history \
    --out "$work/overlap.tsv" >"$logs/overlap.log" 2>&1 || rc=$?
  [ -f "$work/overlap.tsv" ] || {
    echo "check.py failed, exit $rc"
    return 1
  }
  git -C "$checkout" rev-list --objects "$sha" | cut -d ' ' -f 1 >"$work/reachable.txt"
  awk -F '\t' 'NR == FNR { reachable[$1] = 1; next } $1 in reachable' "$work/reachable.txt" \
    "$work/overlap.tsv" >"$work/overlap-reachable.tsv"
  cat "$work/overlap-reachable.tsv" >>"$logs/overlap.log"
  found="$(wc -l <"$work/overlap-reachable.tsv")"
  all="$(wc -l <"$work/overlap.tsv")"
  echo "$found findings reachable from ${sha:0:12}, $((all - found)) only on other refs"
  [ "$found" = 0 ]
}

check_keys() {
  local key_file="${PUSH_GATE_KEY_FILE:-$HOME/.config/mindroom-chat/llm.env}"
  [ -r "$key_file" ] || {
    echo "cannot read the key file $key_file (set PUSH_GATE_KEY_FILE)"
    return 1
  }
  python3 - "$checkout" "$base_sha" "$sha" "$key_file" <<'PY'
import subprocess
import sys

checkout, base, rev, key_file = sys.argv[1:]
keys = {}
with open(key_file, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        name, sep, value = line.partition("=")
        value = value.strip().strip("'\"")
        # Short values (flags, ports) would match everywhere and are no secrets.
        if sep and not name.startswith("#") and len(value) >= 8:
            keys[name.strip()] = value.encode()
if not keys:
    print(f"no key values in {key_file}")
    sys.exit(1)
listing = subprocess.run(
    ["git", "-C", checkout, "rev-list", "--objects", rev, "--not", base],
    capture_output=True, text=True, check=True,
).stdout.splitlines()
objects = [(line.split(" ", 1) + [""])[:2] for line in listing if line]
cat = subprocess.Popen(["git", "-C", checkout, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
hits = []
for oid, path in objects:
    cat.stdin.write(f"{oid}\n".encode())
    cat.stdin.flush()
    header = cat.stdout.readline().split()
    if len(header) < 3:
        continue
    body = cat.stdout.read(int(header[2]))
    cat.stdout.read(1)
    for name, value in keys.items():
        if value in body:
            hits.append(f"{name} in {header[1].decode()} {path or oid[:12]}")
cat.stdin.close()
cat.wait()
# Names and places only: a value never reaches the output.
for hit in hits:
    print(hit, file=sys.stderr)
print(f"{len(hits)} hits of {len(keys)} keys in {len(objects)} new objects")
sys.exit(1 if hits else 0)
PY
}

check_old_name() {
  local count total
  # The old name of the upstream client, written as a pattern so this file does not contain it.
  git -C "$checkout" log --format='%h %s' -i --grep='c[i]nny' "$base_sha..$sha" >"$logs/old-name.log"
  count="$(wc -l <"$logs/old-name.log")"
  total="$(git -C "$checkout" rev-list --count "$base_sha..$sha")"
  echo "$count of $total commit messages"
  [ "$count" = 0 ]
}

check_e2e() {
  local rc=0 spec missing=() counts specs passed failed flaky skipped idle first
  for spec in "${SMOKE_SPECS[@]}"; do
    git -C "$checkout" cat-file -e "$sha:$spec" 2>/dev/null || missing+=("$spec")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "not in ${sha:0:12}: ${missing[*]}"
    return 1
  fi
  # e2e-suite.sh writes one row per spec and exits 0 whatever the specs did, so the rows decide.
  bash "$checkout/scripts/e2e-suite.sh" --rev "$sha" --slots "$slot" --out "$work/e2e.tsv" \
    "${SMOKE_SPECS[@]}" >"$logs/e2e.log" 2>&1 || rc=$?
  [ -s "$work/e2e.tsv" ] || {
    echo "no results, exit $rc"
    return 1
  }
  # Skips are fine (a spec's opt-in screenshots), but a spec that ran no test at all checked nothing.
  counts="$(awk -F '\t' 'NR > 1 { p += $2; f += $3; s += $4 + $10; k += $6; if ($2 + $3 + $6 == 0) idle++ }
    END { printf "%d %d %d %d %d %d", NR - 1, p, f, k, s, idle }' "$work/e2e.tsv")"
  read -r specs passed failed flaky skipped idle <<<"$counts"
  # The first failure's spec and error, so the table says why (a port another program took, say).
  first="$(awk -F '\t' 'NR > 1 && $3 > 0 { print $1 ": " substr($5, 1, 120); exit }' "$work/e2e.tsv")"
  echo "$specs of ${#SMOKE_SPECS[@]} specs: $passed passed, $failed failed, $flaky flaky, $skipped skipped; $idle specs ran no test${first:+; first: $first}"
  [ "$rc" = 0 ] && [ "$specs" = "${#SMOKE_SPECS[@]}" ] && [ "$failed" = 0 ] && [ "$idle" = 0 ]
}

# One line, read whole before main runs, so nothing after it is read from a file edited meanwhile.
main "$@"; exit
