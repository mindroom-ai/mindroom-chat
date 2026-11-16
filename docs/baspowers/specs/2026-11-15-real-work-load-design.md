# Real work: a load that looks like Bas's rooms, and the profiling around it

Bas Nijholt asked on 2026-11-15: "with just a couple of threads for [one of his agent rooms] the UI started to struggle a lot. I want to be able to run like 50 threads with ease in the UI and having everything just work, like in the compact room view, and in the thread itself." First look at real use in his production data, then simulate real work like that, profile everything, and then fix it in many parallel threads, using all the machines on his network.

## Understanding

Said:

- Real rooms already struggle with a few active threads.
- The target is 50 threads that work with ease, in the Compact room view and inside an open thread.
- Order: learn the real shape from production data, build a simulation of it, profile it exhaustively, then fix in parallel sessions.
- Every machine in `~/repos/MACHINES.md` may run the work.

Assumed (not said, chosen here):

- "50 threads" means 50 threads in one room with agents streaming in them at the same time, each with the history a real thread of that room has. Idle threads beside them count too.
- Desktop Chromium is measured first, because its profiles attribute time to functions; WebKit (the Mac and iOS apps' engine) and the iOS simulator then check the scenarios whose cost is engine-specific (see `ios-touch-region-list-perf` in the session memories: some costs only show on iOS).
- Real data stays on Bas's personal machines (pc, MacBook M5, MacBook M2) and out of the repository. The synthetic load holds no real data and runs anywhere, gce-dev included.

## What real streaming looks like

From MindRoom's backend (origin/main 2026-11-15), not from the client's existing perf specs:

- A reply starts as a "Thinking..." message with a stop reaction, then streams as **ephemeral `io.mindroom.live` frames every 100 ms** (`src/mindroom/live_frames/publisher.py`: a delta while the text changes, a full snapshot every 5 s), Megolm-encrypted in an encrypted room and sent over the homeserver's MSC2477 ephemeral route.
- Durable `m.replace` edits follow every 0.5 s at the start, ramping to every 5 s over 15 s (`StreamingConfig`), each carrying `io.mindroom.live_checkpoint`; the final edit carries `ai_run`, `tool_trace` and the final `stream_status`.
- 50 streaming threads are therefore up to 500 frames a second for the client to render while text streams, plus about 10 durable edits a second, plus the jobs state writes described below (about 25 a second at the census's pace).

No existing perf spec sends live frames: `busy-room-typing`, `thread-scroll-jitter` and `compact-filter-timing` hand-roll one edit a second. This is the most likely reason the specs look fine while real use does not.

## What real use looks like

A census of Bas's account on a copy of the production homeserver (2026-11-15, the last 60 days; numbers only, method under Components):

- **Account:** 213 joined rooms (10 spaces; 75 encrypted, none of them agent rooms), 180 active in the window; the initial sync is 11.8 MB.
- **Agent rooms are unencrypted.** The five busiest have two agent accounts and one or two people each, 4,000 to 12,000 events and 35 to 134 threads.
- **Most events are jobs state.** `io.mindroom.background_jobs` (room state, one per agent, rewritten whenever one of its tool jobs changes status) is 76 to 84 % of all events in the agent rooms, about 1.2 KB each, a write every 1.5 to 3 s (median gap) while an agent works and up to 46 a minute. No perf spec writes it.
- **Messages are large.** Final agent messages: median 2 KB, p90 20 KB, p99 46 KB of event; up to 17,000 characters and 3,400 lines of body; 20 to 50 % of the long ones carry `io.mindroom.long_text` (the full text as a file). Code fences and tables are rare.
- **Threads are short and heavy.** Median 4 replies (p90 9, max 19), but a thread's replies and their edits add up to 56 KB at the median and 420 KB at p90. A reply has 2 to 4 tool calls at the median (p90 7, max 30), and in some rooms reasoning of 3,500 characters at the median.
- **Streams are long.** A streamed reply lasts 3.4 minutes at the median and an hour at p90, with only 1 durable edit at the median (p90 18) and 8 s between edits: the live frames carry the streaming.
- **Concurrency today is low.** Per minute, at most 5 to 7 threads are active and at most 7 replies stream in one room (median 1). So the rooms already struggle at a few streams; 50 is about ten times today's peak.

## Spike findings (2026-11-15)

A throwaway spike ran 1 to 25 real backend streams (stub model, about 2,300 words each at 20 words a second) against main's production build in Chromium on gce-dev:

- **The homeserver caps live frames.** MindRoom's Tuwunel allows 30 ephemeral events a second per sender per room (`RATE_LIMIT` in `src/service/rooms/ephemeral/mod.rs`). Past 3 streams from one agent in one room, frames meet 429 answers and fall back to the 5 s snapshots: at 50 threads with one agent, text would move in jumps of 0.3 to 5 s. This is a server-side defect of its own; the client cannot be loaded past 30 frames a second from one agent until it is fixed. The driver therefore spreads turns over several agents when the profile asks for it (`agents`), to measure the client at the frame rate a fixed server would deliver.
- **A fast desktop hides the problem.** Fresh rooms cost 8 to 17 % of the main thread at up to 25 streams, with no long frame.
- **History and a slower CPU expose it.** With 300 older threads, a 4x CPU slowdown and 25 streams, the Compact view was 60 % busy with 69 long animation frames (p95 174 ms, max 255 ms) at 45 fps; total time went to `RoomTimeline`, `useThreadIndex` and `threadRecord` (about 4.2 s of 16 s). The 4x slowdown is the budget's binding case.
- **The backend kept up** at 25 streams (every reply complete), with event loop lag p95 of 141 to 209 ms.

## Success criteria

Measured on the production build, with 50 threads streaming, on the MacBook M5 in Chromium and again with a 4x CPU slowdown as a stand-in for slower machines:

| Scenario | Budget |
|---|---|
| Compact view, no input | main thread busy under 25 %; no animation frame over 100 ms |
| Compact view, wheel scrolling | frame p95 under 20 ms; no animation frame over 100 ms |
| Open a thread from its card | first rows painted within 300 ms (median) |
| Open thread, its agent and 49 others streaming, no input | main thread busy under 25 %; no animation frame over 100 ms |
| Typing in the thread composer | key to painted frame p95 under 50 ms |
| Back to Compact, then another thread | each within 200 ms (median) |
| 20 minutes of streaming | heap growth under 50 MB; DOM node count stays bounded |

The budgets are provisional: the first baseline may show one is unreachable without a redesign, and the design records any change with its reason.

## Approaches considered

1. **Real data only.** Profile the app against a local copy of the production homeserver. Highest fidelity for history, but the copy is static (nothing streams), cannot grow to 50 threads, and may run only on personal machines.
2. **A hand-written load generator.** A script that writes the backend's event shapes and frames itself. Fast and scalable, but it re-implements frames, encryption, tool traces and edit cadence, and drifts from the backend as the backend changes.
3. **The real backend with the stub model (chosen).** `scripts/agent-stack` already runs MindRoom's real backend against a slot's homeserver with a stub model that streams scripted text. Every wire detail (frames, edits, checkpoints, tool traces, jobs state, titles, thread summaries, long-text files, receipts, typing) is right by construction. The census shows why that matters: the largest share of real events, the jobs state, is one no hand-written emulator thought of. What the stack lacks: a reply scenario with tunable length, pace, tool calls and reasoning, and a driver that keeps 50 threads busy.

Approach 1 is still used once, as ground truth: the same scenarios run against the production copy at its real size, and the synthetic load at the same size must cost the client about the same (see Calibration). Approach 2 is the fallback if one backend cannot sustain the target number of streams.

## Components

### 1. Census (private)

`~/mindroom-investigations/client-perf/census.py`, run on the MacBook M5 against a local Tuwunel on a copy of `mindroom-hetzner:/var/lib/tuwunel` (federation off; the main account's password reset on the copy only). For every room active in the last 60 days it records numbers and content keys only: events by type, threads, replies and edits per thread, final message sizes, Markdown features (code fences, tables, lines), tool-call keys, edits per streamed reply and their spacing, how many threads and streams are active in the same minute, reactions, redactions, members and agents, encryption, and the size and time of the initial sync. Room names go to a separate local file. Neither leaves the personal machines; the workload profile below holds the derived numbers only.

### 2. Workload profile

`e2e/perf/workloads/<name>.json`, committed, numbers only:

- `account`: rooms besides the measured one (the census: about 210, most quiet), with how many events each, and spaces.
- `room`: number of people, and `agents`: how many agent accounts take the replies (1 in Bas's rooms; more to load the client past the homeserver's frame cap, see Spike findings). Unencrypted, as Bas's agent rooms are.
- `history`: threads, how many of them are resolved (`resolvedThreads`: the Compact view leaves those out, and the client still lists every one), turns per thread (a distribution), and per turn the reply shape below.
- `reply`: words (distribution, long enough that the p99 reply crosses the backend's long-text limit), pace in words per second, reasoning characters, tool calls (distribution) with their run time, so each call writes jobs state twice as in production.
- `live`: concurrent streams, the pause before a thread's next turn (distribution), and how long the measured window lasts.

`real-work-50.json` is the target; `real-work-census.json` reproduces the room Bas named (520 threads, 481 of them resolved, which leaves the 39 of the last 60 days open; up to 7 streams) for calibration.

### 3. Load: real backend, stub model, driver

- **Stub scenario `#work`**: in `scripts/agent-stack/stub_model.py`, a reply whose knobs come from the prompt (`#work words=800 wps=40 reasoning=3000 tools=3 toolsec=4 seed=17`), deterministic for a seed. It streams reasoning, runs the requested tool calls through the existing tool-step machinery (each a short shell command that takes the requested time), then streams Markdown text of the requested length, so the backend writes frames, tool traces, jobs state and long-text files as it does in production.
- **Agents**: with `agents: 1` the stack's helper takes every reply, as one agent does in each of Bas's agent rooms (the census finds one jobs-state publisher per room). With more, `stack.py --agents N` adds stub agents to the lobby and the driver addresses turns to them in turn, so each sender stays under the homeserver's 30 frames a second.
- **Driver** `scripts/perf/real-work/driver.py`: as the person, creates the account's other rooms; the stack's lobby is the measured room. In it the driver starts the profile's threads, each with a `#work` prompt addressed to an agent, and keeps the configured number of replies streaming: when a reply ends, that thread gets its next turn after the configured pause. A history phase runs the same loop with the stub at full speed until every thread has its turns, then the live phase starts. It records the target and the achieved rates (frames, edits and jobs state writes per second, streams at once) from its own sync with the live-frame opt-in, and stops the run when the achieved rate falls below 80 % of the target, so a slow backend cannot pass as a light load. The rooms are unencrypted, as Bas's agent rooms are, so the driver is a plain HTTP client (`scripts/matrix_http.py`).

### 4. Measurement: one probe, one result schema

`e2e/helpers/perfProbe.ts` gathers what four specs do today in four ways (`busy-room-typing`, `thread-scroll-jitter` via `busyThreadRoom.ts`, `client-speed`, `compact-filter-timing`), behind one API with one JSON result per scenario:

- in the page: animation frame intervals, Long Animation Frames with their script attributions, long tasks, Event Timing, key and click to painted frame latency, React commits counted through the DevTools hook, layout shifts;
- over CDP: `Performance.getMetrics` deltas (task, script, layout, style time, layout and style counts, nodes, JS heap) sampled each second, one CPU profile per scenario, and a trace on request;
- from the network: `/sync` responses and the live frames and edits they carry, so every result states the load it was measured under.

The existing specs move to it where that removes their copy; that is a follow-up, not part of this work.

### 5. Scenarios

`e2e/perf/real-work.live.spec.ts`, opt in with `PERF_REAL_WORK=1`, run on the production build (`e2e-slot.sh --preview`). After the history phase and with the live phase running:

1. `compact-idle`: the room in the Compact view, no input.
2. `compact-scroll`: wheel scrolling down and up through the cards.
3. `thread-open`: click a streaming thread's card; time to its first rows.
4. `thread-idle`: in that thread while its agent and the others stream.
5. `thread-type`: typing in the thread composer.
6. `switch`: back to Compact, then another thread, five times.
7. `cold-load`: reload with the room open.
8. `soak` (separate opt-in): 20 minutes of `compact-idle` and `thread-idle` alternating, heap and nodes sampled.

Knobs: `PERF_WORKLOAD` (profile file), `PERF_STREAMS` (overrides the profile's concurrent streams; `7,25,50` gives the scaling curve from today's peak to the target), `PERF_SCENARIOS`, `PERF_CPU_THROTTLE` (default `1,4`), `PERF_ENGINES` (default `chromium`), `PERF_VIEWPORT` (`desktop`, `phone`); repeated runs come from the matrix runner (component 8). Results go to `test-results/perf/real-work/<scenario>-<engine>-<throttle>.json` with the CPU profiles beside them.

### 6. Real-data mode (private)

The same spec with `PERF_TARGET=external`, a homeserver, an account and a room from the environment, runs the scenarios that need no streaming (`thread-open`, `switch`, `cold-load`, scrolling, typing) against the production copy on the MacBook M5, refusing any homeserver off the loopback interface and aborting every request to another host (room state points the app at the real backend). The first baseline (2026-11-15) also replays 1, 3 and 7 streams into the copy as the room's own agent account with a private hand-written replayer, to see the struggle Bas reported on real history. Results stay in `~/mindroom-investigations/client-perf/`.

### 7. Calibration

With `real-work-census.json` (the measured room's real size and pace), the synthetic load must land within a factor of 1.5 of the production copy on each static scenario's main-thread time, and within a factor of 2 of the replayed streams at 3 and 7 streams; the CPU profiles must share most of their top 15 self-time functions. Where they differ, the profile or the stub scenario lacks something real (a content feature, a kind of event, the account's other rooms) and gets it before any fix is measured against the synthetic load.

### 8. Runs across machines, comparison

- `scripts/perf/real-work/matrix.sh`: runs the scenario matrix for one commit across the runners through `~/repos/dev/scripts/mac-runner/remote-test.sh` (gce-dev for the agent stack and many parallel runs, the M5 for Apple-like numbers), each run in its own slot with `--snapshot --preview`, and copies the results back.
- `scripts/perf/real-work/compare.mjs`: a baseline and a candidate, each run several times; per scenario and metric the medians, the change, and whether the runs overlap; the top self-time functions that changed, de-minified with `scripts/perf/cpuprofile-summary.mjs`.

### 9. From profiles to fixes

The baseline's profiles become a ranked list of hotspots, each with its evidence (scenario, share of main thread, functions, the load that drives it). Each hotspot becomes one pull request in its own session and worktree, with the harness as its before-and-after evidence: the program runs through `orchestrating-pr-programs`. Code reading already suggests candidates (all unverified until profiled): the thread index rebuilt from scratch on each event (`threads/overview/useThreadIndex.ts`, `event-store/threads/threadRecord.ts`), `RoomTimeline` repainted on each arrival (`timeline/roomLiveRenderController.ts`), the whole Markdown body parsed again on each frame and edit (`messages/live/useLiveReplyContent.ts`, `messages/content/RenderBody.tsx`), the open thread's rows rebuilt and re-rendered per edit (`timeline/useThreadRenderState.ts`, `timeline/roomTimelineRows.tsx`), and whatever each jobs state write sets off, since it reaches the same room timeline listeners as a message. Two candidates matter only in encrypted rooms, which Bas's agent rooms are not: live frames decrypted on one queue (`messages/live/bindLiveReplyFrames.ts`) and the encrypted unread recount (`matrix/client/encryptedRoomCounts.ts`).

## Error handling

- The driver stops the run, with the achieved and target rates, when the load falls short; the spec fails a scenario whose recorded load is under the target instead of reporting good numbers for a light load.
- A run that loses its backend or homeserver fails with the stack's log tail, never with partial results counted as a pass.
- Real-data mode refuses a homeserver that is not on the loopback interface.

## Testing

- The stub scenario's text and tool plan for a seed: unit tests in `scripts/agent-stack/test_stack.py` style.
- The driver's turn scheduling and rate accounting: unit tests with a fake clock and fake homeserver answers.
- `compare.mjs`: `node --test` with two small result sets.
- The probe is exercised by the spec itself; a short smoke run (`real-work-smoke.json`: 3 threads, 30 s) runs on every change to the harness.

## Out of scope

- Fixes themselves: each is its own pull request after the baseline.
- Moving the existing perf specs onto the probe.
- iOS and Android device runs beyond a spot check of the top scenario in the simulator.
