# PLAN-claude — CINNY-126: agent reply never surfaced from room overview; everything "appeared" on thread entry

Planner: claude (one of two independent planners). Plan only — no code changes made.
Worktree: `/var/www/cinny-worktrees/cinny-126-plan-claude` @ `cinny-126-plan-claude` (base `dev`, HEAD `0b325652`).

## 0. What the traces establish (and what the build contains)

From `CINNY-126.md` + artifacts (`incident-window-all-events.json`, `edit-events-full.json`,
`incident-core-events.json`), verified directly:

- Placeholder `$-VHwjN4o…`: `m.room.message`, `msgtype:m.text`, body `"Thinking..."`,
  `io.mindroom.stream_status:pending`, `m.thread` rel to root `$hEwF5iZBgs…` + reply-to the voice message.
- 16 streaming edits: `rel_type:m.replace` targeting the placeholder, `msgtype:m.notice` (outer **and**
  `m.new_content`), `stream_status:streaming`, bodies 4→1466 chars, bursts ~160 ms apart, 14:02:35–14:02:44.
- Final edit `$bRI9J8GUw…`: `msgtype:m.text`, `stream_status:completed`, 1466 chars, 14:02:44.935.
- Tags: `com.mindroom.thread.tags` **room state events** (14:02:48/49). Summary: in-thread `m.notice`
  with `io.mindroom.thread_summary` (14:02:50).
- User sat on the room overview 14:02:20→14:06:15 (foreground), saw nothing; at ~14:06 he entered the
  thread and tags/summary "appeared". He then sent "well?" **from inside the thread** — so the reply body
  was not visible even on thread entry, until some later trigger.

Build ancestry (verified with `git merge-base --is-ancestor`): build `64c7773f` **contains** the
CINNY-122 fix (`08118f7b`), CINNY-121 (`960a4149`), and the CINNY-124 flight recorder (`8e910aa4`).
CINNY-122's diff touched only `useThreadRenderState.ts`, `threadOpenSdkBootstrap.ts`,
`crossRoomThreadIndex.ts`, `ThreadsView.tsx` — the **local-echo, zero-reply-thread-view** path. It never
covered remote placeholder+`m.replace` streams received while outside the thread. CINNY-126 is a sibling
bug in a different lane, not a regression of CINNY-122.

Key structural fact for every hypothesis below: **the user-visible content only ever exists in
`m.replace` edits.** Any surface that fails to resolve/aggregate edits renders "Thinking..." or nothing,
forever. The fork already carries two band-aids proving this failure class recurs:
`hasLikelyIncompleteStreamingBody` (string-matches "Thinking...", `src/app/mindroom/threads/threadEditBackfill.ts:8`)
and the `/relations` edit backfill it gates.

## 1. Deliverable 0 — deterministic exact-trace replay repro

### 1.1 Replay engine

New script `scripts/replay-cinny126.mjs` (node ≥20, no new deps — raw `fetch` against the CS API, same
style as `e2e/helpers/matrix.ts`). It replays the **exact wire JSON** from the artifacts:

- Input: path to `edit-events-full.json` + `incident-core-events.json` + `incident-window-all-events.json`
  (commit sanitized copies as fixtures, see §5.3). CLI: `--homeserver`, `--token` (or user/pass login),
  `--room`, `--speed exact|fast`, `--skip-tags`, `--thread <existing-root>|new`.
- Sequence (event ids cannot be reused, so the script maintains an old-id→new-id map and rewrites
  `m.relates_to.event_id` / `m.in_reply_to` accordingly):
  1. Root stand-in: an `m.text` message (or reuse `--thread` root) → maps `$hEwF5iZBgs…`.
  2. Voice stand-in: `m.text` copy of the transcription event (audio upload not needed to reproduce —
     the reply chain hangs off the thread rel, not the audio itself) → maps `$IplaneGRjG…`.
  3. Placeholder: verbatim content of `$-VHwjN4o…` (msgtype `m.text`, body "Thinking...",
     `io.mindroom.stream_status: pending`, thread rel) → maps to new id P.
  4. The 17 edits, verbatim contents with `m.relates_to.event_id` rewritten to P, preserving the
     msgtype flips (`m.notice` ×16 → `m.text` final) and `stream_status` transitions.
  5. Tags: the two `com.mindroom.thread.tags` state events (state_key rewritten to the new root id);
     summary: the `io.mindroom.thread_summary` `m.notice` into the thread.
- Timing: `--speed exact` sleeps the recorded `origin_server_ts` deltas (placeholder → +14.8 s → edit
  bursts ~160 ms apart with the recorded 1–2 s gaps → final at +9.5 s → tags +3.2 s → summary +5.2 s).
  `--speed fast` compresses gaps to 100 ms for iteration. Exact mode is the regression-evidence mode.
- Sender account: a second test account (`scripts/ensure-e2e-account.sh` / `create-mindroom-e2e-account.sh`
  already provision these), NOT the client-under-test account — matching the incident (agent ≠ user).

### 1.2 Desktop harness (automated, the primary regression artifact)

New Playwright spec `e2e/live/cinny126-overview-stream-replay.spec.ts` against the existing docker
homeserver (`npm run e2e:matrix:up`, image `ghcr.io/mindroom-ai/mindroom-tuwunel` — the **same Tuwunel
family as mindroom.chat**, so server-side aggregation/notification behavior matches production; this
matters for `unsigned.m.relations` bundles and MSC3773 thread unread counts). The spec imports the replay
engine as a module (export a `replayCinny126Trace()` from the script) rather than shelling out.

Scenario matrix — each row is a separate test; the variants discriminate the hypotheses in §2:

| Variant | Client state when replay starts |
|---|---|
| A. warm-thread | Thread opened once this session, then exited to the in-room compact overview |
| B. fresh-session | Page reloaded after thread has history; thread NEVER opened this session; parked on in-room compact overview |
| C. room-list | Parked on the home/space room list (room not open at all) |
| D. slow-init | Same as B, but Playwright `page.route()` delays the first thread `/messages`+`/relations` pagination by 20 s (aborting one attempt) — models iOS network flake during SDK thread initialization |

Pass/fail observations (each an explicit `expect` with a deadline; all four must pass in A–C; D defines
the acceptable degraded behavior — final content must still appear, late, without user action):

1. **Overview preview**: the thread card's preview text becomes the final 1466-char body (assert on its
   first 80 chars) within 5 s of the final edit, with **no navigation and no reload**.
2. **Badge**: the room's unread badge increments within 5 s of the placeholder (it is `m.text` → thread
   notification; the streaming `m.notice` edits must NOT be required for this). Record actual Tuwunel
   MSC3773 behavior on first run and pin the spec to it.
3. **Tags + summary**: tag chips and the summary line on the thread card update within 5 s of their
   events while still on the overview.
4. **Thread entry without refresh**: after the final edit, click into the thread — the full final body
   is visible within 2 s, with no "Thinking..." remnant and no page refresh. Also assert the entry
   painted from local state: no `/relations` repair fetch was needed (Playwright request log).

Also capture, on failure, the diagnostic signature (see §2.6) so a red run localizes the hypothesis
automatically.

### 1.3 iOS capacitor leg

- Simulator (scripted, close to CI-able): `npm run e2e:matrix:up` → `scripts/seed-ios-sim-session.sh
  --restore-path room` (seeds a logged-in session against `http://127.0.0.1:28008` and lands on the room
  route) → `npm run ios:phone` build → run `scripts/replay-cinny126.mjs --homeserver http://127.0.0.1:28008`
  → observe the same four checks manually / via `xcrun simctl io booted recordVideo`. The Web Inspector
  (Safari → simulator) gives the console + network view for the §2.6 signature.
- Physical device against production: point the replay script at `https://mindroom.chat` with a dedicated
  test account and a test room the device account is joined to; device parked on room overview. This is
  the only leg that exercises real WKWebView scheduling; the flight-recorder extension (§4) is the
  evidence channel here.

## 2. Root-cause investigation path

I verified the code paths below by reading this worktree. Ranked hypotheses; the repro matrix (§1.2)
discriminates them.

### H1 (primary): js-sdk thread pre-init edit buffering — edits invisible to every listener

`matrix-js-sdk@41.7.0` (pinned; only patch is `@tanstack/virtual-core`):

- `Thread.addEvent` (`node_modules/matrix-js-sdk/src/models/thread.ts:363`): `m.replace` relations are
  diverted to `addRelatedThreadEvent` and **return early** — never added to any timeline.
- `addRelatedThreadEvent` (`thread.ts:419`): if `!initialEventsFetched` (thread not opened this session),
  the edit is only pushed to `replayEvents`. Annotations get special pre-init aggregation; **edits do
  not** (the code comment even says "we might loose annotation or edits").
- Consequences while the user sits outside the thread: no `RoomEvent.Timeline` fires for any of the 17
  edits → `placeholder.replacingEvent()` stays undefined → nothing aggregates, nothing repaints, and the
  fork's app-wide sync engine (`src/app/mindroom/engine/mindroomSyncEngine.ts:196` — its write-through
  is fed exclusively by `mx.on(RoomEvent.Timeline)`) **never persists the edits to the event cache**.
- Self-heal timing: `updateThreadMetadata` (`thread.ts:600`) lazily initializes the thread on first live
  activity (pagination → `initialEventsFetched = true` → replay buffered edits → `ThreadEvent.Update`).
  Two documented traps make the buffer permanent instead of transient:
  1. **Stranded rejected promise**: on pagination failure the `catch` (`thread.ts:648`) resets
     `initialEventsFetched = false` but leaves `initalEventFetchProm` set to the **rejected** promise;
     every subsequent `updateThreadMetadata` awaits it at `thread.ts:610` and re-throws — initialization
     is never retried, `replayEvents` never drains, the error is swallowed by callers. One transient
     network error on iOS at 14:02:20 (placeholder arrival triggers init) permanently eats all 17 edits
     for the session. This matches "nothing on overview AND nothing on thread entry until a later
     trigger" exactly.
  2. **Reset-before-paginate race** (`thread.ts:614-622`): `resetLiveTimeline()` runs before the async
     pagination completes; events arriving in that window can be dropped.
- Verification: variant B vs A (pre-init vs initialized thread) and variant D (forced init failure).
  Instrument via §2.6.

### H2: overview surfaces don't repaint on thread-edit activity even when the SDK aggregates

Even post-init (variant A), the in-room compact overview's live repaint is gated:

- `src/app/mindroom/threads/roomLiveRenderController.ts:271-288`: for a live thread-attributed event
  (`threadOnlyRoomActivity`), the room view only does `setTimeline({...ct})` **`if (atBottomRef.current)`**.
  Scrolled up on the overview (or a stale ref) → no repaint; preview text stays stale until some other
  state change. Verify by scroll position variants in the spec.
- `useThreadOverviewRefreshCounter` (`src/app/mindroom/threads/threadOverviewRefreshCounter.ts:16`)
  does listen to `ThreadEvent.Update` (which fires per edit batch post-init via
  `Thread.updateThreadMetadata`, `thread.ts:655`) — but under H1 pre-init, `ThreadEvent.Update` fires
  while `replacingEvent()` is still undefined, so a recompute yields the same stale text; and
  `pickPreferredThreadRootPreviewText` (`compactThreadRootData.ts:197`) then deliberately prefers the
  stale fallback because "Thinking..." matches `hasLikelyIncompleteStreamingBody`. Net effect: refresh
  fires, preview doesn't change — indistinguishable from "no update" for the user.
- Preview resolution itself is correct when aggregation happened:
  `getCompactThreadRootPreviewInfo` (`compactThreadRootData.ts:92`) uses `event.replacingEvent()` /
  `getEditedEvent(...)`. No `m.notice` filtering exists in the preview path (checked: the only notice
  filter near previews is `isZeroReplyStandaloneThreadRootEvent`, `compactThreadRootData.ts:68,77`,
  which excludes notice **roots** from the zero-reply card path — not applicable to this thread, which
  has a real root and replies).

### H3: unread badge path (expected-by-design gaps, verify not regressed)

- Client-side bump: `src/app/state/room/roomToUnread.ts:296-312` requires `isNotificationEvent`, and
  `src/app/utils/room.ts:214` returns false for every `m.replace` → the 17 edits can never bump the
  badge (also suppressed server-side by default push rules). The **placeholder** (`m.text`) is the one
  event that should produce exactly one thread notification at 14:02:20. Verify in the repro: whether
  Tuwunel emits MSC3773 `unread_thread_notifications` (the startup filter requests it,
  `src/client/initMatrix.ts:295`) and whether `Room.getUnreadNotificationCount` (includes
  `threadNotifications`, js-sdk `room.ts:1530`) reaches the badge. If the placeholder produces no badge
  even on desktop, that is a separate (small) finding to record — but it is not the core "no content"
  bug.

### H4: cache-first thread entry paints stale placeholder

Thread entry paints from the fork's event cache + SDK seeds
(`getLoadedThreadModelSeedEvents`, `src/app/mindroom/threads/threadBootstrap.ts:138`;
`threadOpenSeedCache`; `eventRepository`). Under H1 the cache never received the edits (write-through
starved), so first paint shows "Thinking..." (or hides the pending placeholder), and recovery depends on
the `/relations` edit backfill (`shouldFetchThreadEditBackfill`, `threadEditBackfill.ts:31`) which
requires `threadTailLoaded` and the "Thinking..." heuristic. Instrument in variant B/D: did entry paint
rely on network repair (fail per observation 4), and did the repair itself race `threadTailLoaded=false`.

### H5: iOS-only sync stall

Tags are room **state** events consumed from `room.currentState`
(`useThreadTags` → `useStateEvents`, `src/app/mindroom/threads/useThreadTags.ts:56`) — their instant
appearance on click-in implies sync HAD processed them by then, which argues against a total 4-minute
sync stall and for the per-surface failures above. But it cannot retroactively exclude a WKWebView
throttle window (14:02–14:05) that resumed before he clicked. The flight-recorder sync event (§4) exists
to settle this class on the next real occurrence; the simulator leg (§1.3) checks the obvious cases.

### 2.6 Instrumentation for the repro runs (temporary, not shipped)

Dev-only monkeypatch installed by the spec (via `page.addInitScript` / a debug flag consumed in
`initMatrix.ts`): wrap `Thread.prototype.addEvent`, `updateThreadMetadata`'s catch, and the engine's
`handleTimelineEvent` to `console.info` a compact tuple
`(eventId, rel_type, initialEventsFetched, routedTo)`. The spec asserts on the console stream to emit a
one-line verdict: `H1-preinit-buffered` / `H1-init-failed-stranded` / `H2-no-repaint` /
`H4-stale-cache-entry` / `clean`. This turns one red run into a localized diagnosis instead of a rerun
loop.

## 3. Fix shape (smallest root-cause diff; final selection contingent on §1 verdict)

### If H1 confirmed (expected) — fix at the SDK boundary via `patch-package`

The repo already runs `patch-package` on postinstall (`patches/`), so a surgical, upstreamable js-sdk
patch is the established mechanism. Two independent ~5-line changes in
`node_modules/matrix-js-sdk/src/models/thread.ts` (patched at the compiled `lib/` level like the
existing tanstack patch):

1. **Aggregate `m.replace` pre-init** in `addRelatedThreadEvent` (`thread.ts:419`), mirroring the
   existing annotation special-case: alongside `replayEvents.push(event)`, call
   `this.timelineSet.relations.aggregateChildEvent(event, this.timelineSet)` for
   `RelationType.Replace` so `target.replacingEvent()` resolves immediately. This makes previews,
   `getLatestMessageContent`, and the engine's compaction see streamed content without opening the
   thread. (Also emit the edit through the timelineSet's Timeline channel is NOT needed —
   `ThreadEvent.Update` already fires per batch; aggregation is the missing half.)
2. **Un-strand failed initialization** in `updateThreadMetadata` (`thread.ts:648`): in the `catch`,
   also clear `this.initalEventFetchProm = undefined` so the next live event retries initialization
   instead of awaiting a rejected promise forever.

Both are candidates to upstream to matrix-org/matrix-js-sdk; keep the patch header commented with the
upstream PR link once filed.

### If H2 confirmed (repaint gate) — one-line scope fix in the room view

`src/app/mindroom/threads/roomLiveRenderController.ts:281`: for `threadOnlyRoomActivity`, drop the
`atBottomRef.current` gate for `m.replace`-bearing arrivals (or unconditionally `setTimeline({...ct})` —
it is a cheap identity-bump; the auto-scroll behavior stays gated as today). Do NOT touch the thread-view
branch or scroll logic.

### If H3 shows the placeholder produced no badge

No client change unless the repro shows js-sdk received `unread_thread_notifications` and the atom path
dropped it; server push-rule work is out of scope for this fork. Record findings in the issue either way.

### Explicitly not doing

- No "Thinking..." string-matching sweeps, no new backfill heuristics — the existing
  `threadEditBackfill` band-aid stays as-is and should become dead weight once H1 is fixed (follow-up
  candidate for removal once the regression spec is green over a few releases).
- No changes to `isNotificationEvent` for `m.replace` (correct per push-rule semantics).

Delivery per CLAUDE.md: one bounded step per commit — (1) repro spec red, (2) fix, spec green,
(3) flight-recorder extension — each with runbook update in `FORK_CHANGES.md`, `npm run typecheck`,
`npm run build`, `npm run lint`, and an independent review pass.

## 4. Secondary deliverable — flight-recorder sync/receive event

Recorder: `src/app/mindroom/diagnostics/flightRecorder.ts` — localStorage ring buffer, hard caps
(`FLIGHT_RECORDER_MAX_EVENTS = 32`, 8 KB JSON), strict validators with exact key counts
(`eventIsValid`, `flightRecorder.ts:108`). Design within those constraints:

- New variant in the `FlightEvent` union (`flightRecorder.ts:51`):
  `{ at: number; type: 'sync'; n: number; e: number; r: string; rt: RouteClass }`
  — `n` events in batch, `e` of them `m.replace`, `r` an 8-char room-id hash (privacy + size, same
  spirit as the ride-trace `roomHash`), `rt` the recorder's already-tracked route class (it maintains
  `route`/`hasThreadId` in the session — reuse, don't re-derive).
- **Coalescing (the important part, 32-slot budget):** maintain a module-local rolling window; write at
  most one `sync` event per 30 s per room by merging counts (`n += `, `e += `), EXCEPT always flush
  immediately when `e > 0` and the previous flush's `e === 0` (an edit burst is exactly the incident
  signature we need timestamps for). Expected cost during a CINNY-126-shaped incident: ~3–4 slots.
- Wiring: one `ClientEvent.Sync` listener registered where the recorder is installed (next to
  `installFlightRecorder`'s existing hooks), reading per-batch counts from the sync payload rooms
  section; keep the handler under ~1 ms (counting only, no JSON stringify per event).
- Validator + schema: extend `eventIsValid` with the exact-key-count check for the new shape. Keep
  `FLIGHT_RECORDER_SCHEMA_VERSION = 1` only if old sessions still validate (they do — validators are
  per-event); otherwise bump and accept both on read.
- Export rides through the existing CINNY-124/125 `diagnosticsExport.ts` path unchanged.

## 5. Test plan

### 5.1 Unit (vitest, colocated like existing `*.test.ts`)

- `compactThreadRootData.test.ts`: preview resolves the final body from a placeholder+17-edit fixture
  built from the sanitized exact traces (msgtype flips included); stays on fallback pre-aggregation
  (pins the H1 rendering contract both sides).
- Real-SDK contract test (same pattern as the spec-versions seeding test noted in `08118f7b`): construct
  a `Thread` with `initialEventsFetched=false`, deliver an `m.replace`, assert
  `target.replacingEvent()` resolves (pins patch #1 against future SDK upgrades); a second case rejects
  the init pagination once and asserts a retry happens on next event (pins patch #2).
- Engine write-through: uninitialized-thread edit reaches `saveThreadEventsToCache` (post-fix).
- Flight recorder: new-shape validation, coalescing window, edit-burst immediate flush, ring-buffer
  eviction still within 8 KB.

### 5.2 Integration / e2e (regression evidence)

- `e2e/live/cinny126-overview-stream-replay.spec.ts` (§1.2, variants A–D, four observations) — the
  exact-trace replay IS the regression test, per the ride-trace precedent ("a trace is the platform's
  own testimony", `rideTraceReplay.ts`). Red before fix (expected on B and D, possibly A per H2), green
  after.
- One additional case in the CINNY-124 recorder spec (`e2e/cinny124-flight-recorder.spec.ts`) asserting
  `sync` events appear in the export after a replay burst.

### 5.3 Fixtures

Commit sanitized copies of the three artifact JSONs under `e2e/live/fixtures/cinny126/` (bodies contain
personal trip-planning content — replace body text with same-length lorem while preserving exact lengths,
msgtypes, `stream_status`, timing, and relation shapes; a small `sanitize-cinny126-fixture.mjs` does this
deterministically so the fixture provably matches the wire shapes).

### 5.4 iOS validation

Simulator run per §1.3 before/after fix (video capture as evidence); device-against-production replay
after merge; flight-recorder export check confirms the new `sync` events record route + edit counts so
the next field occurrence is attributable in minutes.

## 6. Risks / open questions

- Tuwunel's MSC3773 / relations-recursion support levels shape both the badge expectation (obs. 2) and
  which js-sdk branch runs in `addRelatedThreadEvent` post-init — pin actual behavior on the first
  harness run and encode it in the spec.
- H1 patch #1 changes aggregation timing for ALL pre-init threads; watch the thread panel and
  `perf-thread-streaming.spec.ts` for regressions (edit aggregation is idempotent in the SDK, risk low).
- If desktop A–D are all green, the bug is iOS-runtime-specific (H5) — then the fix step narrows to the
  flight-recorder extension + a WKWebView-focused investigation with the simulator replay, and the plan's
  fix section defers to the recorded evidence rather than speculating.
