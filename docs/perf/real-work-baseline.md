# Real-work baseline and hotspot list (2026-11-16)

What the Compact room view and an open thread cost at 7, 25 and 50 streaming replies, measured with `e2e/perf/real-work.live.spec.ts` on commit `3b54c062e` (the app's `src` tree is that of main at `51e8e9ac0`), and where the time goes. The budgets are the Success criteria of `docs/baspowers/specs/2026-11-15-real-work-load-design.md`. Each hotspot below is meant to start one fix pull request; it names the profile evidence and how the fix is measured with the same harness.

Numbers, source paths and method only. Numbers labeled "production copy" are aggregates (busy share, counts, times) from a private copy of a real homeserver on a personal machine; nothing else of it is here.

## Summary

- No budget holds at 50 streams except typing and thread open on the MacBook M5 at 1x CPU. The Compact view is the worst: 84 % of the main thread busy on the M5 (92 % on gce-dev), and saturated on both at a 4x CPU slowdown.
- At 7 streams, today's peak, the Compact view already misses its budget on the M5 (25 % and 53 % busy in two runs, 6 to 9 long frames over 100 ms in 30 s), and going back from a thread to the Compact view takes 250 to 310 ms against 200 ms.
- Three code paths take most of the time, and they are the same on both machines, at every level, and in the production copy's profiles: the thread index rebuilt for every room event (hotspot 1), read receipts looked up through every thread of the room (hotspot 2, inside 1 and 3), and Activity's rows rebuilt app-wide (hotspot 3). Together they are 47 % of the main thread in the Compact view at 50 streams on gce-dev (38 % on the M5) and 21 % (12 %) in an open thread.
- The heap that stays after a forced collection grows by 18 MB a minute at 50 streams and 7 MB at 7 (hotspot 4); the soak budget, 50 MB in 20 minutes, allows 2.5 MB a minute.
- With one agent the room never carries more than 30 live frames a second, whatever the number of streams: the homeserver's cap (hotspot 6).

## Method

- **Load.** `e2e/perf/workloads/real-work-50.json`: a room of 520 threads (470 resolved, 50 open, 12 of them heavy), 200 quiet rooms beside it, one agent, replies shaped by the census (150 words at the median, 2 tool calls of 10 s). `PERF_STREAMS` 7, 25 and 50; 47 to 49 of 50 streams were held in every window. `e2e/perf/workloads/real-work-50-agents.json` (17 agents, 170 threads) was run at 50 streams to see more frames than one sender may send.
- **Runs.** Every cell ran at `PERF_CPU_THROTTLE` 1 and 4 with `PERF_PROFILE=1`.
  - gce-dev (96 vCPUs, headless Chromium of the dev shell, 60 Hz): 3 runs per level through `scripts/perf/real-work/matrix.sh`, one job per level, 8 jobs at once at most. 12 jobs, none failed.
  - MacBook M5 on AC power (Playwright's Chromium, 120 Hz), the machine the budgets name: 2 runs per level, one after the other in one job, and one more run without profiles (7 and 50 streams). gce-dev at 1x is about half as fast as the M5 at 1x (the step back to the Compact view, which does not depend on the load: 490 ms against 250 ms).
- **Throttle on the M5.** The first M5 run showed the 4x rate holding for the first scenario only (the probe detaches its developer tools session at the end of a window, and the rate was 1 after that). Commit `fc38edcfe` sets the rate before every scenario; the M5 numbers at 4x below are from runs with it. gce-dev's Chromium kept the rate either way, so its runs are unaffected.
- **Medians.** A cell's value is the median of its runs. Busy is Chrome's `TaskDuration` over the window. "Over 100 ms" counts long animation frames over 100 ms in the window.
- **Profiles.** 252 CPU profiles (168 from gce-dev, 84 from the M5), each summarized with `scripts/perf/cpuprofile-summary.mjs --top 25` against a sourcemap build of the same commit. Shares below are a function's inclusive time over the window's wall time, which is its share of the main thread, as the median of the cell's profiles.
- **Raw results** (JSON, profiles, summaries, the scripts that made the tables): `~/mindroom-investigations/client-perf/baseline-2026-11-16/` on the machine that ran this, not in the repository.

## Result against the budgets

PASS and FAIL are judged per cell against the budget of that scenario: busy under 25 % and no animation frame over 100 ms (the two idle scenarios), frame p95 under 20 ms and no frame over 100 ms (scrolling), first rows within 300 ms (open), key to paint p95 under 50 ms (typing), each step within 200 ms (back and switch).

### MacBook M5, Chromium (2 runs per cell)

1x CPU:

| Scenario | 7 streams | 25 streams | 50 streams |
|---|---|---|---|
| Compact view, no input | 39 % (25 and 53), 8 over 100 ms **FAIL** | 58 %, 13 over 100 ms **FAIL** | 84 %, 18 over 100 ms **FAIL** |
| Compact view, wheel scrolling | p95 25 ms, 4 over 100 ms **FAIL** | p95 37 ms, 6 over 100 ms **FAIL** | p95 54 ms, 12 over 100 ms **FAIL** |
| Open a thread from its card | 134 ms PASS | 173 ms PASS | 165 ms PASS |
| Open thread, no input | 21 %, 1 over 100 ms **FAIL** | 34 %, 1 over 100 ms **FAIL** | 51 %, 1 over 100 ms **FAIL** |
| Typing in the thread composer | p95 10 ms PASS | p95 10 ms PASS | p95 10 ms PASS |
| Back to Compact, then another thread | back 278 ms, thread 124 ms **FAIL** | back 236 ms, thread 177 ms **FAIL** | back 253 ms, thread 141 ms **FAIL** |
| Reload to the first card (no budget) | 366 ms | 470 ms | 516 ms |

4x CPU:

| Scenario | 7 streams | 25 streams | 50 streams |
|---|---|---|---|
| Compact view, no input | 95 %, 94 over 100 ms **FAIL** | 94 %, 110 over 100 ms **FAIL** | 97 %, 122 over 100 ms **FAIL** |
| Compact view, wheel scrolling | p95 92 ms, 48 over 100 ms **FAIL** | p95 250 ms, 74 over 100 ms **FAIL** | p95 353 ms, 76 over 100 ms **FAIL** |
| Open a thread from its card | 860 ms **FAIL** | 733 ms **FAIL** | 609 ms **FAIL** |
| Open thread, no input | 58 %, 22 over 100 ms **FAIL** | 88 %, 50 over 100 ms **FAIL** | 93 %, 91 over 100 ms **FAIL** |
| Typing in the thread composer | p95 109 ms **FAIL** | p95 43 ms PASS | p95 200 ms **FAIL** |
| Back to Compact, then another thread | back 1024 ms, thread 804 ms **FAIL** | back 1030 ms, thread 671 ms **FAIL** | back 1026 ms, thread 236 ms **FAIL** |
| Reload to the first card (no budget) | 1528 ms | 1628 ms | 2000 ms |

The open thread's one frame over 100 ms at 1x is the end of the thread's own opening, which the scenario's window still sees; without it the 7-stream cell passes (21 % busy). The 7-stream load is bursty (a census reply streams text for about 5 s and runs tools for the rest), so at 7 streams the driver's 5 s reports range from 1 to 31 frames a second, and a 30 s window catches more or fewer of the bursts; that is the spread of 25 and 53 %.

### gce-dev, Chromium (3 runs per cell)

1x CPU:

| Scenario | 7 streams | 25 streams | 50 streams |
|---|---|---|---|
| Compact view, no input | 51 %, 28 over 100 ms **FAIL** | 87 %, 56 over 100 ms **FAIL** | 92 %, 72 over 100 ms **FAIL** |
| Compact view, wheel scrolling | p95 67 ms, 15 over 100 ms **FAIL** | p95 100 ms, 46 over 100 ms **FAIL** | p95 133 ms, 63 over 100 ms **FAIL** |
| Open a thread from its card | 351 ms **FAIL** | 326 ms **FAIL** | 182 ms PASS |
| Open thread, no input | 30 %, 2 over 100 ms **FAIL** | 59 %, 2 over 100 ms **FAIL** | 81 %, 1 over 100 ms **FAIL** |
| Typing in the thread composer | p95 20 ms PASS | p95 26 ms PASS | p95 74 ms **FAIL** |
| Back to Compact, then another thread | back 497 ms, thread 220 ms **FAIL** | back 504 ms, thread 296 ms **FAIL** | back 488 ms, thread 201 ms **FAIL** |
| Reload to the first card (no budget) | 1289 ms | 1685 ms | 1627 ms |

4x CPU:

| Scenario | 7 streams | 25 streams | 50 streams |
|---|---|---|---|
| Compact view, no input | 97 %, 61 over 100 ms **FAIL** | 98 %, 75 over 100 ms **FAIL** | 98 %, 82 over 100 ms **FAIL** |
| Compact view, wheel scrolling | p95 567 ms, 53 over 100 ms **FAIL** | p95 617 ms, 59 over 100 ms **FAIL** | p95 733 ms, 64 over 100 ms **FAIL** |
| Open a thread from its card | 1410 ms **FAIL** | 1516 ms **FAIL** | 681 ms **FAIL** |
| Open thread, no input | 94 %, 33 over 100 ms **FAIL** | 98 %, 78 over 100 ms **FAIL** | 98 %, 71 over 100 ms **FAIL** |
| Typing in the thread composer | p95 327 ms **FAIL** | p95 363 ms **FAIL** | p95 369 ms **FAIL** |
| Back to Compact, then another thread | back 2093 ms, thread 1031 ms **FAIL** | back 2012 ms, thread 439 ms **FAIL** | back 2042 ms, thread 390 ms **FAIL** |
| Reload to the first card (no budget) | 5040 ms | 6589 ms | 5666 ms |

### 17 agents, gce-dev, 50 streams (3 runs)

| Scenario | 1x CPU | 4x CPU |
|---|---|---|
| Compact view, no input | 79 %, 14 over 100 ms **FAIL** | 98 %, 99 over 100 ms **FAIL** |
| Compact view, wheel scrolling | p95 33 ms, 12 over 100 ms **FAIL** | p95 533 ms, 57 over 100 ms **FAIL** |
| Open a thread from its card | 358 ms **FAIL** | 809 ms **FAIL** |
| Open thread, no input | 50 %, 1 over 100 ms **FAIL** | 96 %, 44 over 100 ms **FAIL** |
| Typing in the thread composer | p95 23 ms PASS | p95 139 ms **FAIL** |
| Back to Compact, then another thread | back 324 ms, thread 281 ms **FAIL** | back 1104 ms, thread 408 ms **FAIL** |

This room has 170 threads, a third of the other profile's, so its Compact view is cheaper although it carries more frames (47 a second against 30): the Compact cost follows the number of threads more than the frame rate.

### 20 minutes of streaming (gce-dev, 50 streams, 1x, one run)

| Budget | Measured | |
|---|---|---|
| Heap growth under 50 MB | 70 MB to 1,232 MB as sampled; the lowest sample of each 2 minutes rose from 164 MB to 1,038 MB | **FAIL** |
| DOM node count stays bounded | 3,400 to 65,700 as sampled; 3,300 to 5,200 after a forced collection (10-minute run) | PASS |

A second run of 10 minutes forced a collection after every minute and read the heap then: 134 MB after minute 1 and 302 MB after minute 10 at 50 streams (18 MB a minute), 81 MB and 145 MB at 7 streams (7 MB a minute). So most of the 1.2 GB is garbage a busy main thread had not collected yet, and what stays still grows 3 to 7 times faster than the budget's 2.5 MB a minute. Hotspot 4.

### The load the room carried

Per second over the whole live phase after the ramp, from the driver's own sync (mean of its 5 s reports): live frames (and the busiest 5 s), durable edits, jobs state writes.

| Run | 7 streams | 25 streams | 50 streams |
|---|---|---|---|
| gce-dev, one agent | 11 (28), 0.6, 0.9 | 27 (32), 2.2, 3.3 | 30 (32), 4.1, 6.0 |
| M5, one agent | 12 to 15 (31), 0.6 to 1.0, 1.0 to 1.3 | 27 (32), 2.2, 3.3 | 30 (33), 4.9, 6.9 |
| gce-dev, 17 agents | | | 47 (77), 4.3, 1.8 |

With one agent the frames stop at 30 a second (150 in nearly every 5 s report at 50 streams): hotspot 6. With 17 agents the same 50 streams carry 47 a second and up to 77; a census reply streams text for a small part of its life, so 50 streams are far from 500 frames a second. Durable edits and jobs state writes keep growing with the streams, and the Compact cost grows with them.

## Hotspots, ranked

Shares are of the main thread (inclusive time over the window) at 1x CPU, as "gce-dev / M5", at 50 streams unless a level is named. "Compact" is the `compact-idle` window, "thread" the `thread-idle` window. Function names are the source's; `file:line` is where the profile's frame starts.

Measuring a fix, for every entry: run the named scenarios on the base and on the fix with profiles, at least 3 runs each, and compare:

```bash
scripts/perf/real-work/matrix.sh <commit> <out>/<base|head> gce:<slot>,gce:<slot>,gce:<slot> -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1,4 \
  PERF_PROFILE=1 PERF_SCENARIOS=<scenarios>
node scripts/perf/real-work/compare.mjs --base <out>/base/gce-* --head <out>/head/gce-*
node scripts/perf/cpuprofile-summary.mjs <profile> --maps <sourcemap build> --build <served build> --callers '<function>'
```

The entry names the metric of `compare.mjs` that should move and the function whose time should fall.

### 1. The thread index is rebuilt for every room event

- **Scenario:** Compact view (idle and scrolling), and each return to it (`switch`, `cold-load`).
- **Share:** Compact 34 % / 29 % at 50 streams, 27 % / 18 % at 25, 10.5 % / 8.9 % at 7; scrolling 35 % / 25 %; `switch` 13 % / 9 %; `cold-load` 12 % / 19 %. Production copy, 7 streams, M5: 27 % of the main thread, 63 % of what was busy. It is nearly all of `RoomTimeline`'s render time (34.7 % with it, 0.6 % without).
- **Functions:** `useThreadIndex` (`src/app/threads/overview/useThreadIndex.ts:318`), its record map memo (`:556`) calling `buildThreadIndexRecordMaps` (`threads/overview/threadIndexRecords.ts:46`), `buildThreadRecordMap` and `buildThreadRecord` (`event-store/threads/threadRecord.ts:386`, `:220`) for every thread root; inside each record `resolveThreadPresentationSnapshot` (`event-store/threads/threadPresentation.ts:104`), `getThreadEventReadUpTo` (`event-store/threads/threadEventReadUpTo.ts:40`), `getBundledThreadPreviews` (`event-store/threads/threadBundledPreviews.ts:10`), `isEventStreaming` (`event-store/threads/useThreadStreamingState.ts:93`); and the unread map of `useRoomThreadList` (`threads/overview/useRoomThreadList.ts:243`, `getRoomThreadsUnread`), about 8 % / 6 % of the Compact window.
- **Load that drives it:** `useThreadOverviewRefreshCounter` (`threads/overview/threadOverviewRefreshCounter.ts:27`) adds one for every timeline event, receipt and thread update of the room, and the memo depends on it, so each durable edit, jobs state write or receipt rebuilds the records of all 520 threads: 22 commits a second at 50 streams, about 16 ms of index each on gce-dev. The cost is (events a second) times (threads in the room); resolved threads count although the Compact view leaves them out.
- **Budget it blocks:** Compact busy and long frames, scroll frame p95, the 200 ms back step.
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,compact-scroll,switch`; `metrics.busy` and `frames.p95` of `compact-idle` and `compact-scroll`, `timings.back-*` of `switch`; inclusive time of `useThreadIndex.ts:318`. A fix that rebuilds only the threads an event touches should bring the share at 50 streams near the 7-stream one.

### 2. Read receipts are looked up through every thread of the room

- **Scenario:** every scenario; it is the largest leaf inside hotspots 1 and 3.
- **Share:** Compact 24 % / 17 %, thread 15.5 % / 7.5 %, typing 15 % / 7 %, at 4x in the open thread 25 % / 19 %. Of it, in the Compact window: 14.7 % under the thread index, 9.4 % under Activity's rows. Production copy, Compact, 7 streams: 16 % of the main thread; `Room.getThreads` alone was the top self time (13 %).
- **Functions:** `receiptReadTs` (`src/app/matrix/receiptReadTs.ts:64`), called by `seenReceiptReadTs` (`:84`), `unthreadedReceiptReadTs` (`:103`), `contextReceiptReadTs` (`:121`), `getMainTimelineReadTs` (`matrix/mainTimelineRead.ts:14`) and `getThreadReadState` (`event-store/threads/roomThreadList.ts:47`). It calls `context.findEventById` and then `Room.findEventById` (`matrix-js-sdk/lib/models/room.js:1279`), which for an event the client does not hold copies the thread list (`Room.getThreads`, `room.js:1649`) and asks every thread (`Thread.findEventById`, `EventTimelineSet.getTimelineForEvent`, `event-timeline-set.js:245`): top self times of the Compact window, 13.9 % / 6.7 % and 4.7 % / 3.7 %.
- **Load that drives it:** a receipt on an event outside what the client loaded (the person's unthreaded receipt from early in the history, a thread receipt on a reply's last edit) misses in every lookup, and one miss costs one probe per thread; the callers ask once per thread and per receipt type, so a rebuild costs about (threads) squared probes. It grows with the room's thread count, not with the streams.
- **Budget it blocks:** Compact busy, open-thread busy, typing p95 at 4x.
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,thread-idle,thread-type`; `metrics.busy` of both idle scenarios; inclusive time of `receiptReadTs.ts:64` and self time of `event-timeline-set.js:245` and `room.js:1649` should fall to near zero (a read time remembered per receipt, or a lookup that does not scan the threads).

### 3. Activity's rows are rebuilt app-wide whenever a room's unread state moves

- **Scenario:** every scenario; it is the largest entry while a thread is open.
- **Share:** thread 21 % / 12 %, typing 21 % / 12 %, open 20 % / 14 %, Compact 13 % / 9 %; at 4x in the open thread 35 % / 29 %. Without the receipt lookups of hotspot 2 inside it: 6 % / 5 % in the open thread. Production copy, open thread, 7 streams: 3.8 % of the main thread, 16 % of what was busy, the top entry of the app's own code.
- **Functions:** `useComputedActivityRows` (`src/app/activity/ActivityRowsFeature.tsx:30`, mounted once for the session by `ActivityRowsFeature`, `:69`), `buildActivityRows` (`activity/activityRows.ts:95`), `createThreadSignalsReader`'s `read` (`threads/cross-room/threadSignalsReader.ts:32`), `readThreadSignals` (`threads/cross-room/threadSignals.ts:282`), which reads each thread's newest messages with `getThreadReadState` and `isReplyUnread`.
- **Load that drives it:** the memo depends on the cross-room thread index and on `roomToUnreadAtom`; the reader's cache key holds the room's change count, so anything the room hears (an edit, a jobs state write, a receipt) makes every thread of that room read again. With 50 streams the room changes several times a second and each change reads 520 threads.
- **Budget it blocks:** open-thread busy and long frames, typing p95 at 4x, Compact busy.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type,compact-idle`; `metrics.busy` of `thread-idle`, `inputs.p95` of `thread-type` at 4x; inclusive time of `ActivityRowsFeature.tsx:69`.

### 4. The heap that stays grows with the streams

- **Scenario:** `soak` (60 s Compact and 60 s thread in turn).
- **Evidence:** the soak table above; after forced collections 18 MB a minute at 50 streams and 7 MB at 7. Chrome's count of event listeners after a collection grew from 10,400 after the first minute to 23,600 after the tenth at 50 streams and stayed between 1,500 and 2,100 at 7. DOM nodes did not grow. A sampling heap profile of the 10-minute run at 50 streams (259 MB live) puts the allocations still alive at: 113 MB with no script frame (values the browser made: parsed sync answers, IndexedDB results); 47 MB under `persistRoomChunkWithPreferLive` (`src/app/event-store/cache/eventRepository.ts:1276`) through `persistThreadCacheFromRoomEventsSnapshot` (`:1078`), `persistThreadEventCacheSnapshot` (`:966`) and `serializeThreadCacheEvents` (`:809`) to `serializeEventsForCache` (`event-store/cache/eventCacheEditUtils.ts:405`) and `cloneRawEvent` (`matrix/editEvent.ts:9`, 31 MB of copies of raw events); 46 MB under `buildThreadRecord` (`event-store/threads/threadRecord.ts:220`, hotspot 1's records). At 7 streams the same two paths held 0 and 2 MB of 100 MB.
- **Load that drives it:** durable edits and jobs state writes (10 a second at 50 streams). Whether the copies wait in a queue of cache writes that falls behind, or old index generations stay referenced, is not settled: this is one profile at one point in time.
- **Budget it blocks:** heap growth under 50 MB in 20 minutes.
- **Measure a fix:** `PERF_SOAK=1 PERF_SCENARIOS=none PERF_STREAMS=50 PERF_CPU_THROTTLE=1` (20 minutes; `PERF_SOAK_MINUTES` shortens it). The spec's own check compares the first and the last raw heap sample, which is noisy under a busy main thread; read the heap after `HeapProfiler.collectGarbage` as this baseline did (a throwaway patch of the soak test: a collection and `Performance.getMetrics` after every minute, `HeapProfiler.startSampling` at the start and `getSamplingProfile` at the end). First step of the fix thread: two sampling profiles, at minute 2 and minute 10, and their difference.

### 5. The jobs strip reads every agent reply again for each event

- **Scenario:** Compact view, most of all while scrolling and during a reload.
- **Share:** scrolling 16.5 % / 14.5 %, `cold-load` 27 % / 16 %, Compact 6.7 % / 6.8 %; at 4x scrolling 36 % / 40 %, Compact 21 % / 16 %. It grows faster than the streams (Compact on gce-dev: 2.7, 4.6 and 6.7 % at 7, 25 and 50).
- **Functions:** `useJobRepliesStreaming` (`src/app/background-jobs/useJobRepliesStreaming.ts`): `refresh` (`:96`) calls `read` (`:44`) and `repliesOf`, which for every job owner takes the thread's tail and asks `isEventStreaming` (`event-store/threads/useThreadStreamingState.ts:93`) for each reply; under it `getEditedEvent` and `getEditCandidates` (`matrix/room.ts:458`, `:426`), `getShallowSerializedReplacementEvent` (`matrix/editEvent.ts:65`) and the metadata copy of `matrix/protocol/editMetadata.ts:17` (11 % / 10.5 % and 5 % / 3 % of the scroll window, shared with hotspot 1).
- **Load that drives it:** `refresh` listens to `RoomEvent.Timeline`, `ThreadEvent.Update` and `ThreadEvent.NewReply` of the room, and each call walks all running jobs' threads: (events a second) times (jobs running), so about quadratic in the streams.
- **Budget it blocks:** scroll frame p95, Compact busy, and the time to a usable room after a reload.
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,compact-scroll,cold-load`; `frames.p95` of `compact-scroll`, `timings.cold-load`; inclusive time of `useJobRepliesStreaming.ts:96`.

### 6. Server: one sender may send 30 live frames a second to a room

- **Where:** MindRoom's Tuwunel (`mindroom-tuwunel`), `src/service/rooms/ephemeral/mod.rs`: `RATE_LIMIT` is 30 events per sender, room and window; `src/api/client/ephemeral.rs` answers the rest with 429 "Too many ephemeral events in this room.".
- **Evidence:** with one agent the driver's sync saw 27 frames a second at 25 streams and 30 at 50 (150 in nearly every 5 s report, never more than 33 a second), on gce-dev and on the M5 alike; with 17 agents 47 a second and up to 77. The backend sends a frame every 100 ms per reply whose text changes, so one agent passes the cap at 4 replies that stream text at once.
- **What the person sees:** past the cap a reply's frames are dropped and its text moves only with the 5 s snapshots and the durable edits: at 50 threads with one agent, about a third of the frames the replies made did not arrive (30 a second of 47), and text comes in jumps of up to 5 s. Bas's agent rooms have one agent each.
- **Budget it blocks:** none of the main-thread budgets (it lowers the client's load), but "everything just works" at 50 threads; and until it is fixed the client cannot be measured past 30 frames a second with one agent. The 17-agent profile stands in.
- **Measure a fix:** the driver's `framesPerSecond` (each result's `achieved`) at `PERF_STREAMS=50` with `real-work-50.json` should pass 30 a second and reach what the 17-agent profile carries; then every client number of this baseline at 25 and 50 streams must be taken again, because the client's load rises.

### 7. Going back to the Compact view, and switching between heavy threads

- **Scenario:** `switch`, `thread-open`.
- **Evidence:** the back step takes 236 to 278 ms on the M5 and 490 to 500 ms on gce-dev at every level, 7 streams included, and about 1,030 ms on the M5 at 4x; it does not depend on the streams. Production copy, nothing streaming, M5: back 227 ms (median of 15), the next thread 739 ms (median of 15, 123 to 787 ms), with 187,000 to 324,000 DOM nodes after five switches; the synthetic threads are about 2.5 times lighter here (1,500 to 1,900 attached nodes in an open thread, next thread 124 to 177 ms), so the synthetic numbers understate the thread step.
- **Functions:** in the `switch` window: the thread index of hotspot 1 (13 % / 9 %), Activity's rows (15 % / 10 %), the event cache (8 % / 12 %), React's own commit work outside any app frame (5.6 % / 5.2 %). In the production copy's `switch` profile, of 11.3 s: `RoomTimeline` 1.49 s, of it `useThreadIndex` 1.11 s (the Compact view mounting again); for the thread step, message rendering is among the copy's top 15 self times and absent from the synthetic ones: `isContentOverflowing` (`src/app/timeline/CollapsibleMessage.tsx:97`), the HTML parser's replace function (`messages/html/react-custom-html-parser.tsx:78`), `UrlPreviewCard.tsx:162`.
- **Load that drives it:** the back step mounts the Compact view and builds the index of all threads from nothing; the thread step renders every loaded reply of the thread, and real replies are long (bodies up to 3,400 lines, tool blocks).
- **Budget it blocks:** each step within 200 ms (misses at every level); open within 300 ms at 4x.
- **Measure a fix:** `PERF_SCENARIOS=switch,thread-open`, `PERF_STREAMS=7` is enough for the back step: `timings.back-*`. The thread step needs the production copy (the spec's external mode, on a personal machine only) or a stub reply with many lines and tool blocks; with the synthetic load alone a fix of the thread step cannot be shown.

### 8. The event cache scans the room for every redaction, and copies events to save them

- **Scenario:** open thread at 25 and 50 streams, thread open, `switch`.
- **Share:** cache callbacks that run outside every other entry here: thread 14 % / 8 %, open 10 % / 16.5 %, typing 10 % / 7 %, `switch` 6 % / 11 %, Compact 4 % / 7 %.
- **Functions:** the IndexedDB cursors of `runScrubRedactedRelationsTxn` (`src/app/event-store/cache/db/cacheStoreEvents.ts:246`; the profile's frames are its `onsuccess` callbacks at `:319`, all cached events of the room, and `:352`, all its meta rows; 4.6 % and 4.4 % self time of the thread window on gce-dev), called from `saveRoomEventsToCacheCommitted` (`:683`) and `saveThreadEventsToCacheCommitted` (`:1285`); the cursor of `deleteThreadEventFromCacheByEventId` (`:1583`, frame `:1608`, 2 % on the M5); `scheduleEventPutsWithLedger` (`:785`, frame `:820`); and `serializeEventsForCache` (`event-store/cache/eventCacheEditUtils.ts:405`).
- **Load that drives it:** every reply that ends redacts its stop reaction; a save that carries a redaction walks every cached event and meta row of the room (11,000 events and more). It grows with (replies ending a second) times (events in the room).
- **Budget it blocks:** open-thread busy, typing p95.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type,thread-open`; `metrics.busy` of `thread-idle`; self time of `cacheStoreEvents.ts:319` and `:352`.

### 9. Listing the room's threads hashes every root again on each page

- **Scenario:** `cold-load`, and the first half minute of any Compact window after the room opens.
- **Share:** `cold-load` 13 to 26 % / 14 to 22 % over the levels; first Compact window 4.4 % / 2 %, at 4x 18 % / 9 %.
- **Functions:** `loadRoomThreadsOnce` (`src/app/event-store/threads/roomThreadList.ts:184`) calls its progress listener for each page of `/threads`; the listener in `useRoomThreadList` (`threads/overview/useRoomThreadList.ts:137`) walks `room.getThreads()` and for every root runs `saveRoot` (`:118`) and `getRootRevision` (`:56`): `JSON.stringify` of `serializeThreadCacheEvents` and a string hash (`hashRevision`, `:43`). Of the load's time, 80 % is the revision.
- **Load that drives it:** (pages of the thread list) times (threads listed so far): 520 threads come in pages, and each page hashes all roots again.
- **Budget it blocks:** none directly (the reload has no budget), but it sits in the Compact window right after a room opens and delays the first usable frame at 4x.
- **Measure a fix:** `PERF_SCENARIOS=cold-load,compact-idle`; `timings.cold-load` and `metrics.busy` of `cold-load`; inclusive time of `useRoomThreadList.ts:56`.

### 10. The room's unread entry is recounted for every event

- **Scenario:** every scenario; relatively largest in the open thread at 7 and 25 streams.
- **Share:** thread 9.4 % / 4.7 % at 50 streams and 12.9 % at 25 on gce-dev; typing 7.9 % / 4.7 % (11.4 % at 7 on gce-dev); Compact 4.8 % / 3 %.
- **Functions:** the `update` listener of `roomToUnread` (`src/app/matrix/state/roomToUnread.ts:229`, `:235`) calls `getRoomUnreadAction` (`:167`), which reads `getUnreadInfo` (`matrix/room.ts:705`: twice `Room.getUnreadNotificationCount`, `matrix-js-sdk/lib/models/room.js:1313`, a sum over every thread's counts; 5.6 % self time in the thread window on gce-dev) and `roomHaveUnread`.
- **Load that drives it:** each timeline event and each count change of the room; one call sums over all threads with a count.
- **Budget it blocks:** open-thread busy at 7 and 25 streams.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type`; inclusive time of `roomToUnread.ts:235`.

### 11. The crypto machine handles every sync, in an unencrypted room

- **Scenario:** every scenario; it follows the number of syncs.
- **Share:** 2 to 4 % / 1.4 to 2.6 % with one agent (10 to 13 syncs a second); 5.5 to 10 % with 17 agents (17 to 21 syncs a second) on gce-dev, 7 % of the open-thread window.
- **Functions:** `matrix-js-sdk`'s sync (`lib/sync.js:1182`) hands each answer to the Rust crypto machine: `OlmMachine::receive_sync_changes`, `StoreTransaction::commit`, `Account::from_pickle`, and under it Curve25519 arithmetic (`EdwardsPoint::mul_base`) in `matrix_sdk_crypto_wasm`. About 3 ms per sync on gce-dev.
- **Load that drives it:** the sync rate; a sync without to-device messages or key counts still unpickles the account.
- **Budget it blocks:** a few points of busy in every scenario; more once the frame cap is lifted and syncs come faster.
- **Measure a fix:** `PERF_WORKLOAD=e2e/perf/workloads/real-work-50-agents.json PERF_SCENARIOS=thread-idle`; time under `matrix_sdk_crypto_wasm` (`--callers 'matrix_sdk_crypto_wasm'`).

### 12. A streaming reply's body is parsed again per frame (production copy; the synthetic load understates it)

- **Scenario:** open thread while its reply streams.
- **Share:** production copy, 7 streams, M5: `RenderBody` 2.7 % of the main thread, 12 % of what was busy, with `HTMLReactParser` under it (2.3 %), `linkify` and the replace function of `react-custom-html-parser.tsx:78` among the top self times; the open thread stayed at about 22 % busy from 1 to 7 streams there. Synthetic, 50 streams: `RenderBody` 0.3 % / 0.3 %, all message components 3.5 % / 2.2 %: the stub's replies are a few paragraphs, real ones are line-heavy.
- **Functions:** `RenderBody` (`src/app/messages/content/RenderBody.tsx:84`, its parse memo at `:97`), `html-react-parser`, `src/app/messages/html/react-custom-html-parser.tsx:78`.
- **Load that drives it:** live frames of the open thread's reply (10 a second), each parsing the whole body so far.
- **Budget it blocks:** open-thread busy, by itself only with long replies.
- **Measure a fix:** not with the committed profiles. Needs the production copy, or a stub reply with many lines (lists, code, tables) in the open thread; then `PERF_SCENARIOS=thread-idle` and inclusive time of `RenderBody.tsx:84`.

### Not ranked

- **Time outside script:** `(program)` is 7 to 21 % of every window (style, layout, paint and other native work; Chrome's layout and style totals are 1 to 4 % of the wall time) and the collector up to 4 %. A CPU profile does not divide it; `PERF_TRACE=1` would.
- **`savedSyncRedactions`** (`src/app/matrix/client/savedSyncRedactions.ts:218`, `:263`): 1 to 3 %.
- **Encryption:** the measured room is unencrypted, as Bas's agent rooms are; frame decryption and the encrypted unread recount were not measured.

## WebKit check

MacBook M5, Playwright's WebKit against Playwright's Chromium, 7 streams, 1x, back to back in one job (two rounds of each, same room, same driver seed; by the page's count 12.6 to 13 frames a second in every window, except one Chromium Compact window with 21). WebKit has no developer tools session, so there is no busy share, no long animation frames and no profile: only frame intervals, commits and the load.

| Window | Engine | Frame p50 | Frame p95 | Longest frame | Frames painted of those possible |
|---|---|---|---|---|---|
| Compact, no input | Chromium (120 Hz) | 8.3 ms | 10.1, 10.2 ms | 133 ms | 91 and 90 % (3,290 and 3,243 of 3,600) |
| Compact, no input | WebKit (60 Hz) | 17 ms | 52, 51 ms | 204, 206 ms | 84 % (1,516 and 1,515 of 1,800) |
| Open thread, no input | Chromium | 8.3 ms | 10 ms | 34, 43 ms | 99 % |
| Open thread, no input | WebKit | 17 ms | 25, 24 ms | 87, 89 ms | 98 % |

In the earlier single pass WebKit's typing was p95 19 ms against 10 ms, and its Compact window under 29 frames a second had a frame p95 of 82 ms.

Reading: the open thread is fine in WebKit at 7 streams. The Compact view is worse than in Chromium: one frame in six is late or dropped, and the longest frames are 200 ms. Nothing here says the cause differs from hotspots 1 to 3 (WebKit gives no profile), so the Compact fixes should be checked in WebKit again; this check is frame timing only.

How it ran: the spec's tests carry no `@webkit` tag, which the `webkit` Playwright project needs, so a throwaway commit added the tag to the test title; then on the M5, with `PLAYWRIGHT_WEBKIT_EXECUTABLE` set to Playwright's WebKit, `PERF_STREAMS=7 PERF_CPU_THROTTLE=1 PERF_SCENARIOS=compact-idle,thread-idle npx playwright test e2e/perf/real-work.live.spec.ts --project=webkit` inside `scripts/e2e-slot.sh <n> --snapshot --preview`.

## Nodes check: garbage, not a leak

The probe's `nodes` (Chrome's count of live `Node` objects) read 5,000 to 68,000 in the thread scenarios, and 140,000 to 150,000 in the production copy's thread view, while the page held far fewer attached nodes. One run on gce-dev (7 and 50 streams, 1x) counted, after `compact-idle`, `thread-open`, `thread-idle` and `switch`: Chrome's `Nodes`, the nodes attached to the documents (a tree walk, text nodes included), then forced three collections (`HeapProfiler.collectGarbage`) and counted again, twice 5 s apart.

| After | Attached | `Nodes` before a collection | `Nodes` after it |
|---|---|---|---|
| Compact, no input | 3,040 to 3,200 | 3,200 to 3,600 | 3,200 to 3,350 |
| Thread open | 1,630 to 1,730 | 4,400 to 9,900 | 3,850 to 3,880 |
| Open thread, no input | 1,600 to 1,740 | 3,900 to 5,300 | 3,910 to 3,920 |
| Five switches | 1,490 to 1,740 | 4,100 to 4,800 | 3,800 to 4,700 |

After a collection the count stays in one band at both levels: 2,100 to 2,300 nodes above the attached ones after a thread opens and while it is open, 2,300 (50 streams) and 3,000 (7 streams) after five switches, and about 150 above them in the Compact view (the page's other documents). The large readings are nodes waiting for the collector, made by re-rendering; they fall back at each collection. So the large counts do not hold after a collection, and the node count is not a hotspot of its own; the churn that makes them is the re-rendering of hotspots 1 and 3. The 10-minute soak agrees: 3,300 to 5,200 nodes after each forced collection. The production copy's thread view was not checked this way.

## How to rerun

On pc, from a checkout that holds the commit; gce-dev slots 80 to 89 were used (check that a slot's ports are free), at most 8 jobs at once.

```bash
export SSH_AUTH_SOCK=$(ls ~/.keychain/*.s | head -1)
H=$(git rev-parse HEAD); OUT=<private directory>
# one job per level and run (3 runs: slots apart), and the 17-agent profile
for level in 7 25 50; do
  scripts/perf/real-work/matrix.sh $H $OUT/s$level gce:80,gce:81,gce:82 -- \
    PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=$level PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1
done
scripts/perf/real-work/matrix.sh $H $OUT/agents gce:80,gce:81,gce:82 -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50-agents.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1
# the soak
scripts/perf/real-work/matrix.sh $H $OUT/soak gce:83 -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1 PERF_SOAK=1 PERF_SCENARIOS=none
```

A job takes about 22 minutes for one level at two throttles (11 of them the history), the soak 33. `matrix.sh` runs the three slots of one call at once; this baseline ran the levels at once as well.

On the M5 (AC power; `~/repos/machines.sh`), through `~/repos/dev/scripts/mac-runner/remote-test.sh m5 <commit> exec bash -c '...'`, with `E2E_MINDROOM_CHECKOUT` naming the backend clone and `E2E_SNAPSHOT_ROOT` and `E2E_AGENT_STACK_ROOT` in a directory of its own: `PERF_REAL_WORK=1 PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=7,25,50 PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1 scripts/e2e-slot.sh <n> --snapshot --preview npx playwright test e2e/perf/real-work.live.spec.ts --project=chromium`. One run of three levels takes 19 minutes after 7 minutes of history; use a commit with `fc38edcfe`.

Profiles: `cpuprofile-summary.mjs` needs a sourcemap build of the same commit (`--maps`) and the served build (`--build`), which it uses to tell apart the chunks that share a name (four are called `index`). `matrix.sh` removes the served build with the run's directory. This baseline built the sourcemap variant the way the slot builds (`MINDROOM_BUILD_VERSION=<commit> npx vite build --sourcemap --outDir <dir> --emptyOutDir`, then the same with `E2E_FIXTURE_PAGES=1` and without `--emptyOutDir`), found for each served chunk name in a profile the built chunk whose text has the profile's function names at the profile's positions, and gave `--build` a directory that holds that chunk under the served name. Two builds of one commit differ in the chunks' hashed names and in short minified names, not in positions, so any such build maps the profiles of any other.

## Limits

- gce-dev's Chromium is headless at 60 Hz with software rendering and a slower core than the M5; its absolute numbers are not the budget's, its shares and rankings match the M5's. The M5 has 2 profiled runs per cell, taken one after the other.
- The 17-agent room has 170 threads, so it understates the Compact view of a 520-thread room; it is used here only for the effect of more frames and more syncs.
- The synthetic thread view is about 2.5 times lighter than the production copy's (hotspots 7 and 12 say where that matters). Its Compact view, reload and typing match the copy within the calibration's factor of 1.5.
- A census reply streams text for a small part of its life, so at 7 streams the live load is bursty and a 30 s window varies from run to run (M5 Compact: 25 and 53 % busy).
- The soak ran once at 20 minutes and once at 10 with forced collections, on gce-dev only.
- Eight jobs ran at once on gce-dev (load average about 15 on 96 vCPUs); the three runs of a cell agree within a few points of busy.
