# MindRoom Cache Overhaul Plan (CINNY-207)

Status: **Phase 1 (P1.1–P1.6) landed and e2e-gated; Phase 2 P2.1 (unified CacheStore + D8 wipe) landed locally; Phase 2 P2.2 (ledger + `beforeTokens` pruning + 1 GB eviction budget) landed locally, P2.3 pending.**
Phase-1 e2e gate (2026-07-03, stack tip 55439be8): streamed-edit spec green
live (AC4, probe numbers in scorecard), stop-emoji green (AC3; three failed
attempts were host `ERR_NETWORK_CHANGED` flake — tracked in the Runbook),
background-freshness expected-red until Phase 3 (AC6). P0.3 large-room probe
baseline still pending; AC5 formal measurement happens with the Phase 3
engine work.
Created: 2026-07-03. Living document — see "How to use this document".

This is the canonical plan for making MindRoom feel like a native app: every room
and thread paints instantly from local cache, and the view always converges to
the latest server state. It records the investigation findings, the decisions
made with the product owner, the target architecture, the phased implementation
plan, and the accountability protocol we hold ourselves to.

Related documents:

- `FORK_CHANGES.md` Runbook — per-step delivery log (each bounded step gets an
  entry referencing a step ID from this plan).
- `docs/mindroom-cache-strategy.md` — operational description of the _current_
  cache model. Sections it owns (write owners, coverage semantics, forbidden
  patterns) are updated in lock-step as ownership moves (see Phase 7).
- `docs/mindroom-thread-architecture-plan.md` — earlier thread architecture
  plan; superseded where it conflicts with this document.

## How to use this document

- Before starting any step: re-read "Invariants", the phase you are in, and the
  "Accountability" section. After context compaction, re-read this file and
  `docs/mindroom-cache-strategy.md` before resuming.
- After finishing any step: update the Status Log at the bottom, tick evidence
  into the Scorecard, and add the Runbook entry in `FORK_CHANGES.md`.
- Scope changes are recorded in "Deviations", never silently applied.
- Every step follows the mandatory delivery process in `CLAUDE.md`: one bounded
  step, runbook update, `npm run typecheck` / `npm run build` / `npm run lint`,
  independent review pass, focused commit.

## 1. Product goal and invariants

MindRoom streams AI responses over Matrix: a placeholder message is sent, then
rapidly edited via `m.replace` until the final content lands. Streaming can be
cancelled via a stop emoji reaction on the streaming message, which is redacted
when streaming completes. Conversations are thread-first. The app must feel
native: no spinners, no lazy waterfalls, no stale content.

Two invariants define the contract (stale-while-revalidate):

- **I1 — Instant paint.** Opening any room or thread renders synchronously from
  whatever the cache holds, if anything. No network wait before first paint.
- **I2 — Guaranteed convergence.** After the paint, the view always reconciles
  to server truth: new messages, missed edits, missed redactions, removed
  reactions. Cached state never wins over newer server state. Corrections are
  seamless: in-place content swaps, no flicker, no scroll jumps.

Derived rule: **cache coverage flags may decide what to paint, but never
whether to revalidate.** Every open schedules a reconcile; when the cache was
right, the reconcile is a cheap no-op.

Scale assumptions (design targets, not hard limits): ~50 rooms on the user's
own homeserver (Tuwunel), threads up to low thousands of events, heavy
streaming-edit traffic (10+ edits/sec during streams).

## 2. Investigation findings (2026-07-03)

Ranked by severity within each thematic group (numbering is stable across
the document, so ids are not sequential within groups). File references are
as of commit `b7b10b9d` (v4.12.3 replay base, pre-overhaul); re-verified after the fork's upstream rebase.

### Architecture-level

- **F1 — Room-scoped machinery cannot deliver the goal.** All cache hydration,
  eager preload, thread prewarm, and live-event cache maintenance live inside
  `MindroomRoomTimeline.tsx` (~3,400 lines) and only run for the currently open
  room. There is no cross-room prefetch at app start, and caches of unmounted
  rooms go stale because the live write-through
  (`roomLiveEventController.ts:226`) is only attached while that room's
  component is mounted — even though the data for all rooms already arrives on
  `/sync`.
- **F2 — Write amplification on every live event.**
  `useRoomCacheLifecycleController` (`roomCacheLifecycleController.ts:132`)
  re-runs its persist effect whenever the raw timeline event count changes
  (`MindroomRoomTimeline.tsx:484`), which includes every streaming `m.replace`.
  Each run re-serializes the entire loaded room timeline (deep clone per event,
  up to the 10,000-event preload target) plus regroups and re-persists every
  thread snapshot in the loaded window — undebounced, on the main thread. The
  live path already persists incrementally (`roomLiveEventController.ts:183`,
  `:249`), making the sweep largely redundant. During eager preload this is
  O(n²) across ~50 batches.
- **F13 — Unbounded eager preload.** `preloadController.ts:66,91,121` loops
  `/messages` at batch size 200 toward a target of 10,000 events (~50
  sequential calls plus decryption per room open). The setting has a minimum
  of 50 but no maximum (`preloadSettings.ts:6-9`).

### Storage and durability

- **F3 — No eviction anywhere.** Neither `mindroom-room-event-cache` nor
  `mindroom-thread-event-cache` (nor `mindroom-thread-summary-cache`) has a
  size cap, TTL, or pruning; `updatedAt` is written but never read. The
  `beforeTokens` maps in meta records grow one entry per persist forever
  (`eventCacheTokenUtils.ts:7-17`).
- **F4 — All cache writes are fire-and-forget with swallowed errors**
  (`eventRepository.ts:670,801` and every DB op). A `QuotaExceededError`
  silently stops persistence while the app keeps trusting the cache.
- **F5 — Every intermediate streaming edit is stored forever.** Standalone
  `m.replace` events are persisted as individual records
  (`roomLiveEventController.ts:226-230` → `getThreadCacheTargetId` groups them
  into the thread). Streaming edits carry cumulative content, so a message
  streamed in 40 edits stores ~40 growing snapshots (~10× storage
  amplification). Cached page limits count raw records, so pages of heavily
  streamed threads are crowded with invisible edits
  (`threadEventCache.ts` `runCursorQuery` skips only the root event).

### Correctness of cached rendering

- **F6 — Stop-emoji persistence bug (reported by product owner).** Three
  cooperating mechanisms:
  - **A — Resurrection.** The cache has no delete path; a redacted reaction's
    record is never removed or updated. The redaction event itself often never
    persists: `m.room.redaction` has no `m.relates_to`, so `getRelation()` is
    null and it falls through every thread-relevance branch
    (`roomLiveEventController.ts:138-145`); redactions arriving while the room
    is unmounted are never heard at all (F1). Next hydration re-aggregates the
    stale reaction (`aggregateCachedRelationEvents`); the reopen reconcile only
    covers the latest 200 relations (`threadOpenCacheController.ts:469-545`).
  - **B — Ghost instances.** Hydration maps cached raw events through
    `mx.getEventMapper()` into _new_ `MatrixEvent` instances and aggregates the
    clones into timelineSet `Relations`. SDK redaction removal is
    instance-based, so a redaction applied to the SDK's own copy never reaches
    the clone; `getActiveAnnotationsByKey` keeps counting it.
  - **C — No repaint.** The reaction row is gated by `hasReactions` computed
    inside the row renderer (`MindroomRoomTimeline.tsx:1921`), which only
    re-runs on a timeline tick; a reaction redaction matches no live-handler
    branch and increments no tick.
- **F7 — Stale-while-revalidate violated.** `isCompleteThreadCacheCoverage`
  short-circuits network reconciliation entirely
  (`threadOpenCacheFirst.ts:87`) based on flags that F6-class bugs can make
  wrong, with no discovery path. Tail reconcile covers only 200 relations.
  There is no gap detection when `/sync` returns a `limited` timeline for a
  room (cache tail silently discontinuous with live tail).
- **F8 — Ordering fragility.** Both caches order and paginate by
  `(origin_server_ts, event_id)`; server stream order can diverge (federation,
  clock skew). `getLatestEvent` (`eventCacheEditUtils.ts:40-46`) breaks
  equal-timestamp edit ties by iteration order — nondeterministic across loads;
  same-millisecond ties are realistic at streaming rates.

### Network efficiency

- **F9 — Duplicate `/relations` fetching.** Four independent paths fetch the
  same thread's relations with no shared in-flight promise map (thread-open
  backfill, post-bootstrap refresh, tail refresh, overview resume). A single
  thread open performs overlapping limit-50 (`threadOpenSdkBootstrap.ts:124`)
  then limit-200 (`threadOpenPostBootstrapRefresh.ts:60`) tail fetches. Only
  the seed prewarm dedups correctly (`threadSeedPrewarmController.ts:28-31`).
- **F10 — No request cancellation.** All guards are check-after-await; no
  `AbortController` anywhere. Rapid room switching leaves up-to-50-call
  `/messages` loops running to completion per abandoned room.

### Structural

- **F11 — Preload setting uncapped** (`preloadSettings.ts:8`, no UI max).
- **F12 — Duplication and convergence-by-hope.** `roomEventCache.ts` and
  `threadEventCache.ts` are near-identical; four write triggers upsert into the
  same thread store relying on merge flags to converge; room cache lacks the
  corruption self-heal the thread cache has; `DB_VERSION = 2` with an upgrade
  handler that migrates nothing.

## 3. Decisions

Agreed with the product owner (Bas), 2026-07-03:

- **D1 — Invariants I1/I2** (Section 1) are the top-level contract.
- **D2 — Tiered prefetch model.**
  - **Tier 1 — Global sync write-through:** all joined rooms, unconditional,
    always on. Events (and redactions) already arrive via `/sync`; writing them
    through costs nothing extra. Includes gap-fill scheduling when a room's
    sync timeline is `limited`.
  - **Tier 2 — Background backfill:** tails + thread inventory to a modest
    depth, prioritized queue, **rooms on the user's own homeserver by
    default** (federated rooms backfill only on first open; after that Tier 1
    keeps them fresh).
  - **Tier 3 — Deep history:** current room only.
- **D3 — Homeserver detection** via the sender domain of the `m.room.create`
  event (robust across room versions; do not parse room IDs — room v12 /
  MSC4291 drops the server part).
- **D4 — Settings: replace, don't repurpose.** Remove
  `MindroomMessagePreloadLimitSetting` / `paginationLimit` and introduce a new
  prefetch settings group designed around the tier model: scope
  (`my-server` default / `all-rooms` / `current-room-only`) and depth targets.
  Stored legacy values are dropped.
- **D5 — Edit compaction: cache only placeholder + latest edit.** Never persist
  standalone `m.replace` records. On an edit, upsert the _target's_ record with
  the latest same-sender replacement bundled into
  `unsigned['m.relations']['m.replace']` (the representation
  `serializeEventsForCache` already half-implements). One record per logical
  message, ordered by the placeholder's timestamp. Writes are coalesced per
  target (~1 s) with a **synchronous flush on stream end** and on
  unmount/visibility loss. Redaction of the latest edit falls back to prior
  content on the next reconcile.
- **D6 — Redactions are first-class cache lifecycle.** Global handling in the
  write-through tier for every room: resolve the redaction target and
  delete/update its cache record (redacted reactions are deleted; redacted
  messages are stored pruned). Hydration must not inject clone instances when
  the SDK already holds the event, and must reconcile relation aggregation by
  event ID, not object identity. The thread-view live handler gets an explicit
  redaction branch that triggers a repaint tick.
- **D7 — SWR rule:** coverage decides what to paint, never whether to
  revalidate. Every open schedules a reconcile; the coverage short-circuit
  becomes "nothing to redraw", not "skip the network".
- **D8 — Migration: wipe and rebuild.** On the new schema version, delete old
  cache DBs and repopulate via Tier 1 + scheduler. No in-place migration code.
- **D9 — Storage budget: 1 GB on all platforms (including iOS),** enforced by
  eviction. Order: federated rooms first, then least-recently-active homeserver
  rooms; never evict the current room or recently opened threads. Quota errors
  are additionally handled reactively (F4 fix) because browsers may grant less
  than the budget.
- **D10 — Sequencing: quick wins first** (Phase 1 fixes on current
  architecture), then engine extraction on a cleaner, instrumented base.
- **D11 — Scale assumptions** as in Section 1.
- **D12 — Deterministic edit ordering:** latest edit chosen by
  `origin_server_ts`, ties broken by `event_id` lexicographic (spec-aligned).
- **D13 — DM exception deferred.** Small federated DMs may later be included in
  Tier 2 via the policy function; not in the first version.
- **D14 — Cancellation:** new scheduler/engine code uses `AbortController` from
  day one; existing paths adopt it as they are touched or absorbed.

## 4. Target architecture

A client-level **MindroomSyncEngine**, created alongside the Matrix client
(mounted once per session, independent of which room is open), owning all cache
writes. The timeline component becomes a pure consumer.

```text
                    matrix-js-sdk client (/sync)
                              |
              +---------------+----------------+
              |        MindroomSyncEngine       |
              |                                 |
              |  WriteThrough   BackfillScheduler|
              |  (Tier 1)       (Tiers 2+3)     |
              |        \\          /             |
              |        CacheStore               |
              |  (single write path, eviction,  |
              |   quota, schema, compaction)    |
              |            |                    |
              |        Reconciler               |
              |  (on-open convergence, gap fill)|
              +---------------+----------------+
                              |
              read APIs / hydration helpers
                              |
                 MindroomRoomTimeline (render)
```

Components:

- **CacheStore** — one module replacing `roomEventCache.ts` +
  `threadEventCache.ts` (schema v3, wipe-on-upgrade per D8). Adds: delete
  operations, per-room size/activity ledger for eviction (D9), edit compaction
  at the write boundary (D5), coalesced writes with flush hooks, quota-error
  handling and health state (F4), pruned `beforeTokens`. All writes flow
  through it; write failures are counted and surfaced.
- **WriteThrough (Tier 1)** — global `RoomEvent.Timeline` +
  `RoomEvent.Redaction` listeners on the client (all rooms, threads included),
  feeding CacheStore. Detects `limited` sync responses and enqueues gap-fill.
  Replaces the persistence half of `roomLiveEventController` /
  `threadCachePersistenceController` / `roomCacheLifecycleController`; the
  component keeps only render-triggering logic.
- **BackfillScheduler (Tiers 2–3)** — single priority queue: current room
  first, then recently-active homeserver rooms (policy: D2/D3/D13), then thread
  inventory. Bounded concurrency (2–3), `AbortController` per job, in-flight
  dedup map keyed by (roomId, threadId, kind) so no duplicate `/relations` or
  `/messages` work exists anywhere (F9). Absorbs the eager-preload loop
  (Tier 3) and the thread seed prewarm.
- **Reconciler** — the one implementation of I2. On every room/thread open:
  paint from cache, then verify tail continuity, missed edits/redactions, and
  relation state; repair in place without scroll jumps. Absorbs
  `threadOpenPostBootstrapRefresh`, `refreshLatestThreadRelationsTail`, and the
  resume controller's refresh. Hydration prefers SDK-held instances over
  mapper clones (F6-B).
- **PrefetchPolicy + settings** — new settings group (D4) consumed by the
  scheduler; policy function decides per-room tier membership.

## 5. Implementation phases

Each step is one bounded Runbook step (CLAUDE.md process). Step IDs below are
referenced from `FORK_CHANGES.md` entries.

### Phase 0 — Baseline, instrumentation, red tests

- **P0.1** Cache/IO probes: count IndexedDB puts/deletes per live event, per
  open, per stream; `navigator.storage.estimate()` snapshot; timing marks for
  first-paint-from-cache. Exposed via the existing timeline debug channel.
  Record baseline numbers in the Scorecard.
- **P0.2** E2E red specs against the local Tuwunel fixture (see
  `e2e/live/` conventions):
  - `stop-emoji-redaction.spec`: stream → stop reaction → redaction → assert
    emoji gone **in-session**, **after thread reopen**, **after full reload**
    (expected red for at least one state).
  - `streamed-edit-cache.spec`: stream a message with N edits → reload →
    assert latest content paints (and record how many cache records exist).
  - `background-room-freshness.spec`: two rooms; events arrive in room B while
    room A is open; open B → assert instant paint of new events (expected red —
    documents F1).
- **P0.3** Baseline capture: run probes on a seeded large room; write numbers
  into Scorecard "before" column.

### Phase 1 — Quick wins on the current architecture (D10)

- **P1.1** Kill write amplification (F2): remove the full-sweep persist from
  the `eventsLength` effect; rely on incremental live persists plus explicit
  persist points (pagination batch completion — the queued path already exists
  — room close/unmount, debounced idle flush). Exit: probe shows O(1) writes
  per live event; no cache coverage regression in
  `RoomTimeline.cache.test.ts`.
- **P1.2** Stop-emoji fix (F6): explicit redaction branch in the live handler
  (resolve target via `redacts`/`getAssociatedId`, update/delete cache record,
  trigger repaint tick); hydration reconciles aggregation by event ID and
  skips clone injection when `room.findEventById` hits. Exit: P0.2 spec green
  in all three states.
- **P1.3** Deterministic edit tiebreak (F8/D12): `origin_server_ts` then
  `event_id` in `getLatestEvent` and edit selection paths. Unit tests with
  same-millisecond edits.
- **P1.4** Edit compaction at the write boundary (F5/D5): stop persisting
  standalone `m.replace` records; upsert targets with bundled latest edit;
  per-target coalescing with flush on stream end/unmount/visibility loss.
  Includes lazy cleanup: hydration deletes legacy standalone replace records
  whose target record already bundles an equal-or-newer edit (D12 ordering;
  full purge arrives with D8 wipe in Phase 2). Exit:
  streamed message with N edits produces exactly 1 event record; reload paints
  final content.
- **P1.5** Surface write failures (F4): stop swallowing; failure counter +
  debug log; on quota errors enter a degraded "cache read-only" health state
  instead of silent divergence. Exit: unit test with injected quota error.
- **P1.6** Cap the legacy preload setting (F11) with a hard upper clamp as an
  interim guard (setting is replaced in Phase 6).

### Phase 2 — CacheStore consolidation

- **P2.1** Unified CacheStore module: merge the two near-identical cache
  modules behind one API (F12); add delete ops; schema v3 with **wipe and
  rebuild** (D8): on open, delete legacy DBs (`mindroom-room-event-cache`,
  `mindroom-thread-event-cache`, `mindroom-thread-summary-cache` and their
  session-scoped names).
- **P2.2** Eviction ledger + 1 GB budget (D9): per-room byte estimate and
  last-activity tracking; background eviction job in policy order; prune
  `beforeTokens` maps. Exit: synthetic overfill test (small budget override)
  evicts in policy order and never touches the current room.
- **P2.3** Port Phase-1 write paths onto CacheStore; architecture test forbids
  direct imports of the legacy modules.

### Phase 3 — Sync engine extraction (Tier 1)

- **P3.1** Engine skeleton at client level (created with the Matrix client,
  torn down on logout); global `RoomEvent.Timeline`/`RoomEvent.Redaction`
  write-through for all rooms, threads included, with edit compaction and
  redaction lifecycle from Phase 1 logic moved out of the component.
- **P3.2** Gap detection: `limited` sync → mark tail-discontinuity in CacheStore
  and enqueue gap-fill. Exit: kill-and-restart e2e — events sent while the app
  is closed appear from cache+gap-fill on next open.
- **P3.3** Strip the component's persistence responsibilities
  (`roomCacheLifecycleController`, persistence half of
  `roomLiveEventController`, `threadCachePersistenceController`); component
  keeps render triggering only. Exit: background-room-freshness spec (P0.2)
  green.

### Phase 4 — BackfillScheduler (Tiers 2–3)

- **P4.1** Scheduler with priority queue, concurrency cap, `AbortController`,
  in-flight dedup map (F9/F10/D14).
- **P4.2** PrefetchPolicy: homeserver detection via `m.room.create` sender
  (D3); scope default `my-server` (D2); depth targets per tier.
- **P4.3** Migrate Tier 3 (current-room deep history) into the scheduler;
  delete the eager-preload loop in `preloadController.ts`. Exit: room open
  issues no burst of 50 sequential `/messages`; deep history proceeds in
  scheduled, abortable batches.
- **P4.4** Absorb thread seed prewarm and overview resume fetching into the
  scheduler (single dedup domain).

### Phase 5 — Reconciler (I2 everywhere)

- **P5.1** One reconcile pass on every room/thread open: coverage decides paint
  only (D7); the complete-coverage path still schedules revalidation. Absorb
  the four overlapping refreshers (F7/F9). Exit: AC9 unit test — coverage
  -complete open still reconciles.
- **P5.2** Divergence repair: seeded-stale-cache e2e (stale edit, stale
  reaction, missed redaction) converges after open without reload, in place,
  scroll anchored. Exit: AC2 spec green.

### Phase 6 — Settings replacement (D4)

- **P6.1** New prefetch settings group (scope + depth); remove
  `MindroomMessagePreloadLimitSetting` and `paginationLimit` plumbing; drop
  stored legacy values; update settings tests.

### Phase 7 — Cleanup and documentation

- **P7.1** Delete superseded controllers and dead code; update
  `docs/mindroom-cache-strategy.md` (write owners → engine components; eager
  preload section; forbidden patterns — the "no cross-room eager preload from a
  room screen" rule remains true because cross-room work lives in the engine).
- **P7.2** Final adversarial review + full Scorecard audit (see Section 6).

## 6. Accountability: how we verify we built the right thing

### 6.1 Rules (anti-self-deception)

1. **No criterion is marked done by its implementer without linked evidence.**
   Evidence = a re-runnable command (test name, e2e spec, probe measurement)
   recorded in the Scorecard row.
2. **Measurements are numbers, not adjectives.** "Fast" is not evidence;
   "first paint 84 ms, 0 network requests before paint" is.
3. **Red before green.** Every behavioral fix lands with the failing test first
   (recorded in the Runbook entry), matching existing fork practice.
4. **Independent review per step** (CLAUDE.md): a separate agent/subagent
   reviews the diff against this plan; the reviewer, not the author, confirms
   the Scorecard row.
5. **Deviations are logged**, never silently applied (Section 8).
6. **Phase gates:** a phase is closed by an adversarial review whose explicit
   job is to _refute_ each checked criterion of that phase — verify the
   evidence exists, re-run it, and check it actually tests the claim rather
   than a mock of it.

### 6.2 Acceptance criteria (map to invariants and findings)

| ID   | Criterion                                                                                                                                           | Verifies | Evidence type                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------- |
| AC1  | Cold open of a cached room/thread paints from cache with zero network requests before first paint; first paint under 200 ms on the dev machine      | I1       | e2e + probe numbers               |
| AC2  | Seeded divergence (stale edit, stale reaction, missed redaction) converges after open without reload, in place, scroll anchored                     | I2       | e2e (`P5.2`)                      |
| AC3  | Stop emoji gone after redaction: in-session, after thread reopen, after full reload                                                                 | F6       | e2e (`P0.2`/`P1.2`)               |
| AC4  | A message streamed with N edits produces exactly 1 cached event record (target with bundled latest edit); reload paints final content               | F5/D5    | integration + e2e                 |
| AC5  | IndexedDB write operations per live event are O(1) (constant, independent of loaded timeline size); before/after numbers recorded                   | F2       | probe (`P0.1`)                    |
| AC6  | Events arriving in a closed room are readable from cache when that room is next opened, with no fetch before paint                                  | F1/I1    | e2e (`P0.2` background-freshness) |
| AC7  | Under a synthetic overfill (test budget override), eviction triggers in policy order (federated → LRU homeserver) and never evicts the current room | D9       | integration                       |
| AC8  | No duplicate in-flight `/relations` or `/messages` job for the same (room, thread, kind) anywhere                                                   | F9       | scheduler unit + probe            |
| AC9  | A thread open with complete cache coverage still schedules a reconcile (coverage gates painting only)                                               | D7/F7    | unit                              |
| AC10 | Prepends/corrections preserve scroll anchoring (existing anchor tests stay green; new correction-path test added)                                   | I2       | unit/e2e                          |
| AC11 | Injected quota failure flips cache health to degraded read-only state and is surfaced (no silent divergence)                                        | F4       | unit (`P1.5`)                     |
| AC12 | Same-millisecond edits resolve deterministically (ts then event_id) across load orders                                                              | F8/D12   | unit (`P1.3`)                     |
| AC13 | After app closed during activity, next open paints cache then gap-fills to continuity (no permanent hole)                                           | I2/P3.2  | e2e                               |
| AC14 | Legacy caches are wiped exactly once on schema v3 and rebuilt in background; no legacy standalone `m.replace` records exist post-rebuild            | D8       | integration                       |

### 6.3 Scorecard (living)

Filled as steps complete. "Before" numbers from P0.3.

| AC   | Status | Evidence (command / spec / probe) | Before → After | Confirmed by (reviewer) | Date |
| ---- | ------ | --------------------------------- | -------------- | ----------------------- | ---- |
| AC1  | ☐      |                                   |                |                         |      |
| AC2  | ☐      |                                   |                |                         |      |
| AC3  | ✓      | e2e `cinny207-stop-emoji-redaction` green on stack tip (55439be8); 3 prior failed runs were env flake (`ERR_NETWORK_CHANGED` storms, failure point wandering login/reload) | reaction resurrected on reopen/reload → gone in all three states | workflow rounds 1-2 + docker e2e run | 2026-07-03 |
| AC4  | ✓      | e2e `cinny207-streamed-edit-cache` green LIVE on stack tip: probe `editCompactions=1`, `threadEventPuts=3`, 1 target record with bundled final body pre+post reload; unit `npx vitest run src/app/mindroom/threads/eventCacheEditUtils.test.ts src/app/mindroom/threads/editCompactionScheduler.test.ts src/app/mindroom/threads/roomLiveEventController.compaction.test.ts src/app/mindroom/threads/eventRepository.test.ts` | 26 thread-cache records for a 25-edit streamed message (P0.3 spec run) → exactly 1 target record with bundled edit | workflow round 2 (spec traced sound) + docker e2e run | 2026-07-03 |
| AC5  | ☐      |                                   |                |                         |      |
| AC6  | ☐      | e2e `cinny207-background-room-freshness` (red until Phase 3) | 0 cached events for a background room (P0.3 spec run) |                         |      |
| AC7  | ☐ impl | `npx vitest run src/app/mindroom/threads/cacheStore/__tests__/cacheEviction.test.ts` (4/4 — three rooms seeded via the real save paths (federated / LRU-old / protected-recent); budget shrunk via `__setCacheStoreByteBudgetForTests` so eviction must fire; asserts federated evicted first, protected room never touched, cleanup complete (events / meta / summaries / ledger row), under-budget stop honoured at `budget * EVICTION_TARGET_UTILIZATION = 0.9`, recent-open guard alone protects a room without registry entry, back-to-back schedules collapse to one runner invocation via a `readLedgerSnapshot` spy). Docker e2e budget-override run pending. | over-budget state persists without the job (red-first probe inside the AC7 test); after the job runs, `bytesAfter` drops below the target and evicted rooms' events / meta / summaries / ledger rows are all gone |                         |      |
| AC8  | ☐      |                                   |                |                         |      |
| AC9  | ☐      |                                   |                |                         |      |
| AC10 | ☐      |                                   |                |                         |      |
| AC11 | ✓      | `npx vitest run src/app/mindroom/threads/cacheHealth.test.ts src/app/mindroom/threads/eventRepository.test.ts` | silent divergence → read-only degrade | workflow rounds 1-2 (p15-p16 interaction dimension clean) | 2026-07-03 |
| AC12 | ✓      | `npx vitest run src/app/utils/room.test.ts` (tie tests) | order-dependent → id-deterministic | workflow rounds 1-2 + landed-stack review | 2026-07-03 |
| AC13 | ☐      |                                   |                |                         |      |
| AC14 | ☐ impl | `npx vitest run src/app/mindroom/threads/cacheStore/__tests__/cacheStoreDb.wipe.test.ts` (2/2 — legacy DB names gone from `indexedDB.databases()` on first v3 open, marker present in `meta`, reopen after `resetCacheStoreForTesting()` performs zero further `deleteDatabase` calls; multi-session gate leaves shared singletons alone). Docker e2e post-upgrade paint verification pending. | six legacy DBs present pre-open → all six absent + unified DB present post-open |                         |      |

### 6.4 Regression guards (architecture tests)

Added as their phases land, in
`src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts` (or a
new engine-scoped guard file):

- The room-cache persist sweep stays debounced and delta-only — armed via
  `ROOM_CACHE_PERSIST_DEBOUNCE_MS`, already-persisted event ids skipped
  (Phase 1 — **added**; reworded from "no full-timeline sweep" because the
  landed P1.1 design keeps a debounced delta sweep rather than removing it).
- The cache write boundary rejects standalone same-sender `m.replace`
  records (Phase 1 — **added**).
- No imports of legacy cache modules outside CacheStore (Phase 2).
- Render components do not import CacheStore directly (carried over from
  `mindroom-cache-strategy.md`).
- The removed preload setting is not reintroduced (Phase 6).

### 6.5 Validation environment

- Local Tuwunel fixtures and e2e conventions per `e2e/live/` and the
  docker-matrix workflow (full suite ~14 min; never edit `src/` mid-run —
  Vite HMR corrupts the run).
- Per-step: `npm run typecheck`, `npm run build`, `npm run lint`, focused
  `npm test` set, plus the phase's e2e specs.

## 7. Risks and mitigations

- **Engine extraction destabilizes a ~3,400-line component.** Mitigate: phased
  absorption (persistence first, fetching second, reconciliation third), the
  architecture guards above, e2e suite per phase, quick-wins-first so the
  riskiest work happens on an instrumented base with a green bug-fix suite.
- **Wipe-and-rebuild causes a cold-start burst after upgrade.** Mitigate:
  scheduler rate limits and priority order make the rebuild invisible (current
  room first); it runs against our own Tuwunel.
- **Browsers may grant less than 1 GB (iOS WKWebView especially).** Mitigate:
  reactive quota handling (AC11) is independent of the proactive budget;
  `navigator.storage.estimate()` probe feeds the eviction job.
- **SDK internals coupling** (`Relations` aggregation, instance identity).
  Mitigate: reconcile by event ID; unit tests around aggregation seams; keep
  the SDK version pinned during the overhaul.
- **Known flaky/pre-broken e2e specs** in the existing suite. Mitigate: new
  specs isolated; flake list tracked in the Runbook, not ignored ad hoc.
- **Timestamp-order divergence under federation** (F8) is accepted for now:
  deployment is effectively single-homeserver; D12 removes the
  nondeterministic part. Revisit if federation becomes a product target.

## 8. Deviations

- 2026-07-04 — **P2.2 eviction ships with federated-flag population,
  protected-room registry, and `lastOpenedTs` stamping deferred to
  Phase 3/4.** The eviction policy (D9) reads three signals it does
  not yet own the write side of: `ledger.federated`, the module-level
  protected room registry (`setEvictionProtectedRoomIds`), and
  `meta.lastOpenedTs`. All three landed as read-only inputs in P2.2
  with the eviction job wired to consume them; their populators wire
  in with the Phase 3/4 sync engine. Consequence today: (a) no room
  is flagged federated so the policy degrades to pure LRU order —
  acceptable because we're single-homeserver in production, (b) the
  registry is empty so the "current room never evicted" invariant is
  carried by the LRU order alone (the actively-open room is by
  definition the room with the highest `lastActivityTs`; new events
  arriving to it keep it at the tail), (c) with no `lastOpenedTs`
  stamps the recent-open guard is a no-op — again acceptable because
  LRU is a reasonable fallback. `noteRoomOpened`, `noteThreadOpened`,
  and `setEvictionProtectedRoomIds` are exported now with unit tests
  so Phase 3/4 has drop-in hooks. Recorded here so P2.2 review does
  not count these as gaps.

- 2026-07-04 — **P2.2 D9 "never evict recently opened threads"
  implemented at whole-room granularity in v1.** The recent-open
  guard skips the entire room if ANY of its thread scopes'
  `meta.lastOpenedTs` is inside `EVICTION_RECENT_OPEN_WINDOW_MS =
  24h`. Because eviction is whole-room granularity (per D9), a finer
  per-thread guard would still boil down to a room-level decision.
  Documented so the AC7 gate is not signed off on a partial
  interpretation.

- 2026-07-03 — **P2.1 / D8 wipe lands before Tier 1 exists (Phases
  3-4).** The D8 legacy-DB wipe fires on first v3 open at the end of
  P2.1, before the sync-engine write-through (P3.1) and the
  backfill scheduler (P4) exist to rebuild the cache. Post-upgrade
  first-open of each room is therefore a network paint — equivalent to
  a fresh login — until the engine repopulates. This is a transient I1
  regression accepted for sequencing: D8 has to land as part of the
  CacheStore consolidation so the shim flip is safe and the new
  schema owns the DB names. It flips green again with P3.1 +
  P3.2/P4.1. Recorded here so the AC1 gate is not signed off on the
  P2.1 landing.

- 2026-07-03 — **P1.4 / D5 "synchronous flush on stream end"** reinterpreted:
  the implementation has no stream-end *detection*; the per-target trailing
  debounce (1 s) is the stream-end flush — each edit re-arms the timer, so
  the trailing write carries the final content ≤1 s after the last edit.
  Synchronous flushes exist on unmount, `pagehide`, and
  `visibilitychange → hidden`. Difference vs. the literal D5 wording: a hard
  tab kill inside the 1 s window can lose the last pending upsert (the
  target's previous record remains; reconcile converges it). Reason:
  MindRoom emits no explicit end-of-stream marker on the wire today, and the
  stop-emoji redaction is not guaranteed for uncancelled streams. Flagged by
  workflow review round 1; recorded here for product-owner review.

## 9. Status log

- 2026-07-04 — **P2.2 landed locally** on
  `cache-overhaul/09-p2-cachestore`: eviction ledger + `beforeTokens`
  pruning + 1 GB byte-budget eviction job (finding F3, decision D9,
  AC7). Three commits on top of the P2.1 stack:

  1. `feat: maintain the room byte/activity ledger on cache writes` —
     `cacheStoreLedger.ts` tracks per-room
     `{approxBytes, eventCount, lastActivityTs, federated?}` rows in
     the `room_ledger` store, updated transactionally with event
     puts/deletes. Read-before-write / read-before-delete for exact
     deltas; one-time lazy bootstrap (bounded to the touched room)
     seeds pre-P2.2 records; whole-DB delete implicitly clears; room-
     and thread-scope writes populate the SAME per-room row (whole-
     room eviction). Meta-only saves leave the ledger untouched.
     Exposed `noteRoomOpened` / `noteThreadOpened` — meta upserts
     that stamp `lastOpenedTs` while preserving other fields
     (callers wire in Phase 3/4).
  2. `feat: prune beforeTokens maps on meta writes` (F3) — reshaped
     `CachedPaginationTokenMap` to
     `Record<eventId, {token, savedAt}>`. Every merge stamps
     `savedAt = Date.now()` and prunes to
     `MAX_CACHE_BEFORE_TOKENS = 50`, oldest first with lexicographic
     event-id tiebreak; the entry being written is never pruned.
     Public `getCachedPaginationToken` return shape unchanged.
  3. `feat: cache eviction job with 1 GB budget` (D9/AC7) — new
     `cacheEviction.ts`. `runCacheEvictionIfOverBudget(sessionId)`
     reads the ledger snapshot, and if over budget evicts whole
     rooms until below `budget * 0.9`. Order: `federated === true`
     first, then ascending `lastActivityTs`. Skip: protected registry
     + rooms with any `meta.lastOpenedTs` inside 24 h. Eviction
     deletes events / meta / thread summaries / ledger row for the
     room; `eventDeletes` probe counts the events removed. Save-path
     `maybeScheduleEvictionCheck` fire-and-forget with module-level
     debounce (60 s per session, no timers held open).

  Tests: `cacheStoreLedger.test.ts` 10/10;
  `eventCacheTokenUtils.test.ts` 16/16;
  `cacheEviction.test.ts` 4/4. Regression: contract suite 42/42, D8
  wipe 2/2, full mindroom suite 218 files / 1929 tests, full vitest
  324 files / 2490 tests. `npm run typecheck`, `npm run build`
  clean; `npm run lint` 0 errors (19 pre-existing warnings). Section
  8 records the deferred federated-flag / registry / stamp
  populators and the whole-room recent-open interpretation.
  Deferred from this step: docker e2e run (separate gate); P2.3
  direct-import flip + architecture guard forbidding legacy imports
  outside cacheStore.

- 2026-07-03 — **P2.1 landed** (PR 9): unified CacheStore module
  consolidating `roomEventCache.ts`, `threadEventCache.ts`, and
  `threadSummaryCache.ts` behind a single-DB schema v3 (finding F12,
  decisions D8 + D9-prep). Storage lives in
  `src/app/mindroom/threads/cacheStore/`: one `events` store keyed by
  `${roomId}|${scope}|${eventId}` with a shared
  `by_scope_ts = [roomId, scope, ts, eventId]` index (`scope=''` for
  room-timeline, `scope=threadId` for threads); one `meta` store; one
  empty `room_ledger` store prepared for the P2.2 eviction ledger; one
  `thread_summaries` store with a `by_room` index. A single scoped-
  cursor core drives both room and thread reads/writes while preserving
  the two legacy-faithful behaviors the contract suite pins (room
  cursor skips local-echo inside the cursor without counting toward
  the limit; thread cursor skips `eventId === threadId`) and the meta
  asymmetry (room meta written only when a before-token was supplied;
  thread meta always written with `mergeThreadCacheFlag` semantics).
  D8 wipe fires on first v3 open: deletes the three session-scoped
  legacy DBs plus the three unsuffixed singletons (gated to 0-or-1
  stored sessions, matching the pre-existing legacy migration gate),
  writes an idempotency marker into `meta`, exactly-once per session.
  The three legacy modules became pure re-export shims; the legacy
  DB name strings are retained via `legacyCacheDbNames.ts` for logout
  cleanup on rolled-back installs. `sessionCleanup` and
  `initMatrix` both gained the unified `mindroom-cache` /
  `mindroom-cache::<sessionId>` names alongside the legacy ones.
  `e2e/helpers/storage.ts` was flipped to read the unified DB (scope
  filter for room vs. thread) while returning the same record shapes
  so the cinny207 P0.2 specs need no changes; `seedThreadSummaryCache`
  writes to the unified DB and pre-seeds the wipe marker so its data
  survives the first app open. AC14 evidence recorded above (wipe
  test 2/2; docker verification pending). Deferred from this step:
  P2.2 eviction ledger + 1 GB budget; P2.3 direct-import flip +
  architecture guard forbidding legacy imports outside cacheStore.
  Contract suite: 42/42 (21 legacy + 21 cacheStore). Full mindroom
  suite: 216 files / 1908 tests. Full vitest: 322 files / 2469 tests.
  Section 8 records the D8-before-Tier-1 sequencing deviation.

- 2026-07-03 — **P1.6 landed** (PR 8): legacy preload setting hard-capped
  (F11). `MAX_PAGINATION_LIMIT = 10000` enforced in `sanitizePaginationLimit`
  (covers UI commit and stored-value reads) and reflected in the settings
  input. Interim guard until the Phase 6 settings replacement (D4).
  **Phase 1 (P1.1-P1.6) is now fully landed.**

- 2026-07-03 — **P1.5 landed** (PR 7): cache write failures surfaced (F4).
  `cacheHealth.ts` counts every failure, logs the first per scope, and a
  `QuotaExceededError` degrades the session to cache-read-only (writes
  skipped at the persist entry points, reads/reconcile unaffected,
  `window.__MINDROOM_CACHE_HEALTH__` inspectable). AC11 unit-tested with an
  injected quota error. Deletes stay ungated; remaining write sites move
  behind CacheStore in Phase 2.

- 2026-07-03 — **P1.4 landed** (PR 6): edit compaction at the cache write
  boundary (F5/D5). Standalone same-sender `m.replace` records are no longer
  persisted; instead a per-target trailing-debounced scheduler
  (`THREAD_EDIT_COMPACTION_DEBOUNCE_MS = 1000`, mockable from
  `preloadSettings.ts`) upserts the target's cache record with the SDK-
  aggregated latest edit bundled by `serializeEventsForCache` into
  `unsigned['m.relations']['m.replace']`. The trailing timer IS the
  stream-end flush; pending upserts are also flushed synchronously on
  `pagehide` and `visibilitychange → hidden` and on component unmount.
  Sweep path is unaffected — bookkeeping still marks skipped-persist ids as
  seen so replaces cannot cause endless re-sweeps. Hydration lazily deletes
  legacy standalone replace records whose target record already bundles an
  equal-or-newer edit under the D12 ordering (independent-review tightening;
  deleting eagerly could lose the newest edit until a later re-persist; full
  purge lands with the Phase 2 D8 wipe). AC4 evidence recorded above;
  e2e run is pending (deferred out of this session per instructions).
  Workflow review round 1 follow-ups: fire-time target misses now fall back
  to persisting the replace standalone (`editCompactionTargetMisses` probe),
  room-view thread attribution is captured at schedule time (mid-debounce
  redaction tombstones land), and `collectStateTargetEvents` no longer
  re-expands pruned redacted reactions. Round 2 follow-ups: cross-sender
  replaces are always emitted as standalone records — direct persist when
  the target is known at arming, fire-time sender re-check when the target
  materializes only during the debounce window — and the window keeps the
  D12-latest replace rather than the last-arrived one.

- 2026-07-03 — **P1.3 landed** (PR 5): deterministic edit tiebreak (D12).
  Review follow-up: `applyCachedRedactions` never re-applies a cached
  redaction over an already-redacted instance (the live-attached redaction
  wins; the D12 pick only orders redactions for a not-yet-redacted target).
  Shared comparator `isEventOrderedAfter` (ts, then lexicographic event id,
  full tie keeps the incumbent instance) used by `getLatestEdit` and the
  cached-redaction selector. AC12 unit tests assert order-independence for
  same-millisecond edits.

- 2026-07-03 — **P1.2 landed** (PR 4): redaction cache lifecycle. Reaction
  records deleted (with by-event-id scan fallback), redaction events
  persisted as records and re-applied to late-arriving stale copies (Tuwunel
  serves un-pruned redacted events on /relations and /messages for ~10 s and a
  reload's gappy sync can skip the redaction entirely), prefer-live event
  mapper heals instance divergence both ways, render-merge scrubs reaction
  aggregations by redacted event id, explicit repaint tick. AC3 green in all
  three states.

- 2026-07-03 — **P1.1 landed** (PR 3): room-cache persist sweep is now a
  trailing-debounced (250 ms) delta pass — already-persisted room events are
  skipped, thread groups re-persist only when they contain an unseen event,
  and cached backward tokens are only written when the delta contains the
  overall-earliest event. AC5 formal measurement via the probe happens with
  the P1.4 streamed-edit spec run.

- 2026-07-03 — **P0.1 + P0.2 landed** (PR 2 of the stack): cache write probe
  (`cacheProbe.ts`) wired into both save paths and the persist entry points
  (put/save/error counters, hydrate timing marks, `window.__MINDROOM_CACHE_PROBE__`);
  matrix e2e helpers for `m.replace` edits and redactions; three red live specs
  annotated `test.fail()`: `cinny207-stop-emoji-redaction` (AC3, green in P1.2),
  `cinny207-streamed-edit-cache` (AC4, green in P1.4),
  `cinny207-background-room-freshness` (AC6, green in Phase 3).

- 2026-07-03 — Rebased onto the v4.12.3-based `dev` (`b7b10b9d`); re-verified
  findings F1-F13 anchors on the new base and updated line references.
- 2026-07-03 — Plan created from the caching investigation (two mapping
  passes + direct code reading) and decision discussion with Bas. Findings
  F1–F13, decisions D1–D14, phases P0–P7 defined. No implementation started.
