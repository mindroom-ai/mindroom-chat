/**
 * CINNY-207 P4.3: deep-history scheduler job (band 4).
 *
 * Replaces the removed `useRoomEagerPreload` hook (`preloadController`).
 * The old loop drove `mx.paginateEventTimeline` against the SDK live
 * timeline in-place — that mutated the SDK's in-memory state, forced
 * progressive React re-renders as batches landed (the "recalibrate"
 * dance), and could easily exhaust memory on very active rooms.
 *
 * The new job fetches `/messages` via `mx.createMessagesRequest` (the
 * SAME primitive P4.2 uses for gap-fill) with a Backward direction
 * and persists each chunk straight through `saveRoomEventsToCache`.
 * The SDK live timeline is NEVER touched — the cache hydration path
 * reads from IDB on next mount / next `useRoomCacheHydrationController`
 * pass, so the render layer stays out of the loop. The user sees
 * "bottomless scrollback" without paying the render recalibration
 * cost per batch.
 *
 * Design choices in Deviations §8 for the final docs commit:
 *   - Progressive-render recalibration is NOT replicated. The old
 *     loop notified React every batch so the scrollbar height grew
 *     smoothly. We accept a one-shot cache-hydrate-on-next-mount
 *     instead: the user's scroll-back gesture picks up the cached
 *     records at once.
 *   - Cooperative abort v1 (see backfillScheduler.ts): the executor
 *     checks `signal.aborted` between batches only.
 *   - Depth cap = `CURRENT_ROOM_DEEP_HISTORY_TARGET` (10000 events);
 *     the executor stops when it reaches the cap OR the SDK returns
 *     no more history OR an error is thrown.
 */

import type { IEvent, MatrixClient } from 'matrix-js-sdk';
import { Direction } from 'matrix-js-sdk';
import { persistRoomChunkWithPreferLive } from '../threads/eventRepository';
import type { BackfillScheduler } from './backfillScheduler';
import {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  DEFAULT_PREFETCH_SCOPE,
  isRoomEligibleForBackgroundPrefetch,
  type PrefetchScope,
} from './prefetchPolicy';

const DEEP_HISTORY_BATCH_SIZE = 200;

export type EnqueueDeepHistoryArgs = {
  readonly mx: MatrixClient;
  readonly sessionId: string;
  readonly scheduler: BackfillScheduler;
  readonly roomId: string;
  /**
   * Overrides the default `CURRENT_ROOM_DEEP_HISTORY_TARGET` for tests
   * or for a specific caller that wants a shallower sweep. The
   * executor still yields on `signal.aborted` between batches.
   */
  readonly targetEventCount?: number;
  /**
   * CINNY-207 PR #72 review (greptile, outside-diff): the user's
   * `prefetchScope` at enqueue time. Deep-history only ever targets
   * the focused room, so the gate passes `focusedRoomId: roomId` —
   * under `current-room-only` and `all-rooms` the focused room is
   * eligible (encrypted still blocked); `my-server` keeps the
   * historical own-tier-only behavior. Omitted (tests / legacy
   * callers) defaults to `my-server`, matching the pre-scope gate.
   */
  readonly scope?: PrefetchScope;
};

/**
 * Enqueue a deep-history job for the current room. Returns the
 * scheduler promise so tests can await completion; production callers
 * fire-and-forget.
 */
export const enqueueRoomDeepHistoryJob = (
  args: EnqueueDeepHistoryArgs
): Promise<void> => {
  const { mx, sessionId, scheduler, roomId } = args;
  const scope = args.scope ?? DEFAULT_PREFETCH_SCOPE;
  const target = args.targetEventCount ?? CURRENT_ROOM_DEEP_HISTORY_TARGET;
  return scheduler.enqueue<void>({
    roomId,
    kind: 'room-deep-history',
    priority: 4,
    execute: async (signal) => {
      const room = mx.getRoom?.(roomId);
      if (!room) return;
      // Same scope-aware gate as gap-fill (see prefetchPolicy.ts).
      // Deep-history targets the focused room by construction, so the
      // room itself is the focusedRoomId.
      if (
        !isRoomEligibleForBackgroundPrefetch({ mx, room, scope, focusedRoomId: roomId })
      )
        return;

      // Start from the current backward token on the room's live
      // timeline, if any — matches the old preload loop's saved-token
      // restoration. When absent (fresh join), the SDK will start from
      // the tail token supplied by the initial sync.
      let fromToken: string | null = null;
      const liveTimelineToken = room
        .getLiveTimeline?.()
        ?.getPaginationToken?.(Direction.Backward);
      if (liveTimelineToken) fromToken = liveTimelineToken;

      let persistedCount = 0;
      while (persistedCount < target) {
        if (signal.aborted) return;
        let response;
        try {
          // eslint-disable-next-line no-await-in-loop
          response = await mx.createMessagesRequest(
            roomId,
            fromToken,
            DEEP_HISTORY_BATCH_SIZE,
            Direction.Backward
          );
        } catch {
          return; // swallow — bounded fetch failure, don't retry inside this job
        }
        if (signal.aborted) return;
        const chunk: Partial<IEvent>[] = Array.isArray(response?.chunk)
          ? (response.chunk as Partial<IEvent>[])
          : [];
        if (chunk.length > 0) {
          // CINNY-207 P7.2 audit finding #3: mirror the gap-fill path —
          // route every raw chunk event through
          // `createPreferLiveEventMapper` (via the shared helper) before
          // persisting. Otherwise a deep-history sweep fetched inside
          // Tuwunel's ~10s stale window can overwrite a cached tombstone
          // with the un-pruned pre-redaction copy of a redacted event
          // (invariant I2, see reconciler.ts header).
          // eslint-disable-next-line no-await-in-loop
          await persistRoomChunkWithPreferLive({
            mx,
            sessionId,
            room,
            chunk,
            beforeTokenForEarliest: response.end ?? null,
          });
          persistedCount += chunk.length;
        }
        if (!response.end) return; // SDK confirmed no more history
        if (response.end === fromToken) return; // stuck token — bail
        fromToken = response.end;
        // Yield to a macrotask so a long deep-history run doesn't
        // starve UI callbacks between batches.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    },
  });
};
