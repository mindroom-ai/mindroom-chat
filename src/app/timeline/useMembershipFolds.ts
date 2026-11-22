import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import {
  planMembershipFolds,
  viewMembershipFolds,
  type MembershipFold,
  type MembershipFoldView,
} from './membershipFolds';

type UseMembershipFoldsOptions = {
  /** Only the room timeline folds consecutive membership events (`!threadId`). */
  enabled: boolean;
  /** The full loaded room rows, in display order. */
  events: readonly MatrixEvent[];
  /** The rows currently in the virtual window. */
  windowEvents: readonly MatrixEvent[];
  /** Rows already hidden before membership folding. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** Event IDs that must remain visible (route or jump targets). */
  pinnedIds: ReadonlySet<string>;
};

/**
 * Folds consecutive room membership events over the full loaded timeline, keeping opened runs
 * anchored by event ID across history prepends and live appends.
 */
export const useMembershipFolds = ({
  enabled,
  events,
  windowEvents,
  isSkipped,
  pinnedIds,
}: UseMembershipFoldsOptions): {
  view: MembershipFoldView;
  toggle: (fold: MembershipFold) => void;
} => {
  const folds = useMemo(
    () => (enabled ? planMembershipFolds(events, { isSkipped, pinnedIds }) : []),
    [enabled, events, isSkipped, pinnedIds]
  );

  const visibleIds = useMemo(() => {
    if (folds.length === 0) return undefined;
    const ids = new Set<string>();
    for (const event of windowEvents) {
      const id = event.getId();
      if (id) ids.add(id);
    }
    return ids;
  }, [folds.length, windowEvents]);

  const [openAnchorIds, setOpenAnchorIds] = useState<ReadonlySet<string>>(() => new Set());

  const view = useMemo(
    () =>
      viewMembershipFolds(
        folds,
        (fold) => fold.hiddenIds.some((id) => openAnchorIds.has(id)),
        visibleIds
      ),
    [folds, openAnchorIds, visibleIds]
  );

  const toggle = useCallback((fold: MembershipFold) => {
    setOpenAnchorIds((anchors) => {
      const next = new Set(anchors);
      const isOpen = fold.hiddenIds.some((id) => next.has(id));
      if (isOpen) {
        for (const id of fold.hiddenIds) next.delete(id);
      } else {
        next.add(fold.key);
      }
      return next;
    });
  }, []);

  return { view, toggle };
};

/**
 * Syncs virtualizer item measurements for folded membership rows: hidden rows resize to 0 px,
 * newly unhidden rows take their estimate so they can mount, and disconnected break rows whose
 * state changed take their estimate again instead of keeping stale measured heights.
 */
export const useMembershipFoldRowMeasurements = (
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  windowEvents: readonly MatrixEvent[],
  view: MembershipFoldView,
  estimate: (index: number) => number
) => {
  const previousHidden = useRef<ReadonlySet<string>>(new Set());
  const previousBreaks = useRef<MembershipFoldView['breaks']>(new Map());

  useLayoutEffect(() => {
    const beforeHidden = previousHidden.current;
    const beforeBreaks = previousBreaks.current;
    previousHidden.current = view.hiddenIds;
    previousBreaks.current = view.breaks;

    windowEvents.forEach((event, index) => {
      const id = event.getId();
      if (!id) return;
      if (view.hiddenIds.has(id)) {
        virtualizer.resizeItem(index, 0);
        return;
      }
      if (beforeHidden.has(id)) {
        virtualizer.resizeItem(index, estimate(index));
        return;
      }
      const breakChanged = view.breaks.get(id)?.open !== beforeBreaks.get(id)?.open;
      if (breakChanged && !virtualizer.elementsCache.get(id)?.isConnected) {
        virtualizer.resizeItem(index, estimate(index));
      }
    });
  }, [virtualizer, windowEvents, view, estimate]);
};
