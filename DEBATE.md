# CINNY-003g Plan Debate: IndexedDB Cache vs Proactive Fetch

## Plans Under Review

- **Plan A** (`PLAN.md`): Dedicated IndexedDB cache for thread summaries, decoupled from timeline loading
- **Plan B** (`PLAN-B.md`): Proactive `fetchRelations` for visible thread roots missing summary data

Both plans agree on the root cause: thread summary events are unavailable because (1) SDK Thread `.events` arrays are empty for unopened threads, and (2) summary events are excluded from the room timeline when `threadSupport: true`.

---

## Dimension 1: Correctness — Does it actually fix the bug?

### Plan A (IndexedDB Cache)

Plan A adds a persistent cache as a third fallback tier in `getThreadSummaryInfo`. However, it has a **critical bootstrapping gap**:

- **Write-through relies on discovery**: The cache is only populated when Path 1 (SDK thread events) or Path 2 (room timeline scan) finds a summary.
- **Path 2 is dead code**: Plan B correctly identifies that `buildThreadSummaryMap(loadedTimelineEvents)` never finds summary events because with `threadSupport: true`, the SDK's `eventShouldLiveIn()` returns `shouldLiveInRoom: false` for thread replies. Summary events are thread replies. They are never in `loadedTimelineEvents`.
- **Path 1 only works for opened threads**: `room.getThread(id)?.events` is only populated when the thread was previously opened or events arrived via `/sync`.

So: **on first visit after login, for threads whose summaries didn't arrive via recent sync, the cache is empty and no mechanism populates it.** The cache only helps on *subsequent* visits after the summary was already found by some other means. Plan A partially fixes the bug (cross-session persistence once discovered) but doesn't fix the initial discovery problem.

Step 5 (live event handler) would populate the cache for *new* summaries arriving via sync, but pre-existing summaries from before the session remain invisible.

### Plan B (Proactive Fetch)

Plan B calls `mx.fetchRelations()` for visible thread roots missing summary data. This fetches directly from the homeserver — the ground truth. It handles:

- Cold start (first visit after login): fetches from server
- Pre-existing summaries: fetches from server
- Room re-entry: in-memory cache avoids re-fetch during session
- Live events: re-render fix ensures new summaries appear immediately

**Plan B correctly solves the initial discovery problem that Plan A cannot.**

### Verdict: Plan B wins on correctness

Plan A's cache is only useful *after* a summary has been seen, but the bug is precisely that summaries are *never* seen. Plan B breaks this chicken-and-egg problem by going to the server.

---

## Dimension 2: Reliability / Edge Cases

| Scenario | Plan A | Plan B |
|----------|--------|--------|
| First visit after login (cold cache) | Summaries missing | Fetches from server — works |
| Page reload, previously seen summaries | IndexedDB has data — works | Must re-fetch from server |
| Network offline after initial load | Cache serves stale data — works | Fetch fails — summaries missing |
| Thread summary updated (re-summarize) | Write-through updates cache on next discovery | Fetch gets latest from server |
| User scrolls through many thread roots | Instant from cache | N API calls, potential latency |
| IndexedDB unavailable (private browsing) | Falls back to existing broken behavior | Fetch still works (no IDB needed) |
| Very old threads (months old) | Cache may have data from prior sessions | Fetch always works |

**Complementary strengths**: Plan A excels at persistence and offline resilience. Plan B excels at correctness and freshness. Neither alone covers all scenarios optimally.

---

## Dimension 3: Complexity

### Plan A

- New file: `threadSummaryCache.ts` (~200-300 lines of IndexedDB boilerplate)
- State management: `cachedSummaryMap` state + useEffect for loading
- Write-through logic: diff computed summaries against cache, persist changes
- Session cleanup: wire into logout flow
- Follows established patterns (`threadEventCache.ts`, `roomEventCache.ts`), reducing cognitive overhead

**Estimated touch points**: 3 files modified, 1 new file. ~300 lines new code.

### Plan B

- New hook: `useThreadSummaries.ts` (~100-150 lines)
- Fetch logic: `fetchRelations` per visible thread root, with caching
- Debouncing/batching: needed to avoid N+1 API storm
- Error handling: network failures, rate limiting
- Thread model population: `thread.addEvents()` for fetched events
- Live event fix: small modification to `useLiveEventArrive`
- Dead code cleanup: remove `buildThreadSummaryMap` usage

**Estimated touch points**: 2 files modified, 1 new file. ~200 lines new code.

### Verdict: Plan B is slightly simpler

Plan B has fewer moving parts (no IndexedDB layer, no write-through synchronization). The fetch-and-cache-in-memory pattern is more straightforward than the dual-layer IndexedDB + in-memory + write-through architecture of Plan A.

---

## Dimension 4: Performance

### Plan A
- **Read**: IndexedDB read on room entry (fast, ~1-5ms)
- **Write**: IndexedDB write on discovery (async, non-blocking)
- **Network**: Zero additional API calls
- **Render**: No loading states needed — cache is available synchronously after initial async load

### Plan B
- **Read**: API call per visible thread root on room entry
- **Write**: None (in-memory only)
- **Network**: `fetchRelations` per thread root. With `limit: 50`, each is a small request, but for rooms with 20+ visible threads, that's 20+ API calls on room entry
- **Render**: Brief loading period while fetches complete — summaries pop in asynchronously

### Verdict: Plan A wins on performance (for subsequent visits)

Plan A's zero-network-cost after initial population is superior. Plan B's per-thread-root API calls could cause visible latency, especially on slow connections or rooms with many threads.

---

## Dimension 5: Plan B's Unique Insight — Dead Code

Plan B makes a critical observation that Plan A overlooks: **`buildThreadSummaryMap(loadedTimelineEvents)` is dead code** when `threadSupport: true`. The SDK filters thread reply events out of the room timeline entirely, so the fallback path in `getThreadSummaryInfo` never finds anything.

This means:
1. The `threadSummaryInfoMap` memo (line 2566-2572) always produces an empty map
2. The `fallbackInfo` parameter passed to `getThreadSummaryInfo` is always `undefined`
3. The function reduces to: "check SDK thread events, or return undefined"

Plan A builds its cache write-through on the assumption that both paths can discover summaries. Since Path 2 is dead, the write-through only triggers via Path 1 (SDK thread events), which is the very path that already works when it has data.

---

## Recommendation: Hybrid Approach

**Use Plan B's fetch strategy for discovery, with Plan A's IndexedDB for persistence.**

The core insight: Plan B solves the *discovery* problem (getting summaries the client has never seen), while Plan A solves the *persistence* problem (keeping summaries across page reloads without re-fetching). They are complementary, not competing.

### Hybrid Architecture

```
getThreadSummaryInfo(room, mEvent)
  |
  +-- 1. Check SDK thread.events (existing Path 1)
  |     -> If found: return info, persist to cache
  |
  +-- 2. Check in-memory fetchedSummaryMap (from useThreadSummaries hook)
  |     -> If found: return info (already persisted when fetched)
  |
  +-- 3. Check IndexedDB cache (Plan A's persistent store)
        -> If found: return info (from prior session)
```

On room entry:
1. Load IndexedDB cache -> immediate display of previously-seen summaries
2. For visible thread roots still missing summaries, `fetchRelations` -> fills gaps
3. Persist all fetched summaries to IndexedDB -> available on next page load

### Why not just Plan B alone?

Without IndexedDB persistence, every page reload re-fetches all summaries from the server. For rooms with many threads, this means:
- Unnecessary API load on the homeserver
- Visible delay while summaries load (flash of empty -> populated)
- Degraded offline experience

### Why not just Plan A alone?

Without proactive fetching, the cache never gets populated for threads that weren't opened and whose summaries didn't arrive via sync. The bug persists on first visit.

---

## Implementation Order

### Phase 1: Live event re-render fix (from Plan B, Step 3)
**Scope**: Small, targeted fix in `useLiveEventArrive` handler.

When a thread-only event arrives that is a summary event, force re-render regardless of scroll position. This ensures *new* summaries (generated while user is in-room) appear immediately.

```ts
if (isThreadOnlyActivity) {
  if (atBottomRef.current || isMindroomThreadSummaryEvent(mEvt)) {
    setTimeline((ct) => ({ ...ct }));
  }
  // ...
}
```

**Risk**: Low. Bounded change, only affects summary events.
**Commit**: `fix(CINNY-003g): re-render timeline when thread summary events arrive`

### Phase 2: Proactive fetch hook (from Plan B, Steps 1-2)
**Scope**: New `useThreadSummaries` hook + integration into RoomTimeline.

- For visible thread roots without summary data, call `fetchRelations`
- Cache results in-memory (Map/useRef) to avoid re-fetching
- Feed fetched events into SDK thread model via `thread.addEvents()`
- Integrate into render path as fallback in `getThreadSummaryInfo`

**Risk**: Medium. API load needs batching/throttling. Must handle errors gracefully.
**Commit**: `feat(CINNY-003g): proactively fetch thread summaries for visible thread roots`

### Phase 3: IndexedDB persistence (from Plan A, simplified)
**Scope**: New `threadSummaryCache.ts` + wire into fetch hook and session cleanup.

- Lightweight cache: stores only `MindroomThreadSummaryInfo` per `(roomId, threadRootId)`
- Populated by the fetch hook (Phase 2) when summaries are discovered
- Loaded on room entry *before* fetch hook runs (provides instant display)
- Deleted on logout alongside existing caches

**Risk**: Low. Follows established patterns. No write-through complexity — cache is populated explicitly by the fetch hook, not by observing other paths.
**Commit**: `feat(CINNY-003g): persist fetched thread summaries to IndexedDB`

### Phase 4: Clean up dead code (from Plan B)
**Scope**: Remove or mark `buildThreadSummaryMap(loadedTimelineEvents)` usage.

- The `threadSummaryInfoMap` memo always produces an empty map with `threadSupport: true`
- Remove the fallback parameter from `getThreadSummaryInfo` (replaced by fetch hook + cache)
- Keep `buildThreadSummaryMap` function itself (may be useful for other contexts)

**Risk**: Low. Removing dead code paths.
**Commit**: `refactor(CINNY-003g): remove dead thread summary fallback path`

---

## Summary Table

| Criterion | Plan A (Cache) | Plan B (Fetch) | Hybrid |
|-----------|---------------|----------------|--------|
| Cold-start correctness | No | Yes | Yes |
| Cross-session persistence | Yes | No | Yes |
| Network independence | Yes | No | Partial (cached data available offline) |
| API overhead | None | Per-thread-root | Per-thread-root, once per session |
| Implementation complexity | Medium | Medium-Low | Medium |
| Dead code awareness | No | Yes | Yes |

**Final recommendation: Implement the hybrid approach in the phased order above.** Phase 1 is a quick win. Phase 2 is the core fix. Phase 3 adds durability. Phase 4 cleans up.
