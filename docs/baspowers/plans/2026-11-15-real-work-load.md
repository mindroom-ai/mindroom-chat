# Real-work load and profiling harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development: eight tasks across Python, TypeScript and shell with cross-task interfaces (stub prompt format, driver report files, probe result schema); a fresh reviewer per task catches interface drift before the next task builds on it.

**Goal:** A reproducible load shaped like Bas's real agent rooms (real MindRoom backend, stub model, up to 50 concurrently streaming threads) and one Playwright spec that profiles the Compact view and the open thread under it, with results comparable across commits and machines.

**Architecture:** `scripts/agent-stack` runs the real backend; a new `#work` stub scenario makes each reply's length, pace, reasoning and tool calls tunable from the prompt; `scripts/perf/real-work/driver.py` builds history and keeps N replies streaming, reporting the achieved load; `e2e/helpers/perfProbe.ts` measures; `e2e/perf/real-work.live.spec.ts` runs the scenarios; `compare.mjs` compares runs.

**Tech Stack:** Python 3 stdlib (`scripts/matrix_http.py`), aiohttp (stub, already used), Playwright + CDP, Node 24 (`node --test`).

**Spec:** `docs/baspowers/specs/2026-11-15-real-work-load-design.md`

## Global Constraints

- Lane C rules (AGENTS.md): new code only; TypeScript passes `just strict` and `just lint` (logical CSS sides do not apply here, no styles).
- No real data in the repository: workload profiles hold numbers only; no room names, IDs or text from the census.
- Real-data mode refuses a homeserver that is not on the loopback interface and aborts every browser request to another host.
- The driver stops a run when streams at once fall below 80 % of the target, averaged over 10 s after a 30 s ramp.
- Perf specs are opt-in (`PERF_REAL_WORK=1`) and run on the production build (`scripts/e2e-slot.sh <n> --snapshot --preview`).
- Terminal stream statuses (client `matrix/protocol/aiRun.ts`): `complete`, `completed`, `done`, `error`, `failed`, `stopped`, `cancelled`, `interrupted`.
- Live frames: ephemeral `io.mindroom.live`; the sync filter opts in with `room.ephemeral.types` containing it (client `matrix/client/clientSyncPolicy.ts`).
- Jobs state: `io.mindroom.background_jobs`, state key = agent user ID.
- Commits unsigned (`git -c commit.gpgsign=false commit`), files added by explicit path, no em dashes in docs or comments.

## Review Focus

- A reply that never reaches a terminal status (backend error, stuck tool): the driver must free its thread after `stuckSeconds` (default 600) and count it, not wait forever with streams at once silently low.
- A backend that cannot keep up (50 concurrent turns): the run must fail with target and achieved rates, never report good numbers under a light load (driver exit code 2; spec fails the scenario).
- `wps=0` (history mode) and `tools=0`/`reasoning=0`: the stub must stream at full speed and skip empty sections without division by zero or empty chunks.
- A `/sync` response that is not JSON or is a long-poll timeout with no rooms: the probe's load counter and the driver's sync loop must skip it, not throw.
- Real-data mode pointed at a non-loopback homeserver: refuse before any request.

---

### Task 1: Stub scenario `#work`

**Files:**
- Modify: `scripts/agent-stack/stub_model.py` (docstring scenario list, `TEXT_SCENARIOS`, `plan`, streaming branch of `Stub.completions`)
- Test: `scripts/agent-stack/test_stack.py` (new class `WorkScenarioTests`)

**Interfaces:**
- Produces: prompt format `#work words=<int> wps=<float> reasoning=<int> tools=<int> toolsec=<float> seed=<int>`; every key optional, defaults `words=200 wps=30 reasoning=0 tools=0 toolsec=0 seed=1`.
- Produces: `work_knobs(text: str) -> dict[str, float]`, `work_text(words: int, seed: int) -> str`, `work_reasoning(chars: int, seed: int) -> str`; `plan()` returns `("tool", "run_shell_command", {"args": "sleep <toolsec>; echo work step <i>"})` for the first `tools` calls, then `("work", reasoning, text, seconds_per_word)` with `seconds_per_word = 0 if wps <= 0 else 1 / wps`.

- [ ] **Step 1: Write the failing tests** in `WorkScenarioTests`:
  - `test_knobs_default_and_parse`: `work_knobs("#work")` equals the defaults; `work_knobs("please #work words=50 wps=0 tools=2 toolsec=1.5 seed=9")` gives `words=50, wps=0, tools=2, toolsec=1.5, seed=9`.
  - `test_text_is_deterministic_and_sized`: `work_text(300, 7) == work_text(300, 7)`, `!= work_text(300, 8)`, and `len(work_text(300, 7).split()) == 300`; the text holds at least one Markdown heading, one bullet list and one paragraph (assert `"\n## " in text`, `"\n- " in text`).
  - `test_plan_runs_tools_then_streams`: with a body whose latest person message is `#work words=10 tools=2 toolsec=0 wps=0`, `plan()` returns the shell step for `echo work step 1` with no tool results, `echo work step 2` with one, and `("work", "", <10 words>, 0)` with two.
  - `test_reasoning_section`: `work_reasoning(0, 1) == ""` and `len(work_reasoning(500, 1))` within 450..550.
  - `test_no_tools_streams_at_once`: `#work words=5` (tools default 0) makes `plan()` return `("work", "", <5 words>, 1/30)` with no tool results.
- [ ] **Step 2: Run, expect FAIL**: `python3 -m unittest scripts/agent-stack/test_stack.py -k WorkScenario` fails on missing `work_knobs`.
- [ ] **Step 3: Implement** the three functions and the `plan` branch (checked before the tool-scenario loop, `#work` added to `TEXT_SCENARIOS`), with text from a `random.Random(seed)` over a fixed word list: paragraphs of 40 to 80 words, a `## ` heading every ~250 words, a bullet list every ~400. In `completions`, the `"work"` step streams `reasoning` as `reasoning_content` chunks of about 40 characters, then the text word by word, sleeping `seconds_per_word` between words only when it is above 0. Add `#work` to the docstring list.
- [ ] **Step 4: Run, expect PASS**: same command, then `python3 -m unittest scripts/agent-stack/test_stack.py` all pass.
- [ ] **Step 5: Commit**: `git add scripts/agent-stack/stub_model.py scripts/agent-stack/test_stack.py`; message `agent stack: #work stub scenario with tunable length, pace, reasoning and tool calls`.

### Task 2: Workload profiles and driver

**Files:**
- Create: `scripts/perf/real-work/driver.py`, `scripts/perf/real-work/test_driver.py`
- Create: `e2e/perf/workloads/real-work-50.json`, `real-work-census.json`, `real-work-smoke.json`
- Modify: `justfile` (`script-tests`: add `scripts/perf/real-work/test_driver.py`)

**Interfaces:**
- Consumes: Task 1's prompt format; the stack state JSON that `python3 scripts/agent-stack/stack.py <slot> status` prints (`homeserver`, `tester.{userId,accessToken}`, `rooms.lobby`).
- Produces (profile schema, every distribution `{"p50": n, "p90": n, "max": n}`):
  `{"name", "quietRooms": int, "quietMessages": int, "threads": int, "turns": dist, "reply": {"words": dist, "wps": float, "reasoning": dist, "tools": dist, "toolsec": dist}, "live": {"streams": int, "pauseSeconds": dist, "stuckSeconds": int}, "historyStreams": int}`
- Produces CLI: `python3 scripts/perf/real-work/driver.py --stack <state.json> --profile <profile.json> --phase history|live [--streams N] [--seconds S] [--seed N] --out <file>`
  - history writes `--out` JSON `{"room": str, "threads": [rootId...], "quietRooms": [roomId...]}` and exits 0 when every thread has its turns;
  - live reads the history file given as `--history <file>`, appends one JSON line per 5 s to `--out`: `{"t": unix_s, "target": int, "streaming": int, "frames": int, "edits": int, "jobs": int, "stuck": int}` (counts within the 5 s), runs until `--seconds` or SIGTERM, exits 2 on shortfall.
- Produces functions (unit-tested): `sample(dist: dict, rng: random.Random) -> float`, `work_prompt(reply: dict, rng, live: bool) -> str` (history: `wps=0 toolsec=0`), `class Scheduler(streams: int, pause: dict, stuck_seconds: float, rng)` with `ready(now) -> list[str]`, `started(root, now)`, `finished(root, now)`, `streaming() -> int`, `sweep_stuck(now) -> list[str]`; `count_sync(batch: dict, room: str, agent_ids: set[str]) -> dict` returning `{"frames", "edits", "jobs", "finished": [rootId...]}`; `shortfall(windows: list[dict]) -> bool`.

- [ ] **Step 1: Write the failing tests** in `test_driver.py` (unittest):
  - `test_sample_stays_in_range`: 1,000 draws of `{"p50": 4, "p90": 9, "max": 19}` all in 0..19, median 3..5.
  - `test_prompt_history_is_instant`: `work_prompt(reply, Random(1), live=False)` contains `wps=0` and `toolsec=0`; same seed gives the same prompt.
  - `test_scheduler_keeps_target`: 5 threads, target 3, pause `{"p50":0,"p90":0,"max":0}`: `ready(0)` gives 3 roots; after `finished(a, 1)` `ready(1)` gives one more; `streaming()` stays 3.
  - `test_stuck_reply_frees_thread`: a thread started at 0 with `stuck_seconds=600` is returned by `sweep_stuck(601)` and no longer counts as streaming.
  - `test_count_sync`: a fake batch with two `io.mindroom.live` ephemeral events, one agent `m.replace` whose `m.new_content` has `io.mindroom.stream_status: "completed"` on a reply first seen with an `m.thread` relation to root `$r`, and one `io.mindroom.background_jobs` state event gives `{"frames": 2, "edits": 1, "jobs": 1, "finished": ["$r"]}`; an empty batch `{}` gives zeros.
  - `test_shortfall`: windows over 40 s with `streaming/target` 0.9 is not a shortfall; 0.7 after the first 30 s is.
  - `test_profiles_load`: each file in `e2e/perf/workloads/` loads and has every schema key.
- [ ] **Step 2: Run, expect FAIL**: `python3 -m unittest scripts/perf/real-work/test_driver.py`.
- [ ] **Step 3: Implement** `driver.py` with `scripts/matrix_http.py` (`sys.path` insert as `scripts/perf/seed-large-room.py` does). `sample`: piecewise linear over (0, p50 at 0.5, p90 at 0.9, max at 1.0) from `rng.random()`, minimum 0. Sync loop: `/sync` as the tester with filter `{"room": {"rooms": [lobby], "ephemeral": {"types": ["io.mindroom.live"]}, "timeline": {"limit": 100}}}` and `timeout=1000`, skipping a non-2xx or non-JSON answer. Agents are the lobby members whose localpart starts with `mindroom_`. History: create the quiet rooms (`quietMessages` plain messages each), post each thread's first turn as a root `m.text` in the lobby, later turns as `m.thread` replies, `historyStreams` at once. Live: same posting, `--streams` (default profile `live.streams`) at once, `work_prompt(..., live=True)`.
- [ ] **Step 4: Write the three profiles** from the census (spec "What real use looks like"):
  - `real-work-census.json`: `quietRooms 200, quietMessages 10, threads 39, turns {2,4,10}, reply.words {150,800,2800}, wps 30, reasoning {600,3000,8000}, tools {2,7,11}, toolsec {10,60,120}, live.streams 7, pauseSeconds {30,120,300}, stuckSeconds 600, historyStreams 20`.
  - `real-work-50.json`: same reply shape, `threads 50, live.streams 50, pauseSeconds {2,5,10}`.
  - `real-work-smoke.json`: `quietRooms 5, threads 3, turns {1,1,2}, words {50,100,150}, tools {0,1,1}, toolsec {1,2,2}, live.streams 3, historyStreams 3`.
- [ ] **Step 5: Run, expect PASS**: the unit tests, then `just script-tests`.
- [ ] **Step 6: Smoke against a real stack** on gce (agent stack works there; memory `remote-test-runner-quirks.md`): `scripts/e2e-slot.sh <n> bash -c 'python3 scripts/agent-stack/stack.py <n> up > /work/tmp/s.json && python3 scripts/perf/real-work/driver.py --stack /work/tmp/s.json --profile e2e/perf/workloads/real-work-smoke.json --phase history --out /work/tmp/h.json && python3 scripts/perf/real-work/driver.py --stack /work/tmp/s.json --profile e2e/perf/workloads/real-work-smoke.json --phase live --history /work/tmp/h.json --seconds 60 --out /work/tmp/r.jsonl; python3 scripts/agent-stack/stack.py <n> down'`. Expected: history exits 0 with 3 threads; live exits 0, and its lines show `streaming` near 3, `frames` above 0 and `jobs` above 0.
- [ ] **Step 7: Commit**: the driver, its test, the three profiles, `justfile`; message `perf: real-work driver and workload profiles from the production census`.

### Task 2b: More agents, to load past the homeserver's frame cap

Added 2026-11-15 after the spike: MindRoom's Tuwunel allows 30 ephemeral events a second per sender per room, so one agent cannot deliver more than 3 streams of frames. The client is measured at the frame rate a fixed server would deliver by spreading turns over agents.

**Files:**
- Modify: `scripts/agent-stack/stack.py` (`--agents N` option, `AGENTS`/`config_yaml`, docstring), `scripts/agent-stack/stub_model.py` (router pick), `scripts/agent-stack/test_stack.py`
- Modify: `scripts/perf/real-work/driver.py`, `scripts/perf/real-work/test_driver.py`
- Create: `e2e/perf/workloads/real-work-50-agents.json`

**Interfaces:**
- Consumes: Task 2's profile schema and driver; the stack state JSON's `agents` (agent user IDs).
- Produces: `stack.py <slot> up --agents N` (stub mode only, default 0) adds stub agents `worker1` .. `workerN` (display names `Worker 1` ..), each `model: default`, `rooms: [lobby]`, `tools: [shell]`, to the stub config; the state JSON's `agents` lists them with the others. The stub's router answers `workerK` when the routed message names `workerK`, else as before.
- Produces: profile key `agents: int` (default 1, optional in old files). With `agents > 1` the driver addresses thread `i`'s turns to `worker{(i % agents) + 1}` by naming it in the prompt, and refuses to start (exit 1, message naming the missing agent) when the stack state lacks one.

- [ ] **Step 1: Write the failing tests**: `config_yaml` with `extra_agents=3` holds `worker1`, `worker2`, `worker3` in the lobby with `tools: [shell]` and without it holds none; the stub's `schema_value` for `agent_name` on a message naming `worker2` gives `worker2`, on one naming `scout` gives `scout`, otherwise `helper`; the driver's prompt for thread 4 with `agents: 3` names `worker2`; the driver refuses a stack state without `worker3` when `agents: 3`; every profile still loads.
- [ ] **Step 2: Run, expect FAIL**: `python3 -m unittest scripts/agent-stack/test_stack.py scripts/perf/real-work/test_driver.py`.
- [ ] **Step 3: Implement**; `real-work-50-agents.json` is `real-work-50.json` with `agents: 17` (at most 3 streams per agent).
- [ ] **Step 4: Run, expect PASS**, then `just script-tests`.
- [ ] **Step 5: Smoke on gce** (slot 80-89): `stack.py <n> up --agents 3` and the driver's live phase with `real-work-smoke.json` plus `agents: 3` and `--streams 9` for 60 s: lines show `streaming` near 9 and `frames` near 9 streams' worth (well above the 30 a second one agent gets, i.e. above 150 per 5 s window).
- [ ] **Step 6: Commit**: message `agent stack: more stub agents, so the real-work load passes one sender's frame cap`.

### Task 3: Measurement probe

**Files:**
- Create: `e2e/helpers/perfProbe.ts`

**Interfaces:**
- Produces:
  - `installProbe(page: Page): Promise<void>`: `page.addInitScript` before the first navigation: React DevTools hook stub counting `onCommitFiberRoot`, `PerformanceObserver`s for `long-animation-frame` (with `scripts` attribution), `longtask`, `event` (Event Timing, `durationThreshold: 16`), `layout-shift`, all buffering into `window.__perfProbe`.
  - `startProbe(page: Page, options: { label: string; outDir: string; profile?: boolean; sampleMs?: number }): Promise<Probe>`; `Probe.stop(): Promise<ProbeResult>` writes `<outDir>/<label>.json` (and `<label>.cpuprofile` when `profile`).
  - `ProbeResult = { label; wallMs; frames: Stats; loaf: { count; over100; p95; top: { source: string; ms: number }[] }; longTasks: { count; totalMs }; commits: number; metrics: { taskMs; scriptMs; layoutMs; styleMs; layoutCount; styleCount; busy: number }; series: { t: number; heapMB: number; nodes: number }[]; load: { seconds: number; frames: number; edits: number; jobs: number; syncs: number }; inputs: Stats }` with `Stats = { count; p50; p95; max }`.
  - `timeToVisible(page: Page, act: () => Promise<void>, selector: string): Promise<number>`: from the act's input event timestamp to the first animation frame in which `selector` is laid out and in the viewport (as `client-speed.live.spec.ts` measures).
  - `typeWithLatency(page: Page, target: Locator, ms: number): Promise<Stats>`: 60 ms between keys, keydown to the first task after the next frame (as `busy-room-typing.live.spec.ts` measures), select-all and delete after each phrase.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Implement** by moving the measurement code the spec names (busy-room-typing `instrument`/`readStats`, busyThreadRoom `instrumentScrolling` observers, client-speed `workMeter` and the profile wrapper) into one module; leave the old specs unchanged. Load counting: `page.on('response')` on URLs containing `/_matrix/client/v3/sync`, parsing JSON and counting, for every joined room, `ephemeral.events` of type `io.mindroom.live`, timeline events with an `m.replace` relation, and `io.mindroom.background_jobs` state events; a body that is not JSON is skipped. `busy` is `TaskDuration` delta over wall time.
- [ ] **Step 2: Typecheck and lint**: `just typecheck-tests` shows no error in `e2e/helpers/perfProbe.ts`; `npx eslint e2e/helpers/perfProbe.ts` clean.
- [ ] **Step 3: Commit**: message `e2e: one perf probe with one result schema`.

### Task 4: Scenario spec

**Files:**
- Create: `e2e/perf/real-work.live.spec.ts`

**Interfaces:**
- Consumes: Task 2 CLI and report files; Task 2b `stack.py --agents` (the spec starts its own stack with `--agents <profile agents>` when the profile's `agents` exceeds 1, otherwise the fixture's); Task 3 `installProbe`, `startProbe`, `timeToVisible`, `typeWithLatency`; `e2e/helpers/agentStack.ts` (`test` fixture, `stack`, `openLobby`, `showThread`, `composer`); `e2e/helpers/roomViewSwitch.ts` `setRoomCompact`.
- Produces: `test-results/perf/real-work/<scenario>-<engine>-<throttle>x.json` (a `ProbeResult` plus `{ target, achieved }` from the driver's lines in the window) and `.cpuprofile` files; `PERF-REAL-WORK {json}` console lines.

- [ ] **Step 1: Implement** the spec header (scenarios, knobs, how to run) and, opt-in with `PERF_REAL_WORK=1`: `beforeAll` writes the stack state to a temp file, runs the driver's history phase (`child_process.spawnSync`, timeout 30 min), starts its live phase (`spawn`, `--streams` from `PERF_STREAMS`) and waits 30 s for the ramp; `afterAll` sends SIGTERM and fails if the driver exited 2. Scenarios in order, each through `startProbe` with `profile: process.env.PERF_PROFILE === '1'`: `compact-idle` (30 s), `compact-scroll` (wheel 600 px steps down then up, 20 s), `thread-open` (`timeToVisible` on a streaming thread's card click, then its first message row), `thread-idle` (30 s), `thread-type` (`typeWithLatency`, 10 s), `switch` (Back then another streaming thread, 5 times, each timed), `cold-load` (reload, `timeToVisible` of the first card). A scenario whose window's mean `streaming` is below 80 % of `target` fails with both numbers. `PERF_CPU_THROTTLE` (default `1,4`) repeats the list per rate via CDP `Emulation.setCPUThrottlingRate`; `PERF_SCENARIOS` filters; `PERF_VIEWPORT=phone` uses 390x844 with touch. Playwright `trace: 'off'` and `actionTimeout: 15_000` in `test.use`. `soak`, its own test opted in with `PERF_SOAK=1`: 20 minutes alternating 60 s of `compact-idle` and 60 s of `thread-idle` in one probe with `sampleMs: 5000`, failing when the last heap sample is more than 50 MB above the first.
- [ ] **Step 2: External mode** in the same file: `PERF_TARGET=external` with `PERF_HOMESERVER`, `PERF_USERNAME`, `PERF_PASSWORD`, `PERF_ROOM`: skip the stack and driver, throw before any request unless the homeserver's host is `127.0.0.1` or `localhost`, `context.route('**/*')` aborting every other host, `serviceWorkers: 'block'`, and run only `thread-open`, `thread-type`, `switch`, `cold-load`, `compact-scroll`.
- [ ] **Step 3: Check the loopback guard**: `PERF_REAL_WORK=1 PERF_TARGET=external PERF_HOMESERVER=http://example.org PERF_USERNAME=x PERF_PASSWORD=x PERF_ROOM=x npx playwright test e2e/perf/real-work.live.spec.ts` fails with a message naming the homeserver, and the run made no request to example.org (no `page.on('request')` entry for it).
- [ ] **Step 4: Smoke run on gce**: `PERF_REAL_WORK=1 PERF_WORKLOAD=e2e/perf/workloads/real-work-smoke.json PERF_CPU_THROTTLE=1 scripts/e2e-slot.sh <n> --snapshot --preview npx playwright test e2e/perf/real-work.live.spec.ts`. Expected: every scenario writes its JSON, `load.frames > 0`, `load.jobs > 0`, the run passes.
- [ ] **Step 5: Typecheck, lint, commit**: `just typecheck-tests` clean for the file, `npx eslint e2e/perf/real-work.live.spec.ts` clean; message `e2e: real-work perf scenarios under the real backend's load`.

### Task 5: Compare

**Files:**
- Create: `scripts/perf/real-work/compare.mjs`, `scripts/perf/real-work/compare.test.mjs`
- Modify: `justfile` (`script-tests`: add `scripts/perf/real-work/compare.test.mjs`)

**Interfaces:**
- Consumes: Task 4's JSON files, any number of run directories per side.
- Produces: `node scripts/perf/real-work/compare.mjs --base <dir>... --head <dir>... [--json]` prints, per scenario and metric (`metrics.busy`, `frames.p95`, `loaf.count`, `loaf.p95`, `inputs.p95`, `timeToVisible` values, `series` last heap and nodes), base median, head median, change in %, and `overlap: true` when the head's range meets the base's; exports `compareRuns(base: Result[][], head: Result[][]): Row[]`.

- [ ] **Step 1: Write the failing test** `compareRuns` with two base runs (`busy` 0.4, 0.5) and two head runs (0.2, 0.25) gives one row `{scenario, metric: 'metrics.busy', base: 0.45, head: 0.225, changePct: -50, overlap: false}`; a head of (0.45, 0.6) gives `overlap: true`.
- [ ] **Step 2: Run, expect FAIL**: `node --test scripts/perf/real-work/compare.test.mjs`.
- [ ] **Step 3: Implement** `compare.mjs`.
- [ ] **Step 4: Run, expect PASS**, then `just script-tests`.
- [ ] **Step 5: Commit**: message `perf: compare real-work runs of two commits`.

### Task 6: Runs across machines

**Files:**
- Create: `scripts/perf/real-work/matrix.sh`

**Interfaces:**
- Consumes: `~/repos/dev/scripts/mac-runner/remote-test.sh <host> <commit> exec ...` (outside the repository; MACHINES.md), Task 4's spec and outputs.
- Produces: `scripts/perf/real-work/matrix.sh <commit> <out dir> <host>:<slot>[,...] [-- <env assignments>]` runs the spec once per host and slot in parallel, each with `--snapshot --preview`, and copies each run's `test-results/perf/real-work/` to `<out dir>/<host>-<slot>/`; exits non-zero when any run failed, listing which.

- [ ] **Step 1: Implement** with a header that names the hosts that can run the agent stack (gce-dev, pc) and the power check (`~/repos/machines.sh`); on gce `TMPDIR=/work/tmp` and `E2E_SNAPSHOT_ROOT` under `/work`.
- [ ] **Step 2: Verify**: `scripts/perf/real-work/matrix.sh <head> /tmp/rw gce:71,gce:72 -- PERF_WORKLOAD=e2e/perf/workloads/real-work-smoke.json PERF_CPU_THROTTLE=1` leaves two result directories; `node scripts/perf/real-work/compare.mjs --base /tmp/rw/gce-71 --head /tmp/rw/gce-72` prints rows with `overlap: true` for most metrics (same commit).
- [ ] **Step 3: Commit**: message `perf: run the real-work scenarios across the runners`.

### Task 7: Calibration against the production copy

**Files:**
- Private only: `~/mindroom-investigations/client-perf/calibration/` on pc (no repository change unless a profile value changes).
- Modify (only if calibration says so): `e2e/perf/workloads/*.json`, `scripts/agent-stack/stub_model.py`

**Interfaces:**
- Consumes: Task 4 external mode on the MacBook M5 against the copy (`~/perf-realdata/`, homeserver `http://127.0.0.1:18008`), the real-data baseline of 2026-11-15 (`~/mindroom-investigations/client-perf/realdata-baseline/`), Task 6 runs of `real-work-census.json`.

- [ ] **Step 1: Run** external mode on the M5 against the copy of the room Bas named, 3 runs, `PERF_CPU_THROTTLE=1`.
- [ ] **Step 2: Run** `real-work-census.json` on the M5 (or gce if the stack does not run there), 3 runs, same scenarios, plus `PERF_STREAMS=3` and `7` live runs.
- [ ] **Step 3: Compare** static scenarios (main-thread time within a factor of 1.5) and live 3 and 7 against the replay baseline (factor 2), and the top 15 self-time functions (`cpuprofile-summary.mjs`). Write the result to the private calibration directory.
- [ ] **Step 4: Close gaps**: for each miss, add the missing real feature to the profile or the stub (one commit each, message naming the gap), rerun the affected scenario. Stop when every scenario is within its factor.

### Task 8: Baseline and hotspot list

**Files:**
- Private: `~/mindroom-investigations/client-perf/baseline-<date>/` (results, profiles, summaries)
- Create: `docs/perf/real-work-baseline.md` (numbers and code paths only, no real data)

**Interfaces:**
- Consumes: Tasks 4 to 6 on main's head with `real-work-50.json`.

- [ ] **Step 1: Run** `PERF_STREAMS=7,25,50`, `PERF_CPU_THROTTLE=1,4`, 3 runs each, `PERF_PROFILE=1`, spread over gce slots; WebKit (`PERF_ENGINES=webkit`) once on a Mac runner on AC power for `compact-idle` and `thread-idle`.
- [ ] **Step 2: Summarize** each profile with `node scripts/perf/cpuprofile-summary.mjs <profile> --maps <sourcemap build> --build <served dist> --top 25`.
- [ ] **Step 3: Write** `docs/perf/real-work-baseline.md`: the budget table from the spec with measured values at 7, 25 and 50 streams, and a ranked hotspot list, each with scenario, share of main thread, functions (file:function), the load that drives it, and the budget it blocks.
- [ ] **Step 4: Commit**: message `docs: real-work baseline and hotspot list`.
