import { useEffect, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';

// Zero-reply standalone thread roots have NO server-side listing (unlike
// real threads, which `loadRoomThreads` fetches to exhaustion via the
// MSC3856 `/threads` API). They only become compact-view cards when their
// event is present in the locally loaded main timeline. On a fresh session
// (or after the user clears site data) that timeline is just the last
// ~STARTUP_SYNC_TIMELINE_LIMIT sync events — in an agent room mostly thread
// replies and edits — so historical standalone roots are invisible until
// something back-paginates, and nothing did in the compact view (classic
// view paginates via the virtual paginator's scroll sentinel, which the
// compact view does not mount). This controller drives the existing
// cache-first pagination command until the loaded main timeline reaches a
// coverage floor, so standalone roots materialize without user scrolling.
export const COMPACT_COVERAGE_TARGET_EVENTS = 200;

// Absolute per-mount batch budget. Each batch is either one cached page or
// one network /messages page via `handleRoomTimelinePagination(true)`; the
// cap bounds worst-case work in rooms whose history is mostly filtered
// (e.g. membership floods) where the target may be slow to reach.
export const COMPACT_COVERAGE_MAX_BATCHES = 8;

export type CompactCoverageBackfillDecisionInput = {
  enabled: boolean;
  loadedEventCount: number;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  batchesUsed: number;
};

export const shouldRunCompactCoverageBackfill = ({
  enabled,
  loadedEventCount,
  canPaginateBack,
  hasMoreCachedBack,
  batchesUsed,
}: CompactCoverageBackfillDecisionInput): boolean => {
  if (!enabled) return false;
  if (batchesUsed >= COMPACT_COVERAGE_MAX_BATCHES) return false;
  if (loadedEventCount >= COMPACT_COVERAGE_TARGET_EVENTS) return false;
  return canPaginateBack || hasMoreCachedBack;
};

export const useCompactCoverageBackfillController = ({
  enabled,
  loadedEventCount,
  canPaginateBack,
  hasMoreCachedBack,
  paginateBack,
  room,
}: {
  /**
   * Room view with the compact overview requested, after the initial cache
   * hydration settled (`!threadId && !eventId && compactViewRequested &&
   * roomInitialCacheHydrated`). Waiting for hydration avoids racing the
   * open-time cache page with a redundant network fetch.
   */
  enabled: boolean;
  /** Raw event count across the currently linked main-timeline chain. */
  loadedEventCount: number;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  /**
   * The room pagination command (`handleRoomTimelinePagination`). Read via
   * a latest-ref so this controller always drives the instance bound to the
   * current timeline state — its identity changes every render.
   */
  paginateBack: (backwards: boolean) => Promise<void>;
  room: Room;
}): void => {
  const paginateBackRef = useRef(paginateBack);
  paginateBackRef.current = paginateBack;
  const batchesUsedRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // A settled batch may leave every reactive input unchanged (e.g. a page
  // of fully-filtered events); the tick forces the effect to re-evaluate so
  // the loop cannot stall before its budget or target is reached. It must
  // survive dependency churn while a batch is in flight, so it is guarded
  // by unmount alone — not by the reactive effect's cleanup.
  const [batchSettledTick, setBatchSettledTick] = useState(0);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    batchesUsedRef.current = 0;
    inFlightRef.current = false;
  }, [room.roomId]);

  useEffect(() => {
    if (inFlightRef.current) return;
    if (
      !shouldRunCompactCoverageBackfill({
        enabled,
        loadedEventCount,
        canPaginateBack,
        hasMoreCachedBack,
        batchesUsed: batchesUsedRef.current,
      })
    ) {
      return;
    }

    inFlightRef.current = true;
    batchesUsedRef.current += 1;
    paginateBackRef.current(true)
      .catch(() => undefined)
      .finally(() => {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setBatchSettledTick((tick) => tick + 1);
        }
      });
  }, [
    enabled,
    loadedEventCount,
    canPaginateBack,
    hasMoreCachedBack,
    room.roomId,
    batchSettledTick,
  ]);
};
