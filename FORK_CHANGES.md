# MindRoom Cinny Fork Changes

## Runbook

### CINNY-034: Thread Message Truncation Regression Investigation

- Status: investigation complete on 2026-03-27.
- This checkout was missing `FORK_CHANGES.md`; created a local runbook entry to satisfy repo instructions and track the investigation.

### Architecture Notes

- Thread view loading lives in `src/app/features/room/RoomTimeline.tsx`.
- Opening a thread does not use the room eager-preload loop. Instead it bootstraps the SDK thread model, then calls `refreshLatestThreadSlice()`, which performs a single `mx.fetchRelations(..., { limit: safePaginationLimitRef.current })`.
- Thread back/forward pagination also reuse `safePaginationLimitRef.current` directly for single SDK pagination calls.
- Room history preload is separate and room-only. It runs in fixed `BATCH_SIZE = 200` chunks and loops until the room target is reached.

### Execution Order

1. Read repo instructions and locate a usable runbook source.
2. Trace thread-view loading and pagination in `RoomTimeline.tsx`, `useThreadRenderState.ts`, and cache helpers.
3. Diff suspected commits from `29a1ea49..d2c9cb44`.
4. Isolate the regression trigger and rule out unrelated console errors.
5. Write the investigation findings to `PLAN.md` and `.claude/REPORT.md`.

### Validation / Review

- Reviewed:
  - `src/app/features/room/RoomTimeline.tsx`
  - `src/app/features/room/RoomView.tsx`
  - `src/app/state/settings.ts`
  - `src/app/features/room/useThreadRenderState.ts`
  - `src/app/features/room/threadEventCache.ts`
- Compared commit diffs for:
  - `7bac6f77` on 2026-03-26
  - `eaf8a43c` on 2026-03-26
  - `60071047` on 2026-03-26
  - `d2c9cb44` on 2026-03-26
  - `e874719e` on 2026-03-23
- Code review completed for `a54d2d1d` on 2026-03-27 and recorded in `DEBATE.md`.
- Review verdict: approve with warnings about cross-batch insertion cost in `refreshLatestThreadSlice()` and missing focused regression coverage for multi-page thread loading.
- Independent review requirement satisfied with a second self-review of the identified thread-loading path and commit diffs.

### Current Status

- Root cause isolated to `7bac6f77` changing the default pagination limit from `300` to `10000`.
- The trigger exposed a preexisting thread-loading design issue: thread view uses one oversized relations request instead of a batched loop.
- `eaf8a43c`, `60071047`, and `d2c9cb44` do not modify the thread-loading path that determines how many replies appear in thread view.
- The reported 404/403/M_FORBIDDEN console errors are unrelated to thread timeline loading.

### CINNY-038: Fix Thread View Truncation Regression (2026-03-27)

- Status: **complete** (third iteration — live-tested fix).
- Added `THREAD_BATCH_SIZE = 200` constant in `src/app/state/settings.ts`.
- `handleThreadPaginateBack()` and `handleThreadPaginateFront()` use `THREAD_BATCH_SIZE` instead of `safePaginationLimitRef.current`.
- Room-level pagination unchanged.
- `fetchAllThreadRelations()` retained as standalone testable function with 9 unit tests.
- Fixed missing `shouldAutoScrollRoomOnLiveEvent` mock and added `THREAD_BATCH_SIZE` to settings mock in `RoomTimeline.test.ts`.

#### Third iteration fix (live test failure)
- The second iteration (`fetchAllThreadRelations` + `Thread.addEvents()`) fetched events correctly (36 network requests observed) but only 2-12 rendered.
- **Root cause:** `Thread.addEvents()` uses `Thread.addEvent()` per-event which routes out-of-order events through `insertEventIntoTimeline()` — a fundamentally different code path from the SDK's own thread pagination. The SDK's `paginateEventTimeline()` uses `timelineSet.addEventsToTimeline()` (batch method) plus `thread.processEvent()` for proper integration.
- **Secondary bug:** `setThreadHasMoreCachedBack` used a sticky-OR updater (`currentValue || newCondition`) that never reset to false after full pagination, causing the "Load Older Messages" button to persist even when all events were loaded.
- **Fix:** Replaced `fetchAllThreadRelations` + `Thread.addEvents` in `refreshLatestThreadSlice()` with a `paginateEventTimeline` loop — the same mechanism used by the working room preload loop and `handleThreadPaginateBack`. Fixed `setThreadHasMoreCachedBack` to directly set (not OR) based on actual backward pagination token.
- Validated: `npm run typecheck`, `npm run build`, and `npm run test -- src/app/features/room/RoomTimeline.test.ts` all pass (59/59 tests, all typecheck errors pre-existing).
### CINNY-037: Browser Back Button Thread Navigation

- Status: implemented on 2026-03-27 and corrected on 2026-03-27 after review.

#### Root Cause

1. Opening a thread pushed `?threadId=...` onto history without updating the prior room entry.
2. Browser back therefore returned to a plain room URL instead of an event-focused room URL for the thread root.
3. The existing room event-focus scroll logic only runs when the room route includes that root event ID.

#### Fixes Applied

1. Updated `navigateRoomThread` in `src/app/hooks/useRoomNavigate.ts` to call `window.history.replaceState(window.history.state, '', getRoomPath(roomId, threadId))` before pushing the thread URL.
2. This bypasses React Router's async data-router navigation, so the back-stack pre-seed is committed synchronously even with ancestor loaders.
3. Kept the pre-seed disabled for `opts?.replace` so `handleJumpToLatest` continues to replace the current thread URL without adding an extra history mutation.

#### Validation

- `npm run typecheck` — fails due to pre-existing repo-wide `matrix-js-sdk` type import and typing errors unrelated to this change
- `npm run build` — succeeds
- `npm run lint` — not re-run; the script shells out to `yarn`, which is not installed in this environment
- `npm run check:eslint` — not re-run; prior repo-wide lint failures were unrelated to this change
- `npm run check:prettier` — not re-run; prior repo-wide formatting drift was unrelated to this change
- `npx vitest run src/app/hooks/useRoomNavigate.test.ts` — succeeds
- `npx eslint src/app/hooks/useRoomNavigate.ts src/app/hooks/useRoomNavigate.test.ts` — succeeds
- `npx prettier --check src/app/hooks/useRoomNavigate.ts src/app/hooks/useRoomNavigate.test.ts FORK_CHANGES.md .claude/REPORT.md` — succeeds
