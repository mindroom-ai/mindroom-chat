# MindRoom Cache Strategy

This document is the short operational runbook for MindRoom room/thread caching in the Cinny fork.
It complements the longer thread architecture plan by answering: what is cached, who owns it, when
cached data can drive UI, and which fallback patterns are forbidden.

## Core Model

```text
Matrix live events
  -> raw IndexedDB event caches
  -> cache coverage facts
  -> current-room ThreadRecord index
  -> read-only view models
  -> React components
```

Rules:

- Matrix live events are the source of truth.
- IndexedDB caches are persisted mirrors of Matrix events plus coverage metadata.
- Cache coverage describes what a cached snapshot proves. Cached data without coverage is only a
  best-effort preview, not a pagination or completeness decision.
- `ThreadRecord` is the canonical current-room read model for summaries, counts, previews, tags,
  status, activity, and cache coverage.
- UI components and row renderers must not read IndexedDB directly.

## Cache Layers

| Layer | Owner | Purpose | Persistence |
| --- | --- | --- | --- |
| Room event cache | `src/app/mindroom/threads/roomEventCache.ts` behind `eventRepository.ts` | Persist main-room timeline events and room backward-pagination anchors. | IndexedDB, session-scoped. |
| Thread event cache | `src/app/mindroom/threads/threadEventCache.ts` behind `eventRepository.ts` | Persist per-thread root/reply events and thread coverage metadata. | IndexedDB, session-scoped. |
| Thread open seed cache | `src/app/mindroom/threads/threadOpenSeedCache.ts` | Keep a small fast-open seed for recently opened or room-derived threads. | In-memory weak map keyed by `Room`. |
| Summary cache/store | `src/app/mindroom/threads/threadSummaryCache.ts`, `threadSummaryState.ts`, `threadSummaryStore.ts` | Persist and expose MindRoom AI thread summaries for fast startup and shared UI updates. | IndexedDB/state through the store boundary. |
| Overview cached metadata | `src/app/mindroom/threads/threadOverviewCacheMetadata.ts` | Hold transient cached preview/activity/count/coverage facts used by the current room index. | React state, reset per room. |
| Current-room thread index | `src/app/mindroom/threads/useMindroomThreadIndex.ts` plus lower selectors | Build normal and compact `ThreadRecord` maps from live events, cached metadata, tags, summaries, and scheduled status. | Derived in memory. |

## Write Owners

Only these modules should write cache state:

- `roomCacheLifecycleController.ts`: persists current-room main timeline events and refreshes cached
  room backward state.
- `roomCacheHydrationController.ts`: hydrates the room timeline from latest cached room events.
- `roomPaginationCommandController.ts`: reads cached room pages before falling back to network
  back-pagination.
- `threadCachePersistenceController.ts`: persists thread snapshots, including room-derived thread
  cache updates.
- `threadOpenCacheController.ts`: hydrates an opened thread from cache, backfills relations, and
  refreshes the latest thread slice.
- `threadPaginationCommandController.ts`: reads cached thread pages before network pagination.
- `threadOverviewCacheHydration.ts`: reads cached thread pages for overview cards and applies
  transient overview metadata updates.
- `roomLiveEventController.ts`: writes through live room events, supplemental thread updates, and
  summary-event state changes.

If a new feature needs cached room/thread data, it should call one of these owners or add a narrow
method to `eventRepository.ts`. It should not import `roomEventCache.ts` or `threadEventCache.ts`
from a render component.

## Read Owners

| Consumer | Allowed cache input |
| --- | --- |
| `useMindroomThreadIndex` | Cached overview metadata and summary store output. |
| `ThreadRecord` builders | `ThreadCacheCoverage` and record-level presentation/status snapshots. |
| Compact cards, badges, headers, recent threads, command palette | `ThreadRecord` or a view model derived from `ThreadRecord`. |
| Thread open lifecycle | `threadOpenCacheController`, `threadOpenCacheFirst`, seed cache, SDK thread state. |
| Room and thread pagination commands | Cached pagination snapshots from `eventRepository.ts`. |

Any production UI surface that wants summary text, latest reply preview, message count, tags,
scheduled state, or resolved state should consume a `ThreadRecord`-derived model.

## Coverage Semantics

`ThreadCacheCoverage` lives in `src/app/mindroom/threads/types.ts` and is interpreted by
`threadCacheCoverage.ts`.

| Field | Meaning |
| --- | --- |
| `eventCount` | Number of cached events represented by the snapshot or record input. |
| `oldestTs` / `newestTs` | Timestamp bounds for cached facts when known. |
| `backwardToken` | `string` means an older cached/network page may exist; `null` means the start is known; `undefined` means not proven. |
| `hasMoreBackward` | Explicit older-page fact. Defaults to true when `backwardToken` is a string. |
| `snapshotComplete` | The cached thread snapshot appears complete for the expected local event set. |
| `relationSnapshotComplete` | Relation/reply metadata has been fetched or reconstructed for the cached snapshot. |
| `tailLoaded` | The latest/tail side of the thread has been loaded. |
| `expectedReplyCount` | Best known reply count from root relation metadata, SDK thread state, or cache metadata. |

Important derived decisions:

- `isCompleteThreadCacheCoverage(...)` requires a local snapshot, `snapshotComplete`,
  `relationSnapshotComplete`, `tailLoaded`, and a known backward start.
- `shouldBackfillThreadRelationsFromCoverage(...)` is true when a local snapshot exists but
  snapshot or relation coverage is incomplete.
- `shouldShowThreadLoadOlderFromCoverage(...)` is true when the SDK has a backward token or cache
  coverage proves a backward gap.

Coverage is conservative. Unknown is not the same as complete.

## Merge Rules

- Newer event-derived live data wins over older cached data.
- Cached data may fill missing live data during startup or resume.
- Cached activity, latest-reply preview, sender, and message count should only upgrade current
  index facts when the cached snapshot is newer or strictly richer.
- Cached summaries can be shown first, but live/newer summaries should replace them through
  `threadSummaryStore`.
- Cached compact-root body text is an index input used to construct records. It is not a per-row
  render fallback.
- Optimistic/pending tag writes live in `threadTagPending.ts` and are merged by tag snapshot
  selectors; they are not part of the raw event cache.

When two surfaces disagree, fix the selector, cache metadata update, or `ThreadRecord` builder.
Do not add surface-local precedence logic.

## Main Flows

### Cold Room Open

1. `roomCacheHydrationController.ts` loads latest cached room events.
2. Cached room events are mapped into Matrix events and inserted into the room timeline when they
   are not already loaded.
3. `useMindroomThreadIndex` derives room surface entries and `ThreadRecord` maps.
4. `threadOverviewCacheHydration.ts` warms visible/relevant thread metadata from cached thread
   pages.
5. Live sync and relation fetches upgrade the same records as fresher data arrives.

### Compact Overview Resume

1. Current room records are built from live room events and current cached metadata.
2. Overview hydration reads cached thread pages for visible or relevant roots.
3. Fetched/cached relation pages update `threadOverviewCacheMetadata`.
4. `useMindroomThreadIndex` rebuilds records from that metadata.
5. Cache writes continue asynchronously; the UI should not wait for a write/read round trip.

### Thread Open

1. `threadOpenSeedController.ts` applies a fast seed from live room events, recent cached seed data,
   or current thread model state.
2. `threadOpenCacheController.ts` hydrates the opened thread from cached thread pages.
3. Coverage decides whether the cache is complete enough to avoid extra relation backfill.
4. SDK bootstrap and network relation fetches fill gaps.
5. New live/cached events are persisted by `threadCachePersistenceController.ts`.

### Back Pagination

1. Room and thread pagination commands ask `eventRepository.ts` for cached pages first.
2. If cache returns events, those are prepended with scroll anchoring preserved.
3. If cache metadata proves the start, stale SDK backward tokens are cleared.
4. If cache misses or proves a gap, the command falls back to Matrix SDK pagination.

### Eager Preload

1. Preload is current-room only.
2. `preloadSettings.ts` sets `DEFAULT_PAGINATION_LIMIT = 10000`, `MIN_PAGINATION_LIMIT = 50`, and
   `THREAD_BATCH_SIZE = 200`.
3. Raising the limit increases how much current-room history the client attempts to warm and cache.
4. Preload should not fetch unrelated rooms from a room timeline screen.

## Forbidden Patterns

Do not add:

- `loadLatestCachedThreadEvents(...)` or `loadLatestCachedThreadSummaryInfo(...)` calls from row
  renderers or React components.
- Component-local maps for summary, latest reply, message count, tags, scheduled state, or activity
  when a `ThreadRecord` field can represent the fact.
- Fallbacks that do not state which coverage condition makes them safe.
- Independent compact-view, normal-view, recent-thread, and command-palette precedence rules.
- Cache writes that bypass `eventRepository.ts` or the controller owners above.
- Cross-room eager preload from a current-room screen.

## Review Checklist

For any cache-related change:

- Which cache layer does it read or write?
- Is the caller an allowed owner?
- Does the UI consume `ThreadRecord` or a record-derived view model?
- What coverage fact proves pagination, completeness, or relation freshness?
- Does the change preserve scroll anchoring for prepends?
- Does cached data only fill missing/older data, instead of overriding fresher live data?
- Are focused tests covering cached-only, live-only, and mixed cached/live states?

If any answer is unclear, update this document before adding another fallback path.
