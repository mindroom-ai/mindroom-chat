# MindRoom Thread Architecture Refactor Plan

## Purpose

This plan defines the target architecture for MindRoom-specific room/thread behavior in the
Cinny fork. The goals are:

- Make room and thread behavior fast from cache without treating cache as a second source of truth.
- Remove duplicated derivation of summaries, tags, counts, previews, activity, and status.
- Keep upstream Cinny file diffs small so future rebases are predictable.
- Make each refactor step behavior-preserving and independently testable.

## Current Problem

MindRoom thread behavior is currently spread across large upstream-adjacent files and multiple
fork-owned helper modules. The same facts are derived in several places:

| Fact                                       | Current duplication risk                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary text and message count             | Parsed from events, persisted in summary cache, extracted from thread event cache, merged in `RoomTimeline`, compact view, recent threads, and command palette. |
| Root preview and latest reply preview      | Built in presentation helpers, overview metadata, compact cards, recent-thread helpers, and command palette.                                                    |
| Tags and resolved state                    | Aggregated in room-level hooks, single-thread hooks, command palette, and component-local fallbacks.                                                            |
| Streaming, scheduled, unread, and activity | Calculated in hooks, overview metadata, compact cards, and command palette.                                                                                     |
| Cache hydration                            | Room event cache, thread event cache, summary cache, seed cache, and overview hydration each expose partial views of the same room/thread state.                |

The largest risk is that UI components remain smart. A component should not decide how to merge
Matrix state, cached state, and fallback state. It should receive a view model and render it.

## Core Principle

There is one source of truth and several derived layers:

```text
Matrix events
  -> persisted raw event cache
  -> derived thread index
  -> read-only view models
  -> React components
```

Rules:

- Matrix events are the truth.
- IndexedDB raw event cache is a persisted mirror of Matrix events plus coverage metadata.
- Derived indexes are materialized views rebuilt from live and cached events.
- React view models are read-only projections for specific UI surfaces.
- Components do not read IndexedDB directly.
- Components do not independently re-derive summary, tags, counts, previews, or status.

## Rebase Constraint

MindRoom-specific logic should live in fork-owned modules. Upstream Cinny files should contain only
narrow integration seams.

Good upstream touchpoint:

```tsx
const threadModels = useMindroomThreadIndex(room, inputs);
```

Good render seam:

```tsx
<MindroomThreadBadge model={model.badge} />
```

Bad upstream touchpoint:

```tsx
const summary = pickLatestThreadSummaryInfo(...);
const cached = await loadLatestCachedThreadSummaryInfo(...);
const tags = aggregateThreadTagEvents(...);
```

Target namespace:

```text
src/app/mindroom/threads/
  summaryCodec.ts
  eventRepository.ts
  summaryStore.ts
  tagStore.ts
  statusIndex.ts
  presentation.ts
  threadIndex.ts
  threadViewModels.ts
  preloadController.ts
  types.ts
```

Existing fork modules can be moved or wrapped into this namespace in small steps. Do not perform a
large directory move until behavior is already stabilized.

## Target Ownership

| Owner               | Responsibility                                                                                | Must not do                                       |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `summaryCodec`      | Parse MindRoom summary events and choose latest summary info.                                 | Read cache, subscribe to React state, inspect UI. |
| `eventRepository`   | Read/write raw room and thread events plus coverage metadata in IndexedDB.                    | Build UI view models.                             |
| `summaryStore`      | Store in-memory summary state and persist summary index records if needed for fast startup.   | Re-parse unrelated thread metadata.               |
| `tagStore`          | Aggregate tag and resolved state, including pending optimistic tag writes.                    | Render tag UI.                                    |
| `statusIndex`       | Derive streaming, scheduled, unread, activity, participants, and reply count.                 | Read component props or local UI state.           |
| `presentation`      | Derive summary text, root preview, latest reply preview, title text, and fallback labels.     | Read IndexedDB directly.                          |
| `threadIndex`       | Build one canonical per-room map of `ThreadRecord` keyed by `threadRootId`.                   | Render React components.                          |
| `threadViewModels`  | Convert `ThreadRecord` into compact card, badge, header, sidebar, and command-palette models. | Fetch Matrix relations or mutate cache.           |
| `preloadController` | Decide what to warm, fetch, persist, and index for the current room.                          | Render UI or set component-local fallback maps.   |

## Target Types

The exact shape can evolve, but the architecture should converge on these concepts.

```ts
type ThreadId = {
  roomId: string;
  threadRootId: string;
};

type ThreadPresentationSnapshot = {
  summaryText?: string;
  summaryGeneratedTs?: number;
  messageCount: number;
  rootPreviewText?: string;
  latestReplyPreviewText?: string;
  titleText: string;
  subtitleText?: string;
  lastSenderId?: string;
  lastSenderDisplayName?: string;
  participantIds: string[];
};

type ThreadStatusSnapshot = {
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  lastActivityTs: number;
  tags: string[];
};

type ThreadCacheCoverage = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  relationSnapshotComplete: boolean;
  tailLoaded: boolean;
  expectedReplyCount?: number;
};

type ThreadRecord = ThreadId & {
  rootEventId?: string;
  presentation: ThreadPresentationSnapshot;
  status: ThreadStatusSnapshot;
  cache: ThreadCacheCoverage;
  absoluteIndex: number;
};
```

UI-specific view models should be derived from `ThreadRecord`:

```ts
type CompactThreadCardViewModel = {
  id: ThreadId;
  title: string;
  preview: string;
  replyCountLabel: string;
  statusLabel: string;
  tags: string[];
  participants: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledLabel?: string;
  lastActivityLabel?: string;
};
```

## Cache Model

Caching is required for fast startup, fast room re-entry, and fast thread opens. Cache should be
designed as persisted data plus coverage, not as component fallback state.

```ts
type CachedRoomSnapshot = {
  roomId: string;
  events: RawMatrixEvent[];
  coverage: {
    eventLimit: number;
    oldestKnownTs?: number;
    newestKnownTs?: number;
    backwardToken?: string | null;
    completeBackward: boolean;
  };
};

type CachedThreadSnapshot = {
  roomId: string;
  threadRootId: string;
  rootEvent?: RawMatrixEvent;
  events: RawMatrixEvent[];
  coverage: ThreadCacheCoverage;
};

type CachedThreadIndexRecord = ThreadRecord & {
  updatedAt: number;
  derivedFromEventIds: string[];
};
```

Cache rules:

- Raw cached events and live Matrix events feed the same indexer.
- Cached index records can be used for instant paint.
- Cached index records are replaceable materialized views, not truth.
- Summary cache should be merged into the thread index or treated as an index table, not queried ad hoc from UI code.
- A newer live event-derived value wins over older cached data.
- A cached value can fill missing live data until live data catches up.
- Coverage metadata must explain why "load more" is shown or hidden.

## Preload Model

Preloading should be owned by a room-scoped background controller.

```ts
type RoomPreloadPolicy = {
  roomId: string;
  eventLimit: number;
  includeThreadRelations: boolean;
  includeMediaMetadata: boolean;
  concurrency: number;
};
```

Expected behavior:

- Hydrate the current room from cached index records immediately.
- Load room timeline backwards until `eventLimit` or no more history.
- Discover all candidate thread roots from live and cached current-room events.
- Preload thread relations for current-room thread roots, including non-visible threads, within the policy budget.
- Persist raw events and update the derived thread index in batches.
- Notify React subscribers once per batch, not once per event or per card.
- Never preload unrelated rooms from the room timeline screen.

If `eventLimit` is raised from 10k to 100k, the controller should attempt to cache substantially
more of the current room history and associated thread relations, bounded by server pagination,
runtime cancellation, and browser storage limits.

## UI Surface Contract

Every surface should render from the same thread index and view-model layer:

| Surface                  | Input                                             |
| ------------------------ | ------------------------------------------------- |
| Compact room view        | `CompactThreadCardViewModel[]`                    |
| Normal room thread badge | `ThreadBadgeViewModel`                            |
| Thread context banner    | `ThreadHeaderViewModel` plus tag mutation actions |
| Recent threads sidebar   | `RecentThreadViewModel[]`                         |
| Command palette          | `CommandPaletteThreadViewModel[]`                 |
| Thread route open        | `ThreadRecord` plus cached/live event page        |

Forbidden patterns:

- `CompactThreadCard` calling Matrix hooks for status, tags, scheduled tasks, or activity.
- Recent-thread entries inventing independent fallback summary rules.
- Command palette scanning thread tags and activity with its own custom model.
- `RoomTimeline` directly reading summary cache or loading cached summary info for visible rows.
- Multiple independent maps for summary text, root preview, latest reply preview, message count, and activity where one `ThreadRecord` would suffice.

## Current Adoption Snapshot

This section should be updated after each refactor slice. It is intentionally concrete so we can
tell whether the new architecture is actually being used everywhere.

| Area                          | Current state                                                                                                                                                              | Next action                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Compact room cards            | Converted at the render seam. `CompactRoomView` receives the per-room `ThreadRecord` map, and `useCompactThreadCardViewModels` only adapts records into card models.       | Keep card rendering passive; do not reintroduce state/cache lookups here.                     |
| Normal room thread badge      | Converted at the render seam. `RoomTimeline` builds a per-room `ThreadRecord` map, badge view models are record-only, and badge JSX lives in a fork-owned renderer.       | Keep badge rendering passive; do not reintroduce direct reply/summary/status derivation here. |
| Filtering, sorting, counts    | Converted at the room helper seam. Overview filter/search/sort, status counts, tag counts, cache hydration, and `getThreadFilteredEvents` consume `ThreadRecord` maps. | Keep legacy `ThreadOverviewMetadata` helpers isolated in `roomThreadOverviewModel` until they can be deleted or split. |
| Thread context banner         | Converted at the header seam. The banner builds a `ThreadRecord` and renders summary, tags, resolved state, and scheduled state through `ThreadHeaderViewModel`.            | Keep mutation permissions/actions outside the record; do not reintroduce local summary logic. |
| Recent threads sidebar        | Converted at the entry seam. `RecentThreadEntry` renders a MindRoom-owned `RecentThreadViewModel` built from `ThreadRecord`; the old `useRecentThreadSummary` path is gone. | Replace the remaining stored-entry plumbing with a room index subscription when available.    |
| Command palette               | Converted at the thread-item seam. Thread items now build `ThreadRecord` objects and render a MindRoom-owned `CommandPaletteThreadViewModel`.                              | Keep remaining action/user/room logic separate; do not reintroduce thread-specific derivation. |
| Summary ownership             | Mostly converted. Room view owns shared summary state, and `RoomTimeline` no longer performs per-visible `loadLatestCachedThreadSummaryInfo` render-path reads.            | Merge remaining summary cache/index helpers behind a fork-owned summary owner.                |
| Room/thread cache and preload | Started. Timeline renderability, room-surface entry derivation, preload counts, eager current-room preload, and raw event cache access now have seams outside `RoomTimeline`; room/thread cache hydrate and persist orchestration still lives there. | Extract the remaining cache hydrate/persist commands in small behavior-preserving slices. |
| Scroll and pagination         | Not converted. Keep separate from the data-model work.                                                                                                                     | Address after cache coverage metadata exists.                                                 |
| Reaction rendering            | Not part of the thread model refactor. Fresh normal-message and thread-reply reactions pass e2e.                                                                           | If regressions remain, debug as cache/relation coverage or room-specific data, not UI model.  |

The immediate next code slice is still Phase 5 preload/cache cleanup, not Phase 6 scroll.
Compact cards, normal room badges, overview filter/sort/count logic, the thread banner, recent
thread entries, command palette thread items, and overview cache hydration now share the
`ThreadRecord` seam. `RoomTimeline` no longer does per-visible cached-summary reads, no longer
builds `ThreadOverviewMetadata` maps as an intermediate source for records, and no longer has a
metadata-map fallback in `getThreadFilteredEvents`. `threadRecord` no longer accepts legacy metadata
objects or maps. Normal badge rendering is now behind a fork-owned view-model seam, and
renderability/preload counting, eager current-room preload, and raw event cache access have been
moved out of `RoomTimeline`. The next useful cleanup is extracting the remaining async cache
hydrate/persist orchestration behind controller seams.

## Refactor Phases

### Phase 0: Guardrails

- Add this plan and keep it linked from `FORK_CHANGES.md`.
- Treat new product logic in `RoomTimeline.tsx` as a regression unless it is a narrow seam.
- Prefer adding fork-owned modules over expanding upstream Cinny files.
- Keep each step behavior-preserving unless explicitly marked as behavior-changing.

Acceptance:

- Docs-only validation passes with `git diff --check`.

### Phase 1: Define Canonical Types And Selectors

- Add `ThreadRecord`, `ThreadPresentationSnapshot`, `ThreadStatusSnapshot`, and view-model types.
- Wrap existing summary, tag, status, and presentation helpers behind a single selector API.
- Do not move storage or UI yet.

Acceptance:

- Existing tests pass.
- New unit tests prove the same input yields one canonical record for:
  - a normal thread with replies,
  - a zero-reply thread root,
  - a summary event,
  - a resolved/tagged thread,
  - a cached-only thread.

### Phase 2: Make Compact Cards Pure

- Build `CompactThreadCardViewModel` from the canonical selector.
- Remove Matrix/cache/status hooks from `CompactThreadCard`.
- Keep rendering identical.

Acceptance:

- Compact-card tests assert only props/view models are needed.
- Compact view no longer recomputes tags, streaming, scheduled count, unread, or activity per card.

### Phase 3: Unify Summary Ownership

- Make one summary owner responsible for parsing, latest selection, in-memory state, and persistence.
- Remove direct `loadLatestCachedThreadSummaryInfo` usage from render paths.
- Route summary events from live sync and cached thread events through the same owner.

Acceptance:

- Compact view, normal room badges, thread banner, recent threads, and command palette agree on summary text and message count.
- Tests cover cached summary vs newer live summary precedence.

### Phase 4: Build The Room Thread Index

- Introduce a per-room thread index that combines:
  - live Matrix room events,
  - cached room events,
  - cached thread snapshots,
  - summary store,
  - tag store,
  - status index.
- Replace scattered per-component maps with `ThreadRecord`.

Acceptance:

- Thread filtering, sorting, status counts, tag counts, search, compact view, and normal badges consume `ThreadRecord`.
- No separate component-local maps remain for cached activity, latest preview, last sender, message count, and summary.

### Phase 5: Move Cache And Preload Orchestration Out Of `RoomTimeline`

- Move room event cache, thread event cache, index cache, and preload policy behind `eventRepository` and `preloadController`.
- `RoomTimeline` should only:
  - subscribe to current room/thread models,
  - dispatch preload/open/pagination commands,
  - render.

Acceptance:

- `RoomTimeline` no longer directly imports cache repository internals.
- Current-room preload reaches the configured limit where server history allows.
- Non-visible current-room threads are included in preload policy.
- Thread opens use cached snapshots immediately when available.

### Phase 6: Isolate Scroll And Pagination

- Extract scroll anchoring, "load more", and thread pagination state into a dedicated controller.
- Connect it to cache coverage metadata.
- Do not introduce virtualization until the controller has stable tests and instrumentation.

Acceptance:

- Loading older thread messages preserves visual anchor.
- Returning from a thread to room overview does not rebuild enough UI to cause visible delay.
- Scroll tests cover cached hydration, live pagination, and mixed cached/live pagination.

### Phase 7: Shrink Upstream Diffs And Rewrite History

- After behavior is stable, rewrite commits into logical slices:
  - data model and selectors,
  - summary store,
  - tag/status index,
  - compact view conversion,
  - recent threads and command palette conversion,
  - cache/preload controller,
  - scroll/pagination controller.
- Keep upstream Cinny files limited to integration seams.
- Remove abandoned fallback code paths before finalizing history.

Acceptance:

- `git diff v4.11.1...HEAD -- src/app/features/room/RoomTimeline.tsx` is materially smaller.
- MindRoom behavior is mostly contained under fork-owned modules.
- Rebase conflicts are expected and localized.

## Testing Strategy

Required test layers:

| Layer             | Tests                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Codec tests       | Summary event parsing, edits, legacy/current formats.                                         |
| Selector tests    | `ThreadRecord` derivation from live-only, cache-only, and mixed inputs.                       |
| Store tests       | Summary/tag/status state updates and precedence.                                              |
| Cache tests       | Raw event persistence, coverage metadata, index record persistence, migration behavior.       |
| View-model tests  | Compact card, badge, header, recent thread, and command palette all agree.                    |
| Controller tests  | Preload policy stops at limit, includes non-visible current-room threads, resumes from cache. |
| Browser/MCP tests | Compact room, normal room, thread open, thread back navigation, long-thread load-more anchor. |

Every behavior-changing step should run:

```bash
npm test
npm run typecheck
npm run build
```

Docs-only or plan-only steps should run:

```bash
git diff --check
```

## Success Criteria

The refactor is complete when:

- There is exactly one canonical way to derive a thread's summary, counts, previews, tags, status, and activity.
- Cache can instant-paint the current room and threads up to the configured preload limit.
- Current-room preload includes non-visible threads and all supported message/media event types.
- Compact view, normal room view, thread banner, recent sidebar, and command palette agree for the same thread.
- `RoomTimeline.tsx` is no longer the owner of summary/cache/preload/thread-card data derivation.
- Upstream Cinny file diffs are narrow enough that rebases are mostly mechanical.
- Defensive fallback paths that were only added to paper over earlier bugs have been removed.
