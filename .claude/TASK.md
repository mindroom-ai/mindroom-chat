# CINNY-003g Implementation: Reliable AI Summary Display with IndexedDB Cache

Read `PLAN.md` for the full analysis. Key insight: thread summary events are never in the room timeline when `threadSupport: true` — SDK routes them to Thread models, which are empty for unopened threads.

## What to build

### 1. IndexedDB Thread Summary Cache (`src/app/utils/threadSummaryCache.ts`)
- New file with IndexedDB-backed cache for thread summaries
- Schema: `{ roomId, threadRootId, summaryText, summaryEventId, generatedTs, messageCount, updatedAt }`
- Functions:
  - `getThreadSummaryFromCache(roomId, threadRootId)` → cached summary or null
  - `setThreadSummaryInCache(roomId, threadRootId, summaryData)` → store/update
  - `getAllThreadSummariesForRoom(roomId)` → all cached summaries for a room (for bulk lookup)
- Use `idb` package if available, or raw IndexedDB API. Check what the project already uses for IndexedDB.

### 2. Proactive Summary Fetch (`src/app/utils/mindroomThreadSummary.ts`)
- New async function: `fetchThreadSummary(mx, roomId, threadRootId)` → fetches thread relations, finds summary event, returns summary data
- Uses `mx.fetchRelations(roomId, threadRootId, 'm.thread', null, { limit: 50, dir: 'b' })` to get recent thread events
- Filters for summary events (check `io.mindroom.thread_summary` in content)
- On success, writes to IndexedDB cache

### 3. Integration in RoomTimeline.tsx
- Modify `getThreadSummaryInfo` (or the `summaryInfo` computation around line 421-439):
  1. First check: SDK thread.events (current path — works for recently synced threads)
  2. Second check: IndexedDB cache (new — instant, no network)
  3. Third check: async fetch via `fetchThreadSummary` (new — network, then cache)
- For the async path, use a React state + useEffect pattern:
  - On mount/timeline change, check which thread roots are missing summaries
  - Kick off async fetches for those, update state when results come in
  - This triggers re-render showing the summary cards

### 4. Cache Invalidation
- When a new `m.thread.summary` event arrives via sync (in `useLiveEventArrive` or similar), update the IndexedDB cache
- The existing `summaryInfo` computation for live events should already work — just also write to cache

## Important details
- Don't break the existing path that works for recently synced threads
- The IndexedDB operations should be fire-and-forget (don't block rendering)
- Handle errors gracefully — if IndexedDB is unavailable, fall back to fetch-only
- Limit concurrent fetches (don't fire 50 fetch requests at once — batch/queue them)

## Validation
- `npx vitest run` — all tests pass
- `npm run build` — succeeds

## Output
Write results to `.claude/REPORT.md`
