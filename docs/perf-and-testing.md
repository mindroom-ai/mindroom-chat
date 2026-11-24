# Performance and testing scripts

Operational reference for the performance tools under `scripts/perf/` and the testing, isolation, and verification scripts under `scripts/`. For setup, `just` recipes, and native shell builds, see [`development.md`](development.md) and [`AGENTS.md`](../AGENTS.md).

## Performance scripts (`scripts/perf/`)

| Script / directory                                                                                                   | Purpose                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `scripts/perf/bundle-report.mjs`, `bundle-budget.json`                                                               | Measure initial/on-demand JS and CSS sizes (raw/gzip/brotli), attribute bytes via source maps, and enforce CI's gzip budget |
| `scripts/perf/replay/` (`capture.mjs`, `multiplier.mjs`, `server.mjs`, `replay.test.mjs`, `sdk-integration.test.ts`) | Capture real Matrix/MindRoom activity read-only and replay it locally with `K`x threads, `R`x rooms, and `S`x speed         |
| `scripts/perf/real-work/` (`driver.py`, `matrix.sh`, `compare.mjs`, `test_driver.py`, `compare.test.mjs`)            | Drive synthetic streaming agent workloads against `agent-stack`, orchestrate multi-slot remote runs, and compare commits    |
| `scripts/perf/cpuprofile-summary.mjs`                                                                                | Summarize `.cpuprofile` self/total times and de-minify production frames using matching sourcemaps                          |
| `scripts/perf/trace-summary.mjs`                                                                                     | Summarize renderer main-thread (`CrRendererMain`) self and total time from Chrome `.trace.json` files                       |
| `scripts/perf/seed-large-room.py`                                                                                    | Seed a large threaded room on a disposable slot for `e2e/timeline/perf-large-room-streaming.live.spec.ts`                   |
| `scripts/perf/webkit-insert-probe.mjs`                                                                               | Benchmark and bisect message-row insertion and style-invalidation cost in Chromium and WebKit without a homeserver          |

### Real-activity replay harness (`scripts/perf/replay/`)

#### Privacy and safety

- **Local-only captures outside git:** store captures outside any git repository or worktree (for example `/tmp` or `~/.cache`). `capture.mjs` refuses paths inside a git repo, sets `chmod 0700` on capture directories and `0600` on files (`manifest.json`, `snapshot.json`, `live.jsonl`, `blobs/*`). Never commit, upload, or share captures.
- **Dedicated temporary capture device:** live capture (`--duration > 0`) calls `GET /_matrix/client/v3/sync?since=...`, which advances the homeserver's sync cursor and acknowledges to-device messages on that device. Always create a fresh temporary login/device, pass `--device-id <id>` matching `/_matrix/client/v3/account/whoami`, never reuse an active MindRoom Chat session token, and log out or delete the capture device afterwards (or pass `--duration 0` for a snapshot-only capture).
- **Personal machines only:** never capture real data or run real-data replay benchmarks on shared runners (`gce`) or work machines (`mw`).
- **Read-only capture and loopback isolation:** `capture.mjs` issues `GET` requests only with `set_presence=offline` (no filter creation, posts, receipts, or presence flips). `server.mjs` binds strictly to `127.0.0.1`, generates a per-run random password and bearer token, restricts CORS to loopback origins, and rejects non-loopback `Host` headers (`403`). Playwright external mode runs in Chromium only and blocks non-loopback HTTP, WebSockets, redirects (via a closed loopback proxy), and non-proxied WebRTC UDP.

#### Capturing a bundle (`scripts/perf/replay/capture.mjs`)

```bash
MINDROOM_CAPTURE_TOKEN="<temp-device-token>" \
  node scripts/perf/replay/capture.mjs \
  --homeserver https://matrix.example.test \
  --device-id CAPTURE_DEV_1 \
  --out /tmp/mindroom-replay-capture \
  --duration 60
```

| Option                 | Default                      | Description                                                                                                     |
| ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--homeserver <url>`   | required                     | Matrix homeserver base URL                                                                                      |
| `--token-file <path>`  | `$MINDROOM_CAPTURE_TOKEN`    | File containing bearer token (alternative to env var)                                                           |
| `--device-id <id>`     | required if `--duration > 0` | Must match `device_id` returned by `/_matrix/client/v3/account/whoami`                                          |
| `--out <dir>`          | required                     | Output directory outside any git repo (`0700`, files `0600`)                                                    |
| `--rooms <id1,id2>`    | all joined non-space rooms   | Comma-separated room IDs to paginate threads, relations, and history for                                        |
| `--duration <sec>`     | `60`                         | Live `/v3/sync` long-poll duration in seconds (`0` for snapshot-only)                                           |
| `--max-threads <n>`    | `600`                        | Maximum thread roots paginated per focused room via `/v1/rooms/{r}/threads`                                     |
| `--heavy-threads <n>`  | `25`                         | Top threads per focused room backfilled via `/v1/rooms/{r}/relations/{root}/m.thread` (up to 1000 replies each) |
| `--max-blobs <n>`      | `500`                        | Max referenced `mxc://` blobs downloaded (prioritizing `io.mindroom.long_text` sidecars)                        |
| `--max-blob-bytes <n>` | `2097152` (2 MiB)            | Per-blob size limit; oversized responses abort before buffering                                                 |

Bundle layout written to `--out`: `manifest.json` (metadata, viewer MXID, `primaryRoomId`, stats, `blobIndex`), `snapshot.json` (`initialSync` plus per-room `threads`, `threadRelations`, `messagesTail`, `members`), `live.jsonl` (`{ tauMs, response }` incremental sync entries), and `blobs/<sha256>`.

#### Running replay benchmarks (`e2e/perf/real-work.live.spec.ts`)

Replay mode runs inside `PERF_TARGET=external` (Chromium only; any other engine throws before launching a browser). All 7 scenarios run (`compact-idle`, `compact-scroll`, `thread-open`, `thread-idle`, `thread-type`, `switch`, `cold-load`), plus `soak` when `PERF_SOAK=1`:

```bash
PERF_REAL_WORK=1 PERF_TARGET=external \
  PERF_REPLAY_CAPTURE=/tmp/mindroom-replay-capture \
  PERF_MULTIPLY_THREADS=4 PERF_MULTIPLY_ROOMS=1 PERF_REPLAY_SPEED=1 \
  PERF_CPU_THROTTLE=1,4 \
  just e2e-slot 12 --snapshot --preview npx playwright test --project=chromium e2e/perf/real-work.live.spec.ts
```

- **Replay env vars:** `PERF_REPLAY_CAPTURE` (bundle directory), `PERF_MULTIPLY_THREADS` (default `1`), `PERF_MULTIPLY_ROOMS` (default `1`), `PERF_REPLAY_SPEED` (default `1`, minimum `0.01`).
- **Spec knobs:** `PERF_CPU_THROTTLE` (comma-separated rates, default `1,4`), `PERF_SCENARIOS` (comma-separated subset, default all), `PERF_VIEWPORT` (`phone` for 390x844 touch, default 1440x900), `PERF_PROFILE=1` (writes `<label>.cpuprofile`), `PERF_TRACE=1` (writes `<label>.trace.json`), `PERF_SOAK=1` (adds `soak` alternating 60s Compact / 60s thread; fails if heap grows > 50 MB), `PERF_SOAK_MINUTES` (default `20`), `PERF_SOAK_GC=1` (forces GC before each 5s soak sample).
- **Results and comparison:** results go to `test-results/perf/real-work/<scenario>-<engine>-<throttle>x-<suffix>.json`, where `<suffix>` is `replay-<K>x` (plus `-<R>r` if `R > 1` and `-speed<S>` if `S != 1`). Replay results record 5s telemetry in `achieved` with `target: null`, so `scripts/perf/real-work/compare.mjs` compares medians across runs without applying the synthetic fixed-stream 80% shortfall exclusion (failed or crashed runs are still excluded).

#### Standalone replay server and multiplier (`server.mjs`, `multiplier.mjs`)

Run `server.mjs` directly to inspect or test against a multiplied capture:

```bash
node scripts/perf/replay/server.mjs --capture /tmp/mindroom-replay-capture \
  --port 0 --multiply-threads 4 --multiply-rooms 2 --speed 1 --print-ready
```

- **CLI options:** `--capture <dir>` (required), `--port <n>` (default `0`, ephemeral on `127.0.0.1`), `--multiply-threads <K>` (default `1`), `--multiply-rooms <R>` (default `1`), `--speed <S>` (default `1`), `--stats-file <path>` (5s JSONL telemetry matching `driver.py`), `--target-room <roomId>` (primary room override), `--print-ready` (prints one JSON handshake line on stdout with `url`, `userId`, `username`, `password`, `accessToken`, `roomId`, `roomName`).
- **Control routes** (require `Authorization: Bearer <accessToken>`): `GET /__replay/status` returns replay state and counters; `POST /__replay/reset` resets the replay timeline while keeping `syncSeq` monotonic.
- **How `multiplier.mjs` works:**
  - Staggers `K` in-room thread copies deterministically across `durationMs` (`offsetMs = floor((k / K) * durationMs)`) and clones non-space rooms `R`x (`!local__r{r}:domain`, duplicating `m.space.child` links in parent spaces), interleaving cloned timeline history in ascending `origin_server_ts` order.
  - Mints generation-scoped IDs for live-created events (`$id__r{r}_k{k}_g{gen}`) so looped playback never emits duplicate `event_id`s, while snapshot-era events use `$id__r{r}_k{k}` (copy `(0, 0)` keeps original IDs).
  - Remaps pointers copy-on-write (sharing heavy bodies/tool traces by reference): Matrix relations/summaries (`m.relates_to`, `m.replace`, `m.thread`, `redacts`, `m.room.pinned_events`), MindRoom content/state (`io.mindroom.fork`, `io.mindroom.ui_action`, `io.mindroom.tool_approval`, `com.mindroom.voice_source_event_id`, `io.mindroom.pinned_canvases`, `com.mindroom.thread.tags`, `io.mindroom.thread_summary`, `com.mindroom.scheduled.task`), and `m.receipt`.
  - Merges agent-keyed room state (`io.mindroom.background_jobs` and `io.mindroom.active_runs`, in both `state.events` and timeline state events) across copies `k = 0..K-1` per `(roomId, agentUserId)`, summing totals, unioning `threads[]`, and re-stamping timestamps so active runs never TTL-expire.
  - Materializes `LiveDocs` across warmup deltas (`tauMs <= offsetMs`) for `io.mindroom.live` (and `io.mindroom.subagents`) so mid-stream clients always receive a valid `snapshot` frame with monotonic `sid` and contiguous `seq` before subsequent `delta`s.

#### Replay tests

```bash
node --test scripts/perf/replay/replay.test.mjs          # also run by `just script-tests`
npx vitest run scripts/perf/replay/sdk-integration.test.ts  # also run by `just test`
```

### CPU profiles and Chrome traces

- **`scripts/perf/cpuprofile-summary.mjs`**: prints top self and total times from a `.cpuprofile` (`PERF_PROFILE=1` in `real-work.live.spec.ts` or `PERF_CPU_PROFILE=1` in `client-speed.live.spec.ts`):
  ```bash
  node scripts/perf/cpuprofile-summary.mjs <file.cpuprofile> \
    [--maps <sourcemap-dist> --build <served-dist>] [--top 30] [--callers '<regex>']
  ```
  To de-minify production frames, build matching sourcemaps in a clean archive copy without `.git` so `MINDROOM_BUILD_VERSION` and chunk layout match the served build (`matrix.sh` saves `served-build/assets/` beside results for `--build`):
  ```bash
  git archive <commit> | tar -x -C <copy> && ln -s "$PWD/node_modules" <copy>/node_modules
  (cd <copy> && MINDROOM_BUILD_VERSION=<commit> npx vite build --sourcemap --outDir maps --emptyOutDir)
  ```
  Stderr chunk-mismatch warnings mean either `--build` is missing a chunk whose stem matches multiple maps (those frames remain minified) or a sourcemap chunk's code differs from the served chunk (frames may resolve to a neighboring function; rebuild until the warning clears).
- **`scripts/perf/trace-summary.mjs`**: reports busiest `CrRendererMain` self time (excluding nested children) and total time by event from a `.trace.json` (`PERF_TRACE=1`):
  ```bash
  node scripts/perf/trace-summary.mjs <file.trace.json> [--top 20]
  ```

### Synthetic real-work load (`scripts/perf/real-work/`)

- **Synthetic mode** (`e2e/perf/real-work.live.spec.ts` with `PERF_REAL_WORK=1` and `PERF_TARGET` unset): runs `driver.py` against a slot's `agent-stack` using `PERF_WORKLOAD` (default `e2e/perf/workloads/real-work-census.json`; other profiles: `real-work-smoke.json`, `real-work-live.json`, `real-work-50.json`, `real-work-50-agents.json`) and `PERF_STREAMS` (comma-separated stream targets, default the profile's `live.streams`).
- **Static external mode** (`PERF_REAL_WORK=1 PERF_TARGET=external` without `PERF_REPLAY_CAPTURE`, Chromium only): measures an already-populated local account using `PERF_HOMESERVER` (`127.0.0.1` or `localhost` only), `PERF_USERNAME`, `PERF_PASSWORD`, and `PERF_ROOM`. Runs 5 scenarios (`thread-open`, `thread-type`, `switch`, `cold-load`, `compact-scroll`) with suffix `-external` and `target: null`.
- **`driver.py`**: drives `#work` turns against the stub backend in two phases:
  ```bash
  python3 scripts/perf/real-work/driver.py --stack <state.json> --profile <profile.json> \
    --phase history|live [--history <file>] [--streams N] [--seconds S] [--ramp S] [--seed N] --out <file>
  ```
  Defaults: `--ramp 0`, `--seed 1`; `--phase live` requires `--history`, writes 5s JSONL telemetry to `--out`, and exits `0` on clean stop, `1` on setup/sync error, or `2` on shortfall (< 80% of target streams).
- **`matrix.sh`**: runs synthetic `real-work.live.spec.ts` in parallel across remote `host:slot` targets via `MRC_REMOTE_TEST` (default `~/repos/dev/scripts/mac-runner/remote-test.sh`, timeout `MATRIX_TIMEOUT` default `14400`s) and copies results plus `served-build/assets/`:
  ```bash
  scripts/perf/real-work/matrix.sh <commit> <out-dir> <host>:<slot>[,<host>:<slot>...] [-- NAME=VALUE...]
  ```
  Synthetic-only: refuses `PERF_TARGET`, `PERF_HOMESERVER`, `PERF_USERNAME`, `PERF_PASSWORD`, `PERF_ROOM` (and its own `E2E_SNAPSHOT_ROOT`, `E2E_AGENT_STACK_ROOT`, `TMPDIR`).
- **`compare.mjs`**: computes per-label, per-metric medians, percent change, and range overlap across run directories:
  ```bash
  node scripts/perf/real-work/compare.mjs --base <dir>... --head <dir>... [--json]
  ```
  Automatically excludes results with `driverExit`, `failed`, or synthetic shortfall (`achieved.streaming < 0.8 * target`), logging excluded labels to stderr. Unit tests (`test_driver.py`, `compare.test.mjs`) run in `just script-tests`.

### Bundle size and other perf tools

- **Bundle size (`scripts/perf/bundle-report.mjs`, `bundle-budget.json`)**:
  ```bash
  just bundle-report [<dist>] [--json <file>] [--sources]
  node scripts/perf/bundle-report.mjs [dist] [--json <file>] [--sources] [--budget scripts/perf/bundle-budget.json]
  ```
  Checks initial JS, entry JS, and initial CSS gzip bytes against `bundle-budget.json` (exit `1` when over). Build with `npx vite build --manifest` for stable source-module chunk names that diff cleanly between builds, and `npx vite build --sourcemap` to enable `--sources` attribution (and per-plugin sizes when `MINDROOM_CLIENT_PLUGINS` is set). Tested by `scripts/perf/bundle-report.test.mjs` (`just script-tests`).
- **Large-room seeding (`scripts/perf/seed-large-room.py`)**: seeds `<threads>` roots (default `300`), `<replies>` replies each (default `5`), and `<edits>` edits per reply (default `2`) on a slot and writes the manifest read via `PERF_STRESS_MANIFEST` by `e2e/timeline/perf-large-room-streaming.live.spec.ts` (pass the printed `E2E_USERNAME`/`E2E_PASSWORD` and slot `E2E_HOMESERVER`):
  ```bash
  scripts/e2e-slot.sh <n> python3 scripts/perf/seed-large-room.py /tmp/large-room.json [threads] [replies] [edits]
  ```
- **WebKit insertion probe (`scripts/perf/webkit-insert-probe.mjs`)**: benchmarks and bisects row-insertion and style-invalidation cost without a homeserver. Pair with an HTML snapshot from `PERF_WEBKIT_SNAPSHOT=/tmp/thread.html scripts/e2e-slot.sh <n> --preview npx playwright test e2e/perf/webkit-insert-snapshot.live.spec.ts`:
  ```bash
  node scripts/perf/webkit-insert-probe.mjs [--page <file>] [--dist dist] [--rows 1000] \
    [--runs 7] [--engines chromium,webkit] [--bisect] [--top 15] [--floor <ms>] [--json <file>]
  ```
  Reads `CHROMIUM_PATH` and `PLAYWRIGHT_WEBKIT_EXECUTABLE` when set.

## Testing and verification scripts (`scripts/`)

| Script                                                                                          | Purpose                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/e2e-slot.sh` (`just e2e-slot`)                                                         | Run commands in an isolated slot (`0-99`) with dedicated homeserver, app port, optional clean snapshot, preview build, and RTC     |
| `scripts/e2e-suite.sh` (`just e2e-suite`), `e2e-results-tsv.mjs`                                | Run all or selected E2E specs for a commit across slots and aggregate Playwright JSON reports into a TSV                           |
| `scripts/e2e-matrix-up.sh`, `e2e-matrix-down.sh`                                                | Standalone Docker Tuwunel lifecycle (`e2e/docker-compose.matrix.yaml`) with `MINDROOM_TUWUNEL_IMAGE` override                      |
| `scripts/e2e-rtc.sh`                                                                            | Start/stop LiveKit and MatrixRTC auth service per slot (`29200+n`..`29500+n`)                                                      |
| `scripts/agent-stack/stack.py` (`just agent-stack`)                                             | Run a real MindRoom backend (`stub`, `real`, or `live` model) against a slot's homeserver                                          |
| `scripts/push-gate.sh`                                                                          | Pre-push verification gate on a commit archive: build + budget, `tsc`, `strict`, `lint`, `vitest`, secret scan, and 15 smoke specs |
| `scripts/test-e2e-docker-matrix.sh`, `test-e2e-mindroom.sh`                                     | Convenience wrappers that provision accounts, seed the fixture room, and run Playwright                                            |
| `scripts/license-check.mjs`, `watch/check_sdk_licenses.py`, `watch/e2e.py`, `reference/seed.py` | License allowlist checks (npm and Watch Rust SDK), Watch simulator E2E runner, and reference screenshot seeder                     |

### Isolated slots (`scripts/e2e-slot.sh`)

```bash
just e2e-slot 3 --preview npx playwright test e2e/threads/pinned-threads.live.spec.ts
just e2e-slot 3 --rtc --preview npx playwright test e2e/calls/calls.spec.ts
just e2e-slot 3 up     # start empty homeserver and leave running
just e2e-slot 3 down   # stop homeserver, agent stack, and call service; delete data
```

- **Ports (`slot 0-99`):** slot `n` (`1-99`) uses homeserver `28100+n` and app `4300+n`; slot `0` is `just hs-up` (`28008` / `4200`).
- **Options (before `<command>`):** `--snapshot[=<rev>]` runs in a clean archive copy (`$E2E_SNAPSHOT_ROOT/slot-<n>`, default `/tmp/mindroom-client-e2e`, implies `--fresh`); `--preview` builds and serves via `vite preview` (implies `--snapshot`; specs importing `/src/` need the dev server); `--fresh` starts an empty homeserver and deletes it on exit; `--rtc` starts/stops `scripts/e2e-rtc.sh` around the homeserver.
- **Concurrency and live-slot contract:** `E2E_MAX_CONCURRENT` (default `6`, `0` disables) caps concurrent runs via `flock` lock files in `$E2E_SNAPSHOT_ROOT/tokens` (`up` and `down` take none). `/tmp/mindroom-slots/<n>.live.json` (fixed path regardless of `E2E_SNAPSHOT_ROOT`) reserves slot `n` for throwaway live deployments (`live.py` in `mindroom-ai/dev`); slot runs refuse any slot with that file.

### Multi-slot suite and TSV reports (`scripts/e2e-suite.sh`, `scripts/e2e-results-tsv.mjs`)

```bash
just e2e-suite --rev HEAD --slots 25-30 --out results.tsv [specs...] [-- <playwright options>]
just e2e-suite --resume /tmp/mindroom-client-e2e/suite-<sha>-<ts> --slots 25-28
```

- Runs each spec in its own `e2e-slot --snapshot=<rev> --preview` run (excluding `e2e/electron/` by default; specs importing `/src/` or all non-plugin specs under `--dev` use the dev server; call specs automatically add `--rtc`). Playwright options default to `--retries 1`.
- Records the 1-minute load average at each spec start via `node:os` `loadavg()` (note: `e2e-suite.sh` and `e2e-slot.sh` require `flock` and Bash 4+ `mapfile`, standard on Linux).
- `scripts/e2e-results-tsv.mjs` (`--manifest <manifest.tsv>` or `<report.json>...`) emits columns: `spec`, `passed`, `failed`, `skipped`, `first error`, `flaky`, `seconds`, `server`, `load`, `skipped (no service)`. Skips caused by a missing service, fixture, account, or setting are broken out into `skipped (no service)` rather than `skipped`.

### Homeserver and RTC helpers

- **`scripts/e2e-matrix-up.sh` & `scripts/e2e-matrix-down.sh`**: manage standalone Tuwunel via `e2e/docker-compose.matrix.yaml` (`E2E_MATRIX_COMPOSE_FILE` override), defaulting `MINDROOM_TUWUNEL_IMAGE` to the pinned image from `e2e/docker-compose.yaml` (override with `MINDROOM_TUWUNEL_IMAGE`) and waiting on `/_matrix/client/versions`. Use `just hs-up` / `just hs-down` instead for the default `e2e/docker-compose.yaml` workflow (`docker compose up -d --wait` and `down --volumes --remove-orphans`).
- **`scripts/e2e-rtc.sh <slot> up|down|env`**: starts LiveKit (`livekit/livekit-server:latest`) and `e2e/rtc/authorization-service.mjs` on loopback ports `29200+n` (LiveKit signalling), `29300+n` (WebRTC TCP), `29400+n` (WebRTC UDP), and `29500+n` (auth service). `env` prints `E2E_LIVEKIT_SERVICE_URL` and `E2E_LIVEKIT_URL`. Used automatically by `e2e-slot.sh --rtc`.

### MindRoom backend stack (`scripts/agent-stack/stack.py`)

```bash
just agent-stack <slot> up [--model stub|real|live] [--agents N] [--calls SERVICE_URL] \
  [--client-sessions] [--terminals | --computers] [--transcription stub|real] [--checkout DIR] [--ref REV]
just agent-stack <slot> status | usage | down
```

- **Ports (`slot 0-99`):** MindRoom API `29600+n`, stub model `29700+n`, plugin origins `29800+n`, sandbox runner `29900+n` (against slot homeserver `28100+n`, or `28008` on slot `0`).
- **Key flags:** `--model stub|real|live` (default `$E2E_AGENT_MODEL` or `stub`), `--agents N` (stub only, adds `worker1..workerN`, default `0`), `--calls SERVICE_URL` (`--calls-profile realtime|live`), `--client-sessions`, `--terminals` (implies `--client-sessions`; incompatible with `--computers`), `--computers` (`--computer-image`, `--computer-tools`, implies `--client-sessions`), `--transcription stub|real`.
- **Exit codes:** `3` no MindRoom checkout, `4` no homeserver, `5` missing provider keys, `6` `--terminals` unsupported by backend ref, `1` other error.

### Pre-push gate (`scripts/push-gate.sh`)

```bash
scripts/push-gate.sh <checkout> --slot <n> [--rev <commit>] [--base <rev>]
```

Runs all checks in parallel against a clean archive of `--rev` (default `HEAD`, `--base` default `origin/main`; `--slot` accepts a single slot or comma list like `46,47`; auto-enters `nix develop` if Node < 24):

- `build`: `e2e-slot --preview` production build plus `bundle-report.mjs --budget scripts/perf/bundle-budget.json`.
- `tsc` and `strict`: `config/tsconfig.app.json` and `config/tsconfig.strict.json`.
- `lint`: ESLint on changed files in `base...rev` (or full `npm run lint` when ESLint or tsconfig files change).
- `vitest`: full unit suite with one automatic rerun of failed test files.
- `keys`: scans new git objects in `base..rev` against values in `$PUSH_GATE_KEY_FILE` (default `~/.config/mindroom-chat/llm.env`), printing key names only.
- `e2e`: runs 15 smoke specs via `e2e-suite.sh` after `build` and `vitest` finish. Logs stay in `$PUSH_GATE_ROOT` (default `/tmp/mindroom-client-push-gate`).

### Convenience wrappers and verification pointers

- **`scripts/test-e2e-docker-matrix.sh`**: starts standalone Docker Tuwunel (`e2e-matrix-up.sh`), registers 4 disposable accounts, seeds the fixture room, optionally builds and serves `dist/` on port `28090` (`E2E_ENABLE_DEPLOYED_FIXTURE=1`), and runs Playwright.
- **`scripts/test-e2e-mindroom.sh`**: provisions disposable accounts via `$MINDROOM_SSH_HOST` (default `mindroom`), opens a tunnel via `scripts/with-mindroom-tunnel.sh`, seeds the fixture room, and runs Playwright.
- **`scripts/license-check.mjs`**: checks installed npm packages (including `MINDROOM_CLIENT_PLUGINS` directories) against the SPDX allowlist and named exceptions (`just license-check`).
- **`scripts/watch/check_sdk_licenses.py`**: checks linked Rust crates in a `matrix-rust-sdk` checkout for `aarch64-apple-watchos` (called by `just watch-sdk`).
- **`scripts/watch/e2e.py`**: runs DEBUG Apple Watch app scenarios (`voice`, `approve`, `ask`, `listen`, `resolve`, `long_thread`) in a watchOS simulator on macOS against an agent stack.
- **`scripts/reference/seed.py`**: seeds a disposable slot (`scripts/e2e-slot.sh <n> python3 scripts/reference/seed.py [suffix]`) with the Launch War Room dataset for `docs/design/reference/` and `docs/screenshots/`.
