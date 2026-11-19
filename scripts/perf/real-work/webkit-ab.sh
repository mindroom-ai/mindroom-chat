#!/usr/bin/env bash
# Throwaway: one job that runs the real-work spec several times on one slot, one engine per run,
# with the history made once. Runs on the host in the job's worktree (remote-test.sh exec).
#   WK_SLOT   the e2e slot
#   WK_ORDER  engines in order, e.g. chromium,webkit,chromium,webkit
#   WK_RUN    the run directory's name under /tmp
# Results: test-results/perf/run<i>-<engine>/ in the job's worktree.
set -u
slot=${WK_SLOT:?}
order=${WK_ORDER:?}
order=${order//,/ }
run=${WK_RUN:?}
case "$run" in wk-*) ;; *) echo "webkit-ab: bad WK_RUN" >&2; exit 2 ;; esac
run_dir=/tmp/$run
export E2E_SNAPSHOT_ROOT=$run_dir/snap E2E_AGENT_STACK_ROOT=$run_dir/agents
export PERF_REAL_WORK=1
export PLAYWRIGHT_WEBKIT_EXECUTABLE=${PLAYWRIGHT_WEBKIT_EXECUTABLE:-$(ls -d "$HOME"/Library/Caches/ms-playwright/webkit-*/pw_run.sh | tail -n 1)}
job=$PWD
export WK_OUT=$job/test-results/perf
finish() {
  cd "$job" && python3 scripts/agent-stack/stack.py "$slot" down || true
  case "$run_dir" in
    /tmp/wk-*) cd / && rm -rf "$run_dir" ;;
  esac
}
trap finish EXIT
mkdir -p "$E2E_SNAPSHOT_ROOT" "$E2E_AGENT_STACK_ROOT" "$WK_OUT"
echo "webkit-ab: webkit=$PLAYWRIGHT_WEBKIT_EXECUTABLE order=$order"
# shellcheck disable=SC2016
scripts/e2e-slot.sh "$slot" --snapshot --preview bash -c '
  i=0
  for engine in '"$order"'; do
    i=$((i + 1))
    echo "webkit-ab: run $i $engine starts $(date +%H:%M:%S)"
    npx playwright test e2e/perf/real-work.live.spec.ts --project="$engine"
    rc=$?
    mkdir -p "$WK_OUT/run$i-$engine"
    cp -a test-results/perf/real-work/. "$WK_OUT/run$i-$engine/" || true
    echo "$rc" >"$WK_OUT/run$i-$engine/exit"
    echo "webkit-ab: run $i $engine exit $rc $(date +%H:%M:%S)"
  done
'
