#!/usr/bin/env bash
# Run e2e/perf/real-work.live.spec.ts for one commit on several runner hosts and slots at once, and
# collect each run's test-results/perf/real-work/ into <out dir>/<host>-<slot>/.
#
# Usage: matrix.sh <commit> <out dir> <host>:<slot>[,<host>:<slot>...] [-- NAME=VALUE...]
#   host   a remote-test.sh host: m5, m2, mw, dev or gce (~/repos/dev/scripts/mac-runner/remote-test.sh)
#   slot   the e2e slot (scripts/e2e-slot.sh): its own homeserver (28100+n) and app port (4300+n);
#          two runs on one host need different slots, and a slot must not be in use by another session
#   NAME=VALUE  environment for the spec, passed with --env: PERF_WORKLOAD, PERF_STREAMS,
#          PERF_CPU_THROTTLE, PERF_SCENARIOS, PERF_PROFILE, ... (see the spec's header);
#          PERF_REAL_WORK=1 is always set
#
# Example:
#   scripts/perf/real-work/matrix.sh "$(git rev-parse HEAD)" /tmp/rw gce:81,gce:82 -- \
#     PERF_WORKLOAD=e2e/perf/workloads/real-work-smoke.json PERF_CPU_THROTTLE=1
#   node scripts/perf/real-work/compare.mjs --base /tmp/rw/gce-81 --head /tmp/rw/gce-82
#
# The spec starts a real MindRoom agent stack, which runs on gce-dev (gce) and pc only. Agent specs
# skip silently on macbook-work (mw), and the M5 is not verified for the stack, so use gce for
# numbers you trust; this script only prints what failed. Never use it for the spec's external
# (real-data) mode on gce or mw. Run it from the checkout that holds the commit (remote-test.sh
# looks there); a commit that exists only locally is pushed to the runner's clone, never to GitHub.
# Check a MacBook's power and load first with ~/repos/machines.sh: no jobs on battery. Start more
# than 8 jobs on gce in waves.
#
# On gce every run keeps its temporary files, snapshot and agent stack under /work/tmp/<run>, the
# encrypted disk, with TMPDIR=/work/tmp; the run directory is left behind (remove it by hand).
# Exits non-zero when any run failed or left no results, and lists which.
set -euo pipefail

runner="${MRC_REMOTE_TEST:-$HOME/repos/dev/scripts/mac-runner/remote-test.sh}"
timeout_s="${MATRIX_TIMEOUT:-14400}"

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ "$#" -ge 3 ] || usage
commit_ref=$1
out=$2
targets=$3
shift 3
env_args=()
if [ "$#" -gt 0 ]; then
  [ "$1" = -- ] || usage
  shift
  for assignment in "$@"; do
    case "$assignment" in
      [A-Za-z_]*=*) env_args+=(--env "$assignment") ;;
      *) echo "matrix: not a NAME=VALUE assignment: $assignment" >&2; exit 2 ;;
    esac
  done
fi

commit=$(git rev-parse --verify "$commit_ref^{commit}")
mkdir -p "$out"
out=$(cd "$out" && pwd)

pids=()
names=()
IFS=',' read -r -a entries <<<"$targets"
for entry in "${entries[@]}"; do
  host=${entry%%:*}
  slot=${entry#*:}
  case "$slot" in '' | *[!0-9]*) echo "matrix: bad host:slot entry: $entry" >&2; exit 2 ;; esac
  [ "$host" != "$entry" ] || { echo "matrix: bad host:slot entry: $entry" >&2; exit 2; }
  name=$host-$slot
  for seen in "${names[@]:-}"; do
    [ "$seen" != "$name" ] || { echo "matrix: $name given twice" >&2; exit 2; }
  done
  names+=("$name")
done

run_one() {
  local name=$1 host=$2 slot=$3
  local log="$out/$name.log" run="rw-${commit:0:8}-$name"
  local base=/tmp
  local run_env=(--env PERF_REAL_WORK=1)
  if [ "$host" = gce ]; then
    base=/work/tmp
    run_env+=(--env TMPDIR=/work/tmp)
  fi
  run_env+=(--env "E2E_SNAPSHOT_ROOT=$base/$run/snap" --env "E2E_AGENT_STACK_ROOT=$base/$run/agents")
  # The inner script runs on the host, in the commit's worktree. A snapshot run leaves its
  # test-results/ in the snapshot, so the script copies the perf results into the worktree's, which
  # --artifacts brings back.
  "$runner" --artifacts --timeout "$timeout_s" "${run_env[@]}" "${env_args[@]}" \
    "$host" "$commit" exec bash -c \
    "mkdir -p \"\$E2E_SNAPSHOT_ROOT\" \"\$E2E_AGENT_STACK_ROOT\"; rc=0; scripts/e2e-slot.sh $slot --snapshot --preview npx playwright test e2e/perf/real-work.live.spec.ts || rc=\$?; mkdir -p test-results/perf; cp -a \"\$E2E_SNAPSHOT_ROOT/slot-$slot/test-results/perf/real-work\" test-results/perf/ || true; exit \$rc" \
    >"$log" 2>&1
}

for name in "${names[@]}"; do
  run_one "$name" "${name%-*}" "${name##*-}" &
  pids+=("$!")
done

failed=()
for i in "${!names[@]}"; do
  name=${names[$i]}
  rc=0
  wait "${pids[$i]}" || rc=$?
  log="$out/$name.log"
  # remote-test.sh names the job's result directory in its output; copy at once (others clean it up).
  results=$(sed -n 's/^mrc: test results in //p' "$log" | tail -n 1)
  if [ -n "$results" ] && [ -d "$results/perf/real-work" ]; then
    rm -rf "${out:?}/$name"
    mkdir -p "$out/$name"
    cp -a "$results/perf/real-work/." "$out/$name/"
    echo "matrix: $name exit $rc, results in $out/$name"
  else
    echo "matrix: $name exit $rc, no perf results (log: $log)" >&2
    [ "$rc" != 0 ] || rc=1
  fi
  [ "$rc" = 0 ] || failed+=("$name (exit $rc)")
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "matrix: failed: ${failed[*]}" >&2
  exit 1
fi
