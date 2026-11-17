# Real-work baseline and hotspot list (2026-11-16)

What the Compact room view and an open thread cost at 7, 25 and 50 streaming replies, measured with `e2e/perf/real-work.live.spec.ts` on commit `3b54c062e` (the app's `src` tree is that of main at `51e8e9ac0`), and where the time goes. The budgets are listed under "Result against the budgets"; they are set for the MacBook M5 in Chromium, with and without a 4x CPU slowdown. Each hotspot below is meant to start one fix pull request; it names the profile evidence and how the fix is measured with the same harness.

Numbers, source paths and method only. Numbers labeled "production copy" are aggregates (busy share, counts, times) from a private copy of a real homeserver on a personal machine; nothing else of it is here.

## Summary

- At 50 streams and 1x CPU the only budgets that hold are typing and thread open on the MacBook M5, thread open on gce-dev (182 ms), and the bounded DOM node count of the soak. The Compact view is the worst: 84 % of the main thread busy on the M5 (92 % on gce-dev), and saturated on both at a 4x CPU slowdown.
- At 7 streams, today's peak, the Compact view already misses its budget on the M5 (25 % and 53 % busy in two runs, 6 to 9 long frames over 100 ms in 30 s), and going back from a thread to the Compact view takes 236 to 278 ms there at every level (medians; single runs 233 to 308 ms) against 200 ms.
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
- **Raw results** (JSON, profiles, summaries, the scripts that made the tables): a private directory on the machine that ran this (`<private results dir>` below), not in the repository.

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

A second run of 10 minutes (a throwaway patch) forced a collection after every minute and read the heap then: 134 MB after minute 1 and 302 MB after minute 10 at 50 streams (18 MB a minute), 81 MB and 145 MB at 7 streams (7 MB a minute). So most of the 1.2 GB is garbage a busy main thread had not collected yet, and what stays still grows 3 to 7 times faster than the budget's 2.5 MB a minute. Hotspot 4. The spec's `PERF_SOAK_GC=1`, added after these runs, reads the soak this way; its own 10-minute run at 50 streams read 156 MB after the first minute and 300 MB after the tenth.

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

An entry marked **Addressed** names the pull request that fixed it. Its share, load and evidence lines still describe main before that fix (the numbers are the baseline's); its function and `file:line` references are those of the main that has the fix, and its "Measure a fix" recipe is the one that measured it.

Measuring a fix, for every entry: run the named scenarios on the base and on the fix with profiles, at least 3 runs each, and compare:

```bash
scripts/perf/real-work/matrix.sh <commit> <out>/<base|head> gce:<slot>,gce:<slot>,gce:<slot> -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1,4 \
  PERF_PROFILE=1 PERF_SCENARIOS=<scenarios>
node scripts/perf/real-work/compare.mjs --base <out>/base/gce-* --head <out>/head/gce-*
# a function's time in one profile: a sourcemap build made as the slot makes the served one
# (a copy without .git), and the scripts the run served
git archive <commit> | tar -x -C <copy> && ln -s "$PWD/node_modules" <copy>/node_modules
(cd <copy> && MINDROOM_BUILD_VERSION=<commit> npx vite build --sourcemap --outDir maps --emptyOutDir)
node scripts/perf/cpuprofile-summary.mjs <out>/head/gce-<slot>/<profile> --maps <copy>/maps \
  --build <out>/head/gce-<slot>/served-build --callers '<function>'
```

`matrix.sh` leaves `served-build/assets/` in each run's results (from commit `5bf6c74e3`), and the summary warns on stderr when a chunk of the sourcemap build is not the served one ("How to rerun" says what to do then). The entry names the metric of `compare.mjs` that should move and the function whose time should fall. Two entries (7 and 12) cannot be measured this way; they say what they need.

### 1. The thread index is rebuilt for every room event

- **Addressed:** #434 and #459. A room event builds the record of the thread it touches: the counter says what each count may have changed (`overviewChanges`: one thread, or the whole room), and `buildThreadRecordMap` keeps the record of the build before it for each thread with no change marked, checked against what it was built from. A build still walks every thread root to compare what it was given, and one second after a build that kept a record (`KEPT_RECORD_CHECK_MS`) one more count covers what no event tells of. #434's paired run at 50 streams, gce-dev, 1x: Compact busy 93.7 % to 83.8 %, frame p95 150 to 50 ms, `useThreadIndex` 35.7 % to 11.6 % of the window; the index's part of a back step fell from about 283 to about 101 ms, and the back step still misses its 200 ms (hotspots 9 and 10 held the rest). What is left of record building while scrolling: each card that comes into view loads its thread's first page, which starts that thread's timeline over and marks the whole room.
- **Scenario:** Compact view (idle and scrolling), and each return to it: the back step of `switch`, and `cold-load`.
- **Share:** Compact 34 % / 29 % at 50 streams, 27 % / 18 % at 25, 10.5 % / 8.9 % at 7; scrolling 35 % / 25 %; `switch` 13 % / 9 %; `cold-load` 12 % / 19 %. Production copy, 7 streams, M5: 27 % of the main thread, 63 % of what was busy. It is nearly all of `RoomTimeline`'s render time (34.7 % with it, 0.6 % without).
- **The back step is this hotspot.** Going back from a thread mounts the Compact view, which builds the index of every thread from nothing: 236 to 278 ms on the M5 and 490 to 500 ms on gce-dev at every level, 7 streams included (it does not depend on the streams), about 1,030 ms on the M5 at 4x. The index takes most of it: per back step 243 ms of 278 ms on the M5 and 367 ms of 497 ms on gce-dev at 7 streams (the index's time in the `switch` window over its five back steps; the index does not run while a thread is open), and in the production copy with nothing streaming 218 ms of 227 ms (back: median of 15). Under streams Activity's rows (hotspot 3) run in the same step.
- **Functions:** `useThreadIndex` (`src/app/threads/overview/useThreadIndex.ts:321`), its record map memo (`:560`) calling `buildThreadIndexRecordMaps` (`threads/overview/threadIndexRecords.ts:52`), `buildThreadRecordMap` and `buildThreadRecord` (`event-store/threads/threadRecord.ts:479`, `:315`), which on main before the fix ran for every thread root; inside each record `resolveThreadPresentationSnapshot` (`event-store/threads/threadPresentation.ts:103`), `getThreadEventReadUpTo` (`event-store/threads/threadEventReadUpTo.ts:40`), `getBundledThreadPreviews` (`event-store/threads/threadBundledPreviews.ts:10`), `isEventStreaming` (`event-store/threads/useThreadStreamingState.ts:98`); and the unread map of `useRoomThreadList` (`threads/overview/useRoomThreadList.ts:274`, `getRoomThreadsUnread`), about 8 % / 6 % of the Compact window (not part of the fix).
- **Load that drives it:** `useThreadOverviewRefreshCounter` (`threads/overview/threadOverviewRefreshCounter.ts:84`) adds one for every timeline event, receipt and thread update of the room, and the memo depends on it, so on main before the fix each durable edit, jobs state write or receipt rebuilt the records of all 520 threads: 22 commits a second at 50 streams, about 16 ms of index each on gce-dev. The cost is (events a second) times (threads in the room); resolved threads count although the Compact view leaves them out.
- **Budget it blocks:** Compact busy and long frames, scroll frame p95, the 200 ms back step (which misses at every level).
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,compact-scroll,switch`; `metrics.busy` and `frames.p95` of `compact-idle` and `compact-scroll`, `timings.back-*` of `switch` (`PERF_STREAMS=7` is enough for the back step); inclusive time of `useThreadIndex.ts:321` (`:318` on main before #434). A fix that rebuilds only the threads an event touches should bring the share at 50 streams near the 7-stream one.

### 2. Read receipts are looked up through every thread of the room

- **Addressed:** #434 and #459, with #417. The room knows which event IDs its threads hold (#417, in the SDK patch), so `Room.findEventById` returns at once for an event no thread holds instead of asking every thread. #434 had added its own record of the IDs a room did not hold to `receiptReadTs.ts`, and #459 removed it once #417 made it a second owner of that answer; what stays of #434 is `receiptEventsVersion(room)`, the count the kept thread records compare. #434's paired run, gce-dev, 1x: `receiptReadTs` 24.8 % to 1 % of the Compact window at 50 streams, 19.0 % to 0.7 % of the open-thread window.
- **Scenario:** every scenario; it is the largest leaf inside hotspots 1 and 3.
- **Share:** Compact 24 % / 17 %, thread 15.5 % / 7.5 %, typing 15 % / 7 %, at 4x in the open thread 25 % / 19 %. Of it, in the Compact window: 14.7 % under the thread index, 9.4 % under Activity's rows. Production copy, Compact, 7 streams: 16 % of the main thread; `Room.getThreads` alone was the top self time (13 %).
- **Functions:** `receiptReadTs` (`src/app/matrix/receiptReadTs.ts:113`), called by `seenReceiptReadTs` (`:135`), `unthreadedReceiptReadTs` (`:154`), `contextReceiptReadTs` (`:172`), `getMainTimelineReadTs` (`matrix/mainTimelineRead.ts:14`) and `getThreadReadState` (`event-store/threads/roomThreadList.ts:47`). It calls `context.findEventById` and then `Room.findEventById` (`matrix-js-sdk/lib/models/room.js:1284`), which on main before #417 copied the thread list for an event the client does not hold (`Room.getThreads`, `room.js:1676`) and asked every thread (`Thread.findEventById`, `EventTimelineSet.getTimelineForEvent`, `event-timeline-set.js:280`). The two were the top self times of the Compact window: `Room.getThreads` 4.7 % / 3.7 %, `EventTimelineSet.getTimelineForEvent` 13.9 % / 6.7 %.
- **Load that drives it:** a receipt on an event outside what the client loaded (the person's unthreaded receipt from early in the history, a thread receipt on a reply's last edit) misses in every lookup, and one miss costs one probe per thread; the callers ask once per thread and per receipt type, so a rebuild costs about (threads) squared probes. It grows with the room's thread count, not with the streams.
- **Budget it blocks:** Compact busy, open-thread busy, typing p95 at 4x.
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,thread-idle,thread-type`; `metrics.busy` of both idle scenarios; inclusive time of `receiptReadTs.ts:113` (`:64` on main before #434) and self time of `event-timeline-set.js:280` and `room.js:1676` (`:245` and `:1649` before #417) should fall to near zero (a read time remembered per receipt, or a lookup that does not scan the threads).

### 3. Activity's rows are rebuilt app-wide a few times a second

- **Scenario:** every scenario; it is the largest entry while a thread is open.
- **Share:** thread 21 % / 12 %, typing 21 % / 12 %, open 20 % / 14 %, Compact 13 % / 9 %; at 4x in the open thread 35 % / 29 %. Without the receipt lookups of hotspot 2 inside it: 6 % / 5 % in the open thread. Production copy, open thread, 7 streams: 3.8 % of the main thread, 16 % of what was busy, the top entry of the app's own code.
- **Functions:** `ActivityRowsFeature` (`src/app/activity/ActivityRowsFeature.tsx:69`, the profile's frame; mounted once for the session), its hook `useComputedActivityRows` (`:30`) and the hook's memo (`:49`), `buildActivityRows` (`activity/activityRows.ts:95`), the `read` of `createThreadSignalsReader` (`threads/cross-room/threadSignalsReader.ts:32`), `readThreadSignals` (`threads/cross-room/threadSignals.ts:282`), which reads each thread's newest messages with `getThreadReadState` and `isReplyUnread`.
- **Load that drives it:** the memo ran 7.3 times a second in the open thread at 50 streams on gce-dev (30 ms each), 5.4 on the M5 (25 ms each), 4.1 in the Compact view and 1.8 at 7 streams (runs of profile samples under the memo). What starts it, by timing in the same profiles: 69 to 81 % of the runs begin within 30 ms after a flush of the cross-room thread index (`flushNow` of `createCrossRoomThreadDirtyCoalescer`, `threads/cross-room/crossRoomThreadIndex.ts:670`; `useCrossRoomThreadIndex.ts:251` then sets a new index, the memo's `index` dependency), which happens 3.4 to 4.3 times a second at 50 streams (it is spaced 200 ms apart, `FLUSH_INTERVAL_MS`); 4 to 19 % begin only after an unread update of the room (`roomToUnread.ts:235`; `roomToUnreadAtom` changes only when a count does, as a new reply to the test account can make it); up to 20 % follow neither within 30 ms. This is a reading of sample times in four profiles (open thread at 50 streams on both machines, Compact at 50 and open thread at 7 on gce-dev), not an instrumented count: it says the index is the main trigger, not how often the unread atom really changed. Each run then reads every thread of the room again, not only the flushed ones: the reader's cache key holds the room's change count (`threadSignalsReader.ts:36`), so a cached thread is good only until the room hears its next event.
- **Budget it blocks:** open-thread busy and long frames, typing p95 at 4x, Compact busy.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type,compact-idle`; `metrics.busy` of `thread-idle`, `inputs.p95` of `thread-type` at 4x; inclusive time of `ActivityRowsFeature.tsx:69`. The fix thread instruments the trigger first: the runs said to follow a flush (69 to 81 % of 7.3 a second, so 5.0 to 5.9 a second) outnumber the 3.4 to 4.3 flushes a second, so the sample timing above does not settle what starts them.

### 4. The heap that stays grows with the streams

- **Addressed in part:** #466 removed the one leak found: `MatrixEvent.setThread` made each event re-emit its thread's `ThreadEvent.Update`, which registered a listener on the thread per event instance that nothing removed, so a thread kept every copy of every reply and streamed edit it was given (the SDK patch drops the re-emit). On gce-dev, 10 minutes at 50 streams, base against head: 14.9 to 11.1 MB a minute from minute 2 (233 to 197 MB at minute 10). The room's threads together held 6,403 of these SDK emitter listeners at minute 2 and 12,238 at minute 10 (up to 330 on one thread). The 7-stream soak grows 3.6 MB a minute with #466 (the baseline's own run read 7). What is left is the SDK keeping the events of a loaded timeline (the room's live timeline with the jobs state events first, thread timelines with every streamed edit, the relation sets) and capped caches: main grew 15.7 MB a minute against the budget's 2.5. It waits on a decision about what a room keeps in memory while it streams.
- **Scenario:** `soak` (60 s Compact and 60 s thread in turn).
- **Evidence:** the soak table above; after forced collections 18 MB a minute at 50 streams and 7 MB at 7 (before #466). DOM nodes did not grow. A sampling heap profile of the 10-minute run at 50 streams (259 MB live) put 113 MB of the allocations still alive on no script frame (values the browser made: parsed sync answers, IndexedDB results).
- **Load that drives it:** durable edits and jobs state writes (10 a second at 50 streams). After #466 what holds the growth is the SDK's loaded timelines and capped caches (see the entry's first line).
- **Budget it blocks:** heap growth under 50 MB in 20 minutes.
- **Measure a fix:** `PERF_SOAK=1 PERF_SOAK_GC=1 PERF_SCENARIOS=none PERF_STREAMS=50 PERF_CPU_THROTTLE=1` (20 minutes; `PERF_SOAK_MINUTES` shortens it). `PERF_SOAK_GC=1` (commit `2ad051148`) makes the probe force a collection before each of the soak's samples, every 5 s, so the result's `series` and the spec's own check (the last sample against the first, 50 MB) hold the heap that stays; without it the check counts garbage that a busy main thread has not collected yet. Reference on this commit's app code, 10 minutes at 50 streams on gce-dev: 59 MB at the start, 156 MB after the first minute, 300 MB after the tenth (16 MB a minute after the room has loaded); compare the samples at the same minutes, since the first minute holds the room's loading. First step of the fix thread: sampling heap profiles (`HeapProfiler.startSampling`, `getSamplingProfile`) at minute 2 and minute 10, and their difference; the spec has no knob for that.

### 5. The jobs strip reads every agent reply again for each event

- **Addressed:** #439. One effect keeps each conversation (a thread, or the main timeline) as it last read it, and an event reads again only the conversation it names; an event of a conversation without a job reads nothing. The question this entry left open is answered there: scrolling does not refresh more often, each refresh costs 4 times more, because the cards that scroll into view load their threads' history and each job's tail then holds more replies with their edits attached (a refresh read 2.7 times the replies and resolved 9 times the edits).
- **Scenario:** Compact view, most of all while scrolling and during a reload.
- **Share:** scrolling 16.5 % / 14.5 %, `cold-load` 27 % / 16 %, Compact 6.7 % / 6.8 %; at 4x scrolling 36 % / 40 %, Compact 21 % / 16 %. On gce-dev at 7, 25 and 50 streams: Compact 2.7, 4.6 and 6.7 %, scrolling 2.6, 7.9 and 16.5 %, `cold-load` 4.7, 12.7 and 27.4 %, while the room carried 1.5, 5.5 and 10.1 durable events a second (edits and jobs state writes): while scrolling and reloading the share grows about with the events (6 times for 7 times the events), in the idle Compact view more slowly (2.5 times).
- **Functions:** `useJobRepliesStreaming` (`src/app/background-jobs/useJobRepliesStreaming.ts`): `refresh` (`:114`) calls `read` (`:48`) and `repliesOf` (`:36`), which for a conversation with jobs takes the thread's tail and asks `isEventStreaming` (`event-store/threads/useThreadStreamingState.ts:98`) for each reply; under it `getEditedEvent` and `getEditCandidates` (`matrix/room.ts:458`, `:426`), `getShallowSerializedReplacementEvent` (`matrix/editEvent.ts:64`) and the metadata copy of `copyResolvedEditMetadata` (`matrix/protocol/editMetadata.ts:9`) (11 % / 10.5 % and 5 % / 3 % of the scroll window before the fix, shared with hotspot 1).
- **Load that drives it:** on main before #439 `refresh` listened to `RoomEvent.Timeline`, `ThreadEvent.Update` and `ThreadEvent.NewReply` of the room, and each call walked the threads of all running jobs: 115 refreshes a second in the idle Compact window at 50 streams (8 % from a thread with a job) and 87 a second while scrolling (63 %). A refresh cost 0.5 ms when idle and 2.0 ms while scrolling, for the reason in the entry's first line.
- **Budget it blocks:** scroll frame p95, Compact busy, and the time to a usable room after a reload.
- **Measure a fix:** `PERF_SCENARIOS=compact-idle,compact-scroll,cold-load`; `frames.p95` of `compact-scroll`, `timings.cold-load`; inclusive time of `useJobRepliesStreaming.ts:114` (`:96` on main before #439).

### 6. Server: one sender may send 30 live frames a second to a room

- **Addressed:** mindroom-tuwunel#167, released as v1.9.4-mindroom.47. `RATE_LIMIT` is 600 events per sender, room and window (1 s), which covers 50 replies at 10 frames a second and the runtime's sub-agent frames; the room's buffer holds 4,096 events and 4 MiB (`MAX_EVENTS`, `MAX_BYTES`, was 256 and 1 MiB), so a sync up to 5 s behind still finds every frame. The test homeserver of `e2e/docker-compose.yaml` keeps the 30-frame cap until its image pin is raised to that release or a later one; the numbers below are from the capped server.
- **Where:** MindRoom's Tuwunel (`mindroom-tuwunel`), `src/service/rooms/ephemeral/mod.rs`: `RATE_LIMIT` was 30 events per sender, room and window; `src/api/client/ephemeral.rs` answers the rest with 429 "Too many ephemeral events in this room.".
- **Evidence:** with one agent the driver's sync saw 27 frames a second at 25 streams and 30 at 50 (150 in nearly every 5 s report, never more than 33 a second), on gce-dev and on the M5 alike; with 17 agents 47 a second and up to 77. The backend sends a frame every 100 ms per reply whose text changes, so one agent passes the cap at 4 replies that stream text at once.
- **What the person sees:** past the cap the server answers 429 and nio retries each send with the same transaction ID, so no frame is lost (mindroom-tuwunel#167 measured this; the baseline had read the cap as dropped frames), but every reply's frames queue behind the window: with one agent streaming 50 replies each reply moved about once a second (0.8 s at the median, 5 s at p95), and a third of the frames became snapshots because their sends waited past the runtime's 5 s timeout, so text comes in jumps of up to 5 s. Bas's agent rooms have one agent each.
- **Budget it blocks:** none of the main-thread budgets (it lowers the client's load), but "everything just works" at 50 threads; and until it is fixed the client cannot be measured past 30 frames a second with one agent. The 17-agent profile stands in.
- **Measure a fix:** the driver's `framesPerSecond` (each result's `achieved`) at `PERF_STREAMS=50` with `real-work-50.json` should pass 30 a second and reach what the 17-agent profile carries; then every client number of this baseline at 25 and 50 streams must be taken again, because the client's load rises.

### 7. Opening a heavy thread renders all of it (production copy; the synthetic load understates it)

- **Scenario:** the thread step of `switch`, and `thread-open`. The back step of `switch` is hotspot 1.
- **Evidence:** production copy, nothing streaming, M5, 3 runs: the next thread's first rows after 739 ms (median of 15 steps, 123 to 787 ms) against the budget's 200 ms; the first open from the top card 101 to 112 ms. Synthetic, M5: 124 to 177 ms and 134 to 173 ms. How much the synthetic thread understates depends on the measure: 2 to 2.7 times by the main-thread time of the `switch` and `thread-open` windows (the calibration's ratios, 0.48 and 0.37), 4 to 6 times by the time to the next thread's rows, and 20 to 200 times by DOM nodes (39,000 after the open and 187,000 to 324,000 after five switches in the copy; 1,500 to 1,900 attached in an open synthetic thread).
- **Functions, production copy, `thread-open` window** (5.5 s, 47 % busy; share of the main thread, median of 3 profiles): the crypto machine's sync handling 6.7 % (hotspot 11), the event cache 4.5 %, React's commit work outside any app frame 4.3 %, message components (`src/app/messages/`) 3.5 %, of which `RenderBody` (`messages/content/RenderBody.tsx:84`) 1.6 % with `html-react-parser` and `html-dom-parser` 1.3 % and the parser options' `replace` callback (`messages/html/react-custom-html-parser.tsx:637`) 1.0 %; the scroll ledger (`timeline/timelineScrollLedgerController.ts`) 1.7 %; `getEditedEvent` and `getEditCandidates` (`matrix/room.ts:458`, `:426`) 1.4 %; the cross-room index flush (`threads/cross-room/useCrossRoomThreadIndex.ts:251`) 1.4 %; the minimap's previews (`timeline/useRoomTimelineMinimap.ts:15`) 0.9 %; forced layout reads (`offsetHeight` and the like) 0.7 %; the `measure` callback of `UrlPreviewCard` (`messages/url-preview/UrlPreviewCard.tsx:162`, run from its layout effect at `:186`; it reads `clientWidth`, `scrollWidth` and `getComputedStyle`) 0.5 %; `scaleEmoji` (`react-custom-html-parser.tsx:78`) 0.4 %; `isContentOverflowing` (`timeline/CollapsibleMessage.tsx:97`) 0.1 %. This open is within its budget, and no one function stands out in it.
- **Functions, production copy, `switch` window** (11.3 s, 68 % busy, five thread steps and five back steps; median of 3 profiles), the thread step's part: message components 12.0 %, of which `RenderBody` 6.4 % (the parser packages 5.3 %, the `replace` callback at `:637` 4.3 %, `renderTextWithLatex` at `:127` 3.9 %, `renderTextWithMatrixMath` at `rich-text/matrixMath.tsx:67` 3.7 %, `scaleEmoji` at `:78` 2.4 % self, `linkify` 2.3 %, `createInsideUrlTest` at `lib/regex.ts:41` 1.0 % self); React's commit work outside any app frame 6.9 %; the scroll ledger 3.3 %; `isContentOverflowing` (`CollapsibleMessage.tsx:97`, called from `checkOverflow` at `:237`) 2.9 % self, with `offsetHeight` reads 2.5 %; `UrlPreviewCard`'s `measure` 0.9 %. Together at most 28 % of the window, about 630 ms per thread step. The rest of the window is the back step: the thread index 9.7 % and the thread list's root revisions (hotspot 9) 3.0 %.
- **Load that drives it:** the thread step renders every loaded reply of the thread at once, and real replies are long (bodies up to 3,400 lines, tool blocks): each body is parsed to HTML and walked, each collapsible message is measured.
- **Budget it blocks:** the next thread within 200 ms; open within 300 ms at 4x (synthetic: 609 to 860 ms on the M5).
- **Measure a fix:** not with the synthetic load. Prerequisite: the spec's external mode against the production copy, on the M5 only (private data; never on gce-dev or the work MacBook), with the copy's homeserver on the loopback interface and the room, user and password read from the private directory at run time: `PERF_REAL_WORK=1 PERF_TARGET=external PERF_HOMESERVER=http://127.0.0.1:<port> PERF_USERNAME=<user> PERF_PASSWORD=<password> PERF_ROOM=<room id> PERF_CPU_THROTTLE=1 PERF_PROFILE=1 PERF_SCENARIOS=thread-open,switch npx playwright test e2e/perf/real-work.live.spec.ts`, 3 runs of base and fix against one build each; then `timings.switch-*` and `timings.open` with `compare.mjs`, and the inclusive time of `RenderBody.tsx:84` and the self time of `CollapsibleMessage.tsx:97`. `matrix.sh` refuses these variables on purpose. External mode guards the browser only (Chromium, which it requires): it does not stop the copy homeserver's own outbound traffic (URL previews, federation), which the copy's configuration has to keep off.

### 8. The event cache scans the room for every redaction, and copies events to save them

- **Addressed:** #451 (the scan). Cache schema v7 keeps an `embedded_events` store of keys (`[roomId, embeddedEventId, ownerKind, ownerKey]` for each row that embeds an event) and an index of the thread summaries over `[roomId, eventId]`, so a redaction's repair finds the rows that hold the event by key and the work follows the redaction, not the room's size. A room whose rows an earlier schema wrote is read whole once, on its first redaction, which lists its rows for the next time. #451's paired runs on gce-dev at 50 streams, 1x, self time of the cache redaction paths: thread-idle 2,565 ms (8.44 % of the window) and 1,761 ms (5.79 %) on main against 3.8 and 2.8 ms; thread-typing 514 ms (4.51 %) and 533 ms (4.90 %) against 0.5 and 0.8 ms. A probe with the real cache code (100,000 rows, a 10,000-row room): later redactions took 900 to 972 ms before and 1.5 to 2 ms after. The copies `serializeEventsForCache` makes to save events are not part of it.
- **Scenario:** open thread at 25 and 50 streams, thread open, `switch`.
- **Share:** cache callbacks that run outside every other entry here: thread 14 % / 8 %, open 10 % / 16.5 %, typing 10 % / 7 %, `switch` 6 % / 11 %, Compact 4 % / 7 %.
- **Functions:** the IndexedDB cursors of `runScrubRedactedRelationsTxn` (`src/app/event-store/cache/db/cacheStoreEvents.ts:292`; on main before #451 the profile's frames were its `onsuccess` callbacks, all cached events of the room and all its meta rows, 4.6 % and 4.4 % self time of the thread window on gce-dev; the two cursors that remain are in `repairEveryRow`, `:415`, for a room whose rows an earlier schema wrote), called from `saveRoomEventsToCacheCommitted` (`:824`) and `saveThreadEventsToCacheCommitted` (`:1445`); the cursor of `deleteThreadEventFromCacheByEventId` (`:1754`, 2 % on the M5, now over the event's own copies by `by_room_event`); `scheduleEventPutsWithLedger` (`:927`); and `serializeEventsForCache` (`event-store/cache/eventCacheEditUtils.ts:405`).
- **Load that drives it:** every reply that ends redacts its stop reaction; a save that carries a redaction walks every cached event and meta row of the room (11,000 events and more). It grows with (replies ending a second) times (events in the room).
- **Budget it blocks:** open-thread busy, typing p95.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type,thread-open`; `metrics.busy` of `thread-idle`; self time of the `onsuccess` callbacks of `runScrubRedactedRelationsTxn` (`cacheStoreEvents.ts:319` and `:352` on main before #451, `:424` and `:438` of `repairEveryRow` now).

### 9. Listing the room's threads hashes every root again on each page

- **Addressed:** #438. Within one load of the list a page checks only the roots this load has not checked yet; when a load had more than one page, every root is checked once more as the load ends, as the overview is left in the middle of it, or after a failed load, so a change that lands on an already checked root meanwhile is still saved. A load of one page checks each root once, as before.
- **Scenario:** `cold-load`, and the first half minute of any Compact window after the room opens.
- **Share:** `cold-load` 13 to 26 % / 14 to 22 % over the levels; first Compact window 4.4 % / 2 %, at 4x 18 % / 9 %.
- **Functions:** `loadRoomThreadsOnce` (`src/app/event-store/threads/roomThreadList.ts:184`) calls its progress listener for each page of `/threads`; the listener in `useRoomThreadList` (`threads/overview/useRoomThreadList.ts`, `saveRoots` at `:147`) walks `room.getThreads()` and on main before #438 ran, for every root, `saveRoot` (`:124`) and `getRootRevision` (`:59`): `JSON.stringify` of `serializeThreadCacheEvents` and a string hash (`hashRevision`, `:46`). Of the load's time in the reload window the revision is 80 % on the M5 and 62 to 74 % on gce-dev.
- **Load that drives it:** (pages of the thread list) times (threads listed so far): 520 threads come in pages, and each page hashes all roots again.
- **Budget it blocks:** none directly (the reload has no budget), but it sits in the Compact window right after a room opens and delays the first usable frame at 4x.
- **Measure a fix:** `PERF_SCENARIOS=cold-load,compact-idle`; `timings.cold-load` and `metrics.busy` of `cold-load`; inclusive time of `useRoomThreadList.ts:59` (`:56` on main before #438).

### 10. The room's unread entry is recounted for every event

- **Addressed:** #435. A sync sets the unread counts of each thread one by one, each announced as `Room.UnreadNotifications`, and the count listener counted the room again for every one, so one sync cost (threads with counts) squared. The listener now marks the room and counts it once in a microtask after the burst; every other source (a timeline event, a receipt, a membership change) still counts at once and covers the waiting count. #435's paired run on gce-dev, 1x: the listener's inclusive time in the open-thread window at 50 streams 3,565 ms (11.7 %) to 22 ms (0.07 %). One count per sync, and one per live timeline event, still sums over the threads with counts (`Room.getUnreadNotificationCount`).
- **Scenario:** every scenario; relatively largest in the open thread at 7 and 25 streams.
- **Share:** thread 9.4 % / 4.7 % at 50 streams and 12.9 % at 25 on gce-dev; typing 7.9 % / 4.7 % (11.4 % at 7 on gce-dev); Compact 4.8 % / 3 %.
- **Functions:** the `update` listener of `roomToUnread` (`src/app/matrix/state/roomToUnread.ts:236`; `:229` and `:235` before #435) and `updateAfterCounts` (`:241`) call `getRoomUnreadAction` (`:167`), which reads `getUnreadInfo` (`matrix/room.ts:705`: twice `Room.getUnreadNotificationCount`, `matrix-js-sdk/lib/models/room.js:1340`, a sum over every thread's counts; 5.6 % self time in the thread window on gce-dev before the fix) and `roomHaveUnread`.
- **Load that drives it:** each timeline event and each count change of the room; one call sums over all threads with a count. Before #435 every count change of a sync's burst counted the room.
- **Budget it blocks:** open-thread busy at 7 and 25 streams.
- **Measure a fix:** `PERF_SCENARIOS=thread-idle,thread-type`; inclusive time of the count listener (`roomToUnread.ts:235` on main before #435; `updateAfterCounts` at `:241` with its deferred count at `:244` now).

### 11. The crypto machine handles every sync, in an unencrypted room

- **Scenario:** every scenario; it follows the number of syncs.
- **Share:** 2 to 4 % / 1.4 to 2.6 % with one agent (10 to 13 syncs a second); 5.5 to 10 % with 17 agents (17 to 21 syncs a second) on gce-dev, 7 % of the open-thread window.
- **Functions:** `matrix-js-sdk`'s sync (`lib/sync.js:1182`) hands each answer to the Rust crypto machine: `OlmMachine::receive_sync_changes`, `StoreTransaction::commit`, `Account::from_pickle`, and under it Curve25519 arithmetic (`EdwardsPoint::mul_base`) in `matrix_sdk_crypto_wasm`. About 3 ms per sync on gce-dev.
- **Load that drives it:** the sync rate; a sync without to-device messages or key counts still unpickles the account.
- **Budget it blocks:** a few points of busy in every scenario; more once the frame cap is lifted and syncs come faster.
- **Measure a fix:** `PERF_WORKLOAD=e2e/perf/workloads/real-work-50-agents.json PERF_SCENARIOS=thread-idle`; time under `matrix_sdk_crypto_wasm` (`--callers 'matrix_sdk_crypto_wasm'`).

### 12. A streaming reply's body is parsed again per frame (production copy; the synthetic load understates it)

- **Scenario:** open thread while its reply streams.
- **Share:** production copy, 7 streams from a private replayer, M5: `RenderBody` 2.7 % of the main thread, 12 % of what was busy, with `HTMLReactParser` under it (2.3 %); `linkify` (`linkifyjs`, 0.7 % self), `createInsideUrlTest` (`src/app/lib/regex.ts:41`, 0.7 % self) and `scaleEmoji` (`messages/html/react-custom-html-parser.tsx:78`, 0.4 % self) are among the top self times; the open thread stayed at about 22 % busy from 1 to 7 streams there. Synthetic, 50 streams: `RenderBody` 0.3 % / 0.3 %, all message components 3.5 % / 2.2 %: the stub's replies are a few paragraphs, real ones are line-heavy.
- **Functions:** `RenderBody` (`src/app/messages/content/RenderBody.tsx:84`, its parse memo at `:97`), `html-react-parser`, the parser options' `replace` callback (`src/app/messages/html/react-custom-html-parser.tsx:637`) and what it calls for each text node: `renderTextWithLatex` (`:127`), `renderStyledText` (`:101`), `scaleEmoji` (`:78`).
- **Load that drives it:** live frames of the open thread's reply (10 a second), each parsing the whole body so far.
- **Budget it blocks:** open-thread busy, by itself only with long replies.
- **Measure a fix:** not with the committed profiles, and not with external mode alone, which streams nothing. Prerequisite: the production copy on the M5 (private). External mode as in hotspot 7 measures the same parsing once per reply (`PERF_SCENARIOS=thread-open,switch`: `RenderBody` is 6.4 % of the copy's `switch` window), which is the part a cheaper parse improves; the per-frame part was measured with the first real-data baseline's replayer, which streams into the copy as the room's own agent and is kept private, not in the repository. A fix here shows as the inclusive time of `RenderBody.tsx:84` in both.

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

From a checkout that holds the commit, on a machine that reaches the runners. `<runner tool>` is the fleet's `remote-test.sh` (`matrix.sh` finds it itself, or takes it from `MRC_REMOTE_TEST`), `<keychain agent>` the SSH agent socket that holds the key the runners accept, `<private results dir>` a directory outside the repository. gce-dev slots 80 to 89 were used (check that a slot's ports are free), at most 8 jobs at once.

```bash
export SSH_AUTH_SOCK=<keychain agent>
H=$(git rev-parse HEAD); OUT=<private results dir>
# one job per level and run (3 runs: slots apart), and the 17-agent profile
for level in 7 25 50; do
  scripts/perf/real-work/matrix.sh $H $OUT/s$level gce:80,gce:81,gce:82 -- \
    PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=$level PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1
done
scripts/perf/real-work/matrix.sh $H $OUT/agents gce:80,gce:81,gce:82 -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50-agents.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1
# the soak, with the heap read after forced collections
scripts/perf/real-work/matrix.sh $H $OUT/soak gce:83 -- \
  PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=50 PERF_CPU_THROTTLE=1 \
  PERF_SOAK=1 PERF_SOAK_GC=1 PERF_SCENARIOS=none
```

A job takes about 22 minutes for one level at two throttles (11 of them the history), the soak 33. `matrix.sh` runs the three slots of one call at once; this baseline ran the levels at once as well.

On the M5 (on AC power; the fleet's machine check says so), through `<runner tool> m5 <commit> exec bash -c '...'`, with `E2E_MINDROOM_CHECKOUT` naming the backend clone and `E2E_SNAPSHOT_ROOT` and `E2E_AGENT_STACK_ROOT` in a directory of its own: `PERF_REAL_WORK=1 PERF_WORKLOAD=e2e/perf/workloads/real-work-50.json PERF_STREAMS=7,25,50 PERF_CPU_THROTTLE=1,4 PERF_PROFILE=1 scripts/e2e-slot.sh <n> --snapshot --preview npx playwright test e2e/perf/real-work.live.spec.ts --project=chromium`. One run of three levels takes 19 minutes after 7 minutes of history; use a commit with `fc38edcfe`.

Profiles: `cpuprofile-summary.mjs` needs a sourcemap build of the same commit (`--maps`) and the scripts of the served build (`--build`), which it uses to tell apart the chunks that share a name (four are called `index`). Positions only map when both builds hold the same code, so the sourcemap build is made the way the slot makes the served one, in a copy of the commit without `.git` (the release name in the bundle then is the package version in both), with the output directory inside the copy:

```bash
git archive $H | tar -x -C <copy> && ln -s "$PWD/node_modules" <copy>/node_modules
(cd <copy> && MINDROOM_BUILD_VERSION=$H npx vite build --sourcemap --outDir maps --emptyOutDir)
node scripts/perf/cpuprofile-summary.mjs $OUT/s50/gce-80/compact-idle-chromium-1x-50s.cpuprofile \
  --maps <copy>/maps --build $OUT/s50/gce-80/served-build --top 25
```

From commit `5bf6c74e3` `matrix.sh` leaves the served scripts in each run's results (`served-build/assets/`, about 13 MB). The summary warns on stderr when a chunk of the sourcemap build is not the served chunk plus its map comment, and when `--build` lacks a chunk that has several maps (its frames then stay minified). One warning is to be expected now and then: a build of this commit comes out in one of two forms at random (one dependency, dayjs, is wrapped eagerly or lazily), which are 75 bytes apart in the main chunk and move the positions after that module on two of its lines; build again until the warning is gone (in the check below the third build matched, in another try the sixth). Checked on gce-dev slot 89 with commit `2ad051148`: the run's results held `served-build`, and the committed tool mapped every frame of the Compact profile's summary (`--top 60`) with no warning; with a sourcemap build of the other form it warned and named one small function (`isRecord`, 0.7 % of the window) as its neighbour.

The runs of this baseline were made before that commit, when the served build went with the run's directory. Their summaries used sourcemap builds of both forms, each profile with the form its served main chunk matched (by the function names at the profile's positions; a private script). Where the two forms differ holds 0.7 % of the sampled time of the 50-stream profiles (`isRecord`, dayjs, a few others), none of it in a hotspot's functions. Those sourcemap builds were made in a checkout, so their release name is 18 bytes longer than the served one's: the code after it on that line holds 0.03 % of the sampled time (inclusive). The shares above come from those summaries.

## Limits

- gce-dev's Chromium is headless at 60 Hz with software rendering and a slower core than the M5; its absolute numbers are not the budget's, its shares and rankings match the M5's. The M5 has 2 profiled runs per cell, taken one after the other.
- The 17-agent room has 170 threads, so it understates the Compact view of a 520-thread room; it is used here only for the effect of more frames and more syncs.
- The synthetic thread view is lighter than the production copy's: 2 to 2.7 times by the main-thread time of the `thread-open` and `switch` windows, 4 to 6 times by the time to the next thread's rows, 20 to 200 times by DOM nodes (hotspots 7 and 12 say where that matters, and need the copy to be measured). Its Compact view, reload and typing match the copy within the calibration's factor of 1.5.
- A census reply streams text for a small part of its life, so at 7 streams the live load is bursty and a 30 s window varies from run to run (M5 Compact: 25 and 53 % busy).
- The live calibration did not pass with the committed profile. On the M5, the main-thread time per received event (live frames, edits and jobs state writes) was within the spec's factor of 2 of the production copy's replay in 1 of 4 cells with `real-work-census.json`: Compact at 7 streams (1.3); not Compact at 3 streams (6.0) or the open thread at 3 and 7 streams (11.4, 2.7). The same history with replies shaped like the replay's (2,700 words at 30 words a second, 2 one-second tool calls, no pause; a diagnostic variant, not committed) was within it in 4 of 4 cells (1.0 to 1.7). It was accepted for that reason: the census load delivers 1 to 13 events a second against the replay's 32 to 36, so at those rates the view's cost without events and the dearer durable events dominate the quotient, while with the replay's mix of events the cost per event matches. The cost of accepting it: the live absolute numbers above (busy shares, long frames) may understate real use. A fix measured before and after on the same load is not affected.
- The soak ran once at 20 minutes and once at 10 with forced collections, on gce-dev only.
- Eight jobs ran at once on gce-dev (load average about 15 on 96 vCPUs); the three runs of a cell agree within a few points of busy.
