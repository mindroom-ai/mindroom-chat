# CINNY-038 Code Review

## Verdict: APPROVE

## Critical Issues (must fix before merge)

- None.

## Warnings (should fix)

- ~~`src/app/features/room/RoomTimeline.tsx:2575-2599` accumulates each page as `reverse()`d batch data and then passes the combined array straight into `currentThread?.addEvents(allChunkEvents, false)`.~~ **FIXED**: Extracted `fetchAllThreadRelations()` collects batches in an array, then reverses the batch order and flattens, so events are in chronological order before reaching `Thread.addEvents()`.
- ~~The change ships without focused regression coverage for the new multi-page path.~~ **FIXED**: Added 9 unit tests for `fetchAllThreadRelations()` covering: first-page failure, later-page failure with partial data, multi-page `next_batch` token propagation, chronological ordering across batches, empty thread, abort mid-loop, final token preservation, and limit parameter verification. Also fixed the missing `shouldAutoScrollRoomOnLiveEvent` mock so all 59 tests pass.

## Observations (nice to have)

- `src/app/features/room/RoomTimeline.tsx:2561-2583` handles the core correctness cases well. Empty threads, single-reply threads, exact-batch-size threads, and “no `next_batch`” termination all do the expected thing. The first-page error / later-page error split is also sensible: total failure returns `false`, partial failure keeps the data and token from the last successful page.
- `src/app/features/room/RoomTimeline.tsx:2573` and `src/app/features/room/RoomTimeline.tsx:2585` are enough to stop stale work when the user switches threads. They do not, however, cover full component unmounts, so the longer loop would be safer if it also checked `alive()` or a local mounted flag before continuing and before final state writes.
- `src/app/features/room/RoomTimeline.tsx:2528-2533` still hydrates cached threads with `safePaginationLimitRef.current`, and `src/app/features/room/RoomTimeline.tsx:5449-5462` renders thread views by mapping every `threadEvents` entry directly. That does not recreate the server-side truncation bug because IndexedDB is local, but it does mean a heavily cached thread can still reopen with a much larger slice than `THREAD_BATCH_SIZE`.
- I did not find any other oversized thread fetches in the room view. The remaining `fetchRelations(..., 'm.thread', ...)` calls in `src/app/features/room/RoomTimeline.tsx:3500-3503` and `src/app/features/room/RoomTimeline.tsx:3564-3567` are fixed `limit: 50` bootstrap fallbacks, and `src/app/utils/notifications.ts:57-60` uses `limit: 1` for read receipts.

## Summary

The fix addresses the reported regression: it follows `next_batch`, preserves the last successful backward token, and decouples thread pagination from the room-wide `paginationLimit` setting. I did not find a correctness bug in the loop or a missed oversized thread-fetch call site.

The remaining concerns are operational rather than blocking. The combined event order should be normalized before handing data to `Thread.addEvents()` so large threads do not pay unnecessary insertion cost, and this path needs direct tests because the current suite does not exercise the new pagination/token behavior.
