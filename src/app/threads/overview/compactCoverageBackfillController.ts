import { useEffect, useRef, useState } from 'react';

export const COMPACT_COVERAGE_TARGET_EVENTS = 200;
export const COMPACT_COVERAGE_MAX_BATCHES = 8;

export type CompactCoverageBackfillDecisionInput = {
  enabled: boolean;
  loadedEventCount: number;
  hasZeroReplyRootCoverage: boolean;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  batchesUsed: number;
};

export const shouldRunCompactCoverageBackfill = ({
  enabled,
  loadedEventCount,
  hasZeroReplyRootCoverage,
  canPaginateBack,
  hasMoreCachedBack,
  batchesUsed,
}: CompactCoverageBackfillDecisionInput): boolean => {
  if (!enabled || batchesUsed >= COMPACT_COVERAGE_MAX_BATCHES) return false;
  if (loadedEventCount >= COMPACT_COVERAGE_TARGET_EVENTS && hasZeroReplyRootCoverage) return false;
  return canPaginateBack || hasMoreCachedBack;
};

/**
 * Compact rooms have no scroll paginator. Drive the existing cache-first
 * room paginator until loaded history includes useful zero-reply coverage,
 * with a hard request budget per room: the view keeps this hook when the
 * reader moves to another room, and that room starts with a full budget.
 */
export const useCompactCoverageBackfillController = ({
  roomId,
  enabled,
  loadedEventCount,
  hasZeroReplyRootCoverage,
  canPaginateBack,
  hasMoreCachedBack,
  paginateBack,
}: {
  roomId: string;
  enabled: boolean;
  loadedEventCount: number;
  hasZeroReplyRootCoverage: boolean;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  paginateBack: (backwards: boolean) => Promise<void>;
}): void => {
  const paginateBackRef = useRef(paginateBack);
  paginateBackRef.current = paginateBack;
  const batchesUsedRef = useRef(0);
  const budgetRoomIdRef = useRef(roomId);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const [batchSettledTick, setBatchSettledTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (budgetRoomIdRef.current !== roomId) {
      budgetRoomIdRef.current = roomId;
      batchesUsedRef.current = 0;
    }
    if (inFlightRef.current) return;
    if (
      !shouldRunCompactCoverageBackfill({
        enabled,
        loadedEventCount,
        hasZeroReplyRootCoverage,
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
    roomId,
    enabled,
    loadedEventCount,
    hasZeroReplyRootCoverage,
    canPaginateBack,
    hasMoreCachedBack,
    batchSettledTick,
  ]);
};
