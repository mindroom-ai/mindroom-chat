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
run_dir=${WK_TMP:-/tmp}/$run
export E2E_SNAPSHOT_ROOT=$run_dir/snap E2E_AGENT_STACK_ROOT=$run_dir/agents
export PERF_REAL_WORK=1
export PLAYWRIGHT_WEBKIT_EXECUTABLE=${PLAYWRIGHT_WEBKIT_EXECUTABLE:-$(ls -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"/webkit-*/pw_run.sh | tail -n 1)}
if [ "$(uname)" = Linux ]; then
  # Playwright's WebKit runs on NixOS only inside the runner's FHS environment (as the runner's e2e jobs start it).
  runner=${MRC_RUNNER:-/work/mrc-runner}
  raw=$(ls -d "$runner"/ms-playwright/webkit-*/pw_run.sh | tail -n 1)
  mkdir -p "$run_dir"
  printf '#!%s\nexec %q %q "$@"\n' "$runner/nix/tools/bin/bash" "$runner/nix/webkit-fhs/bin/mrc-webkit-fhs" "$raw" >"$run_dir/webkit"
  chmod 755 "$run_dir/webkit"
  export PLAYWRIGHT_WEBKIT_EXECUTABLE=$run_dir/webkit
fi
job=$PWD
export WK_OUT=$job/test-results/perf
finish() {
  # A second copy of the results outside the job's worktree: the runner lost a job's test-results once.
  keep=${WK_KEEP:-$HOME/mrc-runner/logs}
  mkdir -p "$keep" && tar -czf "$keep/$run-perf.tgz" -C "$job/test-results" perf 2>/dev/null || true
  cd "$job" && python3 scripts/agent-stack/stack.py "$slot" down || true
  case "$run_dir" in
    */wk-*) cd / && rm -rf "$run_dir" ;;
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
    # engine:hogs sets the CPU hogs of that run.
    # engine:hogs:press ms:CPU throttle set those of that run.
    IFS=: read -r engine hogs press throttle <<<"$engine"
    [ -z "$hogs" ] || export PERF_HOGS=$hogs
    [ -z "$press" ] || export PERF_PRESS_MS=$press
    [ -z "$throttle" ] || export PERF_CPU_THROTTLE=$throttle
    echo "webkit-ab: run $i $engine hogs ${PERF_HOGS:-0} press ${PERF_PRESS_MS:-0} ms throttle ${PERF_CPU_THROTTLE:-} starts $(date +%H:%M:%S)"
    # WK_CPUS: the test, its browser and its CPU hogs share these cores (a small loaded machine on a large one).
    ${WK_CPUS:+taskset -c "$WK_CPUS"} npx playwright test e2e/perf/real-work.live.spec.ts --project="$engine"
    rc=$?
    mkdir -p "$WK_OUT/run$i-$engine"
    cp -a test-results/perf/real-work/. "$WK_OUT/run$i-$engine/" || true
    echo "$rc" >"$WK_OUT/run$i-$engine/exit"
    find test-results -name error-context.md -exec cp {} "$WK_OUT/run$i-$engine/" \; 2>/dev/null || true
    echo "webkit-ab: run $i $engine exit $rc $(date +%H:%M:%S)"
  done
'
