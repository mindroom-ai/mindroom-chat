# CINNY-003g: AI Summaries Intermittently Missing — Implementation Plan

## 1. Root Cause Analysis

Thread summary lookup uses two paths (in `getThreadSummaryInfo`, `RoomTimeline.tsx:421-439`):

### Path 1: SDK Thread object
```ts
const thread = room.getThread(eventId);
// -> thread?.events -> findLatestThreadSummaryEvent(thread.events)
```
**Fails when**: Thread object doesn't exist or has an empty/incomplete `events` array. This happens when:
- The thread hasn't been opened in the current session (no `getThreadTimeline()` call was made)
- The SDK hasn't received the summary event in recent sync responses
- The SDK lazily populates thread events; on room re-entry, thread objects may exist but with sparse event arrays

### Path 2: Room timeline fallback
```ts
const threadSummaryInfoMap = buildThreadSummaryMap(loadedTimelineEvents);
// -> scans all events in timeline.linkedTimelines for summary events
```
**Fails when**: The summary event is outside the room's current live timeline window. Additionally:
- **Critical**: The room event cache **explicitly excludes** thread reply events via `isThreadOnlyRoomActivity` filter (`RoomTimeline.tsx:1366`). Summary events ARE thread replies (they have `threadRootId !== eventId`), so they're never saved to the room event cache.
- On room re-entry, `getInitialTimeline(room)` gets the SDK's in-memory live timeline, which may have been truncated.
- Backward pagination uses the room event cache, which doesn't contain summary events.

### When both fail simultaneously (the bug):
1. User enters a room with threads that have summaries
2. Thread wasn't opened in this session → Path 1 fails (no thread events)
3. Summary event is older than the SDK's current live timeline window → Path 2 fails
4. Even backward pagination via room cache won't help because summaries are excluded from the cache

### Why it's intermittent:
- **Works** when: summary is recent (in sync batch), OR thread was previously opened (SDK has events), OR the timeline window is large enough to include the summary event
- **Fails** when: room re-entry with truncated timeline + unopened thread
- **Navigation-dependent**: different navigation patterns affect SDK timeline state and which events are in memory

## 2. Solution: Dedicated Thread Summary Cache

Create a lightweight, persistent cache that stores `MindroomThreadSummaryInfo` keyed by `(roomId, threadRootId)`. This decouples summary availability from timeline/thread event loading state.

### Design

#### 2a. New IndexedDB store: `mindroom-thread-summary-cache`

A simple key-value store:
```ts
type CachedThreadSummaryRecord = {
  cacheKey: string;        // `${roomId}|${threadRootId}`
  roomId: string;
  threadRootId: string;
  summaryText: string;
  generatedTs?: number;
  messageCount?: number;
  updatedAt: number;       // Date.now() when cached
};
```

API:
```ts
// Save a summary (upsert)
saveCachedThreadSummary(sessionId, roomId, threadRootId, info): Promise<void>

// Load summaries for a room (batch — all thread summaries for a room)
loadCachedThreadSummaries(sessionId, roomId): Promise<Map<string, MindroomThreadSummaryInfo>>

// Delete the cache (on logout, like other caches)
deleteThreadSummaryCache(sessionId): Promise<void>
```

#### 2b. In-memory layer: `Map<string, MindroomThreadSummaryInfo>`

A React state/ref holding the cached summaries for the current room, populated on room entry from IndexedDB and updated as new summaries are discovered.

#### 2c. Integration into `RoomTimeline.tsx`

**On room entry** (via useEffect):
1. Load cached summaries from IndexedDB for the current room
2. Store in state as `cachedSummaryMap`

**In `getThreadSummaryInfo`** (modified):
```ts
const getThreadSummaryInfo = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackInfo?: MindroomThreadSummaryInfo,
  cachedInfo?: MindroomThreadSummaryInfo   // NEW: from persistent cache
): MindroomThreadSummaryInfo | undefined => {
  const eventId = mEvent.getId();
  if (eventId) {
    const thread = room.getThread(eventId);
    if (thread?.events?.length) {
      const summaryEvent = findLatestThreadSummaryEvent(thread.events);
      if (summaryEvent) {
        const info = getThreadSummaryEventInfo(summaryEvent);
        if (info?.summaryText) return info;
      }
    }
  }

  return fallbackInfo ?? cachedInfo;  // CHANGED: added cache fallback
};
```

**On summary discovery** (write-through):
When either Path 1 or Path 2 finds a summary, persist it to both:
- The in-memory `cachedSummaryMap` (for current render cycle)
- IndexedDB (for future sessions)

This can be done via a useEffect that diffs the computed summaries against the cache.

#### 2d. Cache invalidation

- **Updated summary**: When a newer summary is found (by `generatedTs` or by seeing a new summary event), overwrite the cached entry
- **Session cleanup**: Delete cache on logout (alongside existing `deleteThreadEventCache` / `deleteRoomEventCache` calls in `initMatrix.ts`)

## 3. Alternatives Considered

### 3a. Fix room event cache to include summary events
- Modify `isThreadOnlyRoomActivity` to exempt summary events from filtering
- **Pro**: Simpler, no new storage
- **Con**: Only helps if the summary event was in the room timeline when it was cached. Doesn't solve Path 1 failure. Still pagination-dependent.

### 3b. Fetch thread events on demand
- Call `fetchRelations()` for visible thread roots missing summaries
- **Pro**: Always gets latest data from server
- **Con**: N+1 network requests per visible thread. Visible latency. Needs debouncing/batching. Complex error handling.

### 3c. Use Matrix room state events
- Have MindRoom send summaries as state events (always loaded with room state)
- **Pro**: Most reliable — state events are always available
- **Con**: Requires MindRoom backend changes. State events have different semantics (unique per `state_key`). Not suitable as a client-only fix.

### 3d. In-memory-only cache (no IndexedDB)
- Cache summaries in a module-level `Map` that persists across room navigations but not page reloads
- **Pro**: Simplest implementation
- **Con**: Summaries still missing on first visit after page load. Only partially solves the problem.

**Chosen**: Option 2 (dedicated persistent cache) because:
- Solves the problem completely (works across sessions)
- Minimal storage overhead (just summary text + metadata per thread)
- Follows existing patterns (mirrors `threadEventCache.ts` / `roomEventCache.ts` architecture)
- No backend changes required

## 4. Implementation Steps

### Step 1: Create `threadSummaryCache.ts`
- **File**: `src/app/features/room/threadSummaryCache.ts`
- IndexedDB-backed cache with `saveCachedThreadSummary`, `loadCachedThreadSummaries`, `deleteThreadSummaryCache`
- Follow patterns from `threadEventCache.ts` for DB lifecycle
- Typecheck + build

### Step 2: Wire cache deletion into session cleanup
- **File**: `src/client/initMatrix.ts`
- Add `deleteThreadSummaryCache()` alongside existing `deleteThreadEventCache()` / `deleteRoomEventCache()` calls
- Typecheck + build

### Step 3: Add cache loading and state to `RoomTimeline.tsx`
- Add `cachedSummaryMap` state, loaded from IndexedDB on room entry via useEffect
- Modify `getThreadSummaryInfo` to accept and use cached fallback
- Pass `cachedSummaryMap` into the render path alongside `threadSummaryInfoMap`
- Typecheck + build

### Step 4: Add cache write-through on summary discovery
- When summaries are found via Path 1 or Path 2, persist to IndexedDB
- Use a useEffect that watches `threadSummaryInfoMap` and the computed summaries
- Diff against cached values to avoid redundant writes
- Typecheck + build

### Step 5: Handle live summary updates
- When a new timeline event arrives (in `useTimeline` handler) that is a summary event, update both the in-memory cache and IndexedDB
- Ensures streaming/updated summaries are cached immediately
- Typecheck + build

### Step 6: Tests
- Unit tests for `threadSummaryCache.ts` (IDB operations)
- Update `RoomTimeline.test.ts` mocks for `buildThreadSummaryMap` if needed
- Run full test suite

### Step 7: Update `FORK_CHANGES.md`
- Document CINNY-003g changes in Runbook section

## 5. Files Modified

| File | Action | Description |
|------|--------|-------------|
| `src/app/features/room/threadSummaryCache.ts` | **Create** | New IndexedDB-backed thread summary cache |
| `src/app/features/room/RoomTimeline.tsx` | **Edit** | Load/use/write-through cached summaries |
| `src/client/initMatrix.ts` | **Edit** | Add cache deletion on logout |
| `FORK_CHANGES.md` | **Edit** | Document CINNY-003g |

## 6. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stale cached summary (summary updated but cache not) | Low | Write-through on discovery; `generatedTs` comparison for freshness |
| IndexedDB unavailable (private browsing) | Low | Graceful degradation — falls back to existing Path 1 + Path 2 behavior |
| Cache grows unbounded over time | Low | Small per-entry size (~200 bytes). Could add LRU eviction later if needed |
| Race between cache load and first render | Medium | First render may not have cache; useEffect updates state causing re-render with cached data. Brief flash of missing summary on first load. |
| Multiple summary events per thread (updates) | Low | `findLatestThreadSummaryEvent` already selects the latest; cache upsert overwrites older data |

## 7. Key Observations for Implementation

1. **`isThreadOnlyRoomActivity` at line 557-568**: This is the function that excludes summary events from the room event cache. Summary events have `threadRootId !== mEventId`, making them "thread only" activity. Do NOT modify this filter — it correctly keeps the room cache lean. Instead, use the dedicated summary cache.

2. **`loadedTimelineEvents` at line 2549-2556**: Depends on `timeline` state (reference equality). When `timeline` changes (e.g., pagination), `loadedTimelineEvents` recomputes, which recomputes `threadSummaryInfoMap`. The cached summary map provides stability across these recomputations.

3. **`buildThreadSummaryMap` at line 158-176 of `mindroomThreadSummary.ts`**: Iterates events backward, looking for `isMindroomThreadSummaryEvent` matches. It maps `threadRootId -> info`. The cache mirrors this structure.

4. **Two render paths**: Unencrypted messages (line 2606-2608) and encrypted messages (line 2757) both call `getThreadSummaryInfo`. Both need the cached fallback.

5. **Thread event cache already stores summary events**: When a thread is opened, `saveThreadEventsToCache` stores all thread events including summaries. But this cache is keyed by `(roomId, threadId)` and only loaded when opening a thread view, not when rendering room-level timeline. The new summary cache provides a lightweight index specifically for room-level rendering.
