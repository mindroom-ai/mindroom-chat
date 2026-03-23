# CINNY-003g: AI Summaries Intermittently Missing — Root Cause & Fix Plan

## Root Cause Analysis

### The Data Flow

`getThreadSummaryInfo` (RoomTimeline.tsx:421-439) has two paths to find the summary:

1. **Primary path**: `room.getThread(eventId)?.events` — searches the SDK Thread model's events for the latest `io.mindroom.thread_summary` event.
2. **Fallback path**: `threadSummaryInfoMap.get(mEventId)` — built from `buildThreadSummaryMap(loadedTimelineEvents)`, which scans the room's loaded timeline.

### Why both paths fail intermittently

**Primary path failure — Thread events not populated:**

The SDK creates Thread models lazily. With `threadSupport: true` (enabled in `initMatrix.ts:79,97`), `room.getThread(eventId)` may exist but its `.events` array is empty or doesn't contain the summary event. Thread events are only populated when:

- Events arrive via `/sync` (only recent activity)
- The user previously opened that thread (triggers `mx.getThreadTimeline()`)
- Thread relations were explicitly fetched via `mx.fetchRelations()`

When none of these have occurred (e.g., older thread, room re-entry after app restart), `thread.events` is empty and the summary is not found.

**Fallback path failure — Dead code:**

With `threadSupport: true`, the SDK's `eventShouldLiveIn()` (room.js:2100-2107) returns `shouldLiveInRoom: false` for thread reply events (including summary events). They are stored ONLY in the Thread's timeline, NOT in the room's main timeline.

Therefore `loadedTimelineEvents` (RoomTimeline.tsx:2549-2556, which reads from `timeline.linkedTimelines`) NEVER contains summary events. `buildThreadSummaryMap(loadedTimelineEvents)` always produces an empty map.

The fallback is effectively dead code.

### Contrast with thread reply counts (which always work)

`getThreadReplyCount` (RoomTimeline.tsx:370-395) has a working data source that summaries lack: **server-aggregated metadata** in the thread root event's unsigned field (`mEvent.getUnsigned()?.['m.relations']?.['m.thread']?.count`). This is baked into the event by the server and always available. Thread summaries have no equivalent server-side aggregation — they're custom events that must be found by iterating thread events.

### Secondary issue: Live event re-render gap

When a summary event arrives as a live event via sync:
1. The SDK adds it to the Thread's timeline
2. The Room re-emits `RoomEvent.Timeline` (room.js:2191 — room re-emits from threads)
3. `useLiveEventArrive` fires (RoomTimeline.tsx:803)
4. `isThreadOnlyRoomActivity` returns `true` (it has `threadRootId` set)
5. Re-render ONLY occurs if `atBottomRef.current` is `true` (RoomTimeline.tsx:1604-1607)
6. If user has scrolled up → no re-render → summary card doesn't appear

### Confirmed hypotheses from the original hypothesis space

- **H2 (Thread event loading)**: Confirmed as primary root cause
- **H3 (Race condition)**: Partially confirmed — live events only trigger re-render at bottom
- **H1 (Timeline pagination)**: Not a factor — summary events aren't in the room timeline at all
- **H4 (Event filtering)**: Not a factor — `m.notice` isn't filtered; `isRenderableEvent` filters by `threadRootId`, not msgtype
- **H5 (Cache staleness)**: Partially relevant — the fallback path reads from room timeline which is cache-populated, but thread events aren't cached there

---

## Fix Strategy

### Approach A: Proactive thread summary fetch (Recommended)

Proactively fetch the latest summary event for each visible thread root that doesn't already have summary data. This mirrors how `getThreadReplyCount` doesn't need full thread events — it uses server-aggregated data. Since there's no server aggregation for summaries, we fetch the specific event.

#### Step 1: Create a `useThreadSummaries` hook

**File**: `src/app/features/room/useThreadSummaries.ts` (new)

```ts
// For each visible thread root event ID, if room.getThread(id)?.events
// doesn't contain a summary event, fetch the thread's latest events
// (a small page) to check for a summary event.
//
// Returns: Map<threadRootId, MindroomThreadSummaryInfo>
```

Implementation:
1. Accept a list of visible thread root event IDs
2. For each ID, check `room.getThread(id)?.events` for an existing summary
3. If none found, call `mx.fetchRelations(roomId, threadRootId, 'm.thread', null, { limit: 50 })` to get the latest thread events
4. Search the fetched events for `io.mindroom.thread_summary` metadata
5. Cache results in a `Map` (or `useRef`) to avoid re-fetching on every render
6. Also feed fetched events into `thread.addEvents()` so the SDK model is populated for future use

This hook runs lazily — only for thread roots visible in the viewport (determined by `activeTimelineRange`).

#### Step 2: Integrate into RoomTimeline.tsx render

Replace the current `threadSummaryInfoMap` lookup with the hook's output:

```ts
// Before:
const summaryInfo = !threadId && !isThreadReply && mEventId
  ? getThreadSummaryInfo(room, mEvent, threadSummaryInfoMap.get(mEventId))
  : undefined;

// After:
const summaryInfo = !threadId && !isThreadReply && mEventId
  ? getThreadSummaryInfo(room, mEvent, fetchedSummaryMap.get(mEventId))
  : undefined;
```

Where `fetchedSummaryMap` comes from the new hook.

#### Step 3: Fix live event re-render gap

In `useLiveEventArrive` handler (RoomTimeline.tsx:1604), when a thread-only event arrives that is a summary event, force a re-render regardless of scroll position:

```ts
if (isThreadOnlyActivity) {
  // Always re-render when a summary event arrives, even if not at bottom
  if (atBottomRef.current || isMindroomThreadSummaryEvent(mEvt)) {
    setTimeline((ct) => ({ ...ct }));
  }
  // ... existing unread logic
  return;
}
```

This ensures summary cards appear immediately when the AI generates them, regardless of scroll position.

### Approach B: Batch pre-fetch on room entry (Simpler alternative)

On room entry, after the main timeline loads, iterate all thread root events in the visible range and pre-fetch their thread events via `mx.getThreadTimeline()`. This populates the SDK Thread models so `getThreadSummaryInfo`'s primary path works.

**Pros**: Simpler — no new hook, just adds a `useEffect` that fetches thread timelines
**Cons**: More API calls (fetches all thread data, not just summary events), slower initial load

### Approach C: SDK event listener (Complementary)

Listen for `ThreadEvent.Update` or `ThreadEvent.NewReply` on the room to trigger re-renders when thread events become available:

```ts
useEffect(() => {
  const handler = () => setTimeline((ct) => ({ ...ct }));
  room.on(ThreadEvent.Update, handler);
  room.on(ThreadEvent.NewReply, handler);
  return () => {
    room.removeListener(ThreadEvent.Update, handler);
    room.removeListener(ThreadEvent.NewReply, handler);
  };
}, [room]);
```

This doesn't fix the missing-data problem but ensures re-renders when thread data arrives asynchronously.

---

## Recommended Implementation Plan

Combine Approaches A and C for a complete fix:

### Phase 1: Fix live event handling (Step 3 above)
- Modify `useLiveEventArrive` handler for immediate summary display
- Also add `ThreadEvent.Update`/`ThreadEvent.NewReply` listeners (Approach C)
- Minimal code change, addresses the race condition
- Commit: "fix(CINNY-003g): re-render room timeline when thread summary events arrive"

### Phase 2: Proactive summary fetch (Steps 1-2 above)
- Create `useThreadSummaries` hook
- Integrate into render pipeline
- Handles cold-start / room re-entry case
- Commit: "feat(CINNY-003g): proactively fetch thread summaries for visible thread roots"

### Phase 3: Clean up dead fallback code
- Remove or document the `buildThreadSummaryMap(loadedTimelineEvents)` fallback since it's dead code with `threadSupport: true`
- Keep `buildThreadReplyCountMap` and `buildThreadParticipantMap` — they have the same issue but are backed by working primary paths (server-aggregated data for counts, SDK thread events for participants)
- Commit: "refactor(CINNY-003g): remove dead summary fallback path"

---

## Key Files

| File | Role |
|------|------|
| `src/app/features/room/RoomTimeline.tsx:421-439` | `getThreadSummaryInfo` — the broken lookup |
| `src/app/features/room/RoomTimeline.tsx:2566-2572` | `threadSummaryInfoMap` — dead fallback |
| `src/app/features/room/RoomTimeline.tsx:1600-1611` | Live event handler — conditional re-render |
| `src/app/components/message/mindroomThreadSummary.ts:158-176` | `buildThreadSummaryMap` — dead code |
| `src/client/initMatrix.ts:79,97` | `threadSupport: true` — causes SDK to filter threads |
| `node_modules/matrix-js-sdk/lib/models/room.js:2100-2107` | `eventShouldLiveIn` — `shouldLiveInRoom: false` for thread events |
| `node_modules/matrix-js-sdk/lib/models/room.js:2191` | Room re-emits `RoomEvent.Timeline` from threads |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `mx.fetchRelations()` adds API load on room entry | Medium | Fetch only for visible thread roots, cache results, use small `limit` |
| `ThreadEvent.Update` listener causes excessive re-renders | Low | Debounce or batch updates |
| Thread events fetched via `fetchRelations` may not fully populate SDK Thread model | Medium | Explicitly call `thread.addEvents()` with fetched events |
| Breaking `buildThreadSummaryMap` callers in test code | Low | Update tests to reflect the new hook |
