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
  /** Bumps when an event mutates in place (e.g. decryption) so folds recompute. */
  rowRepaintRevision?: number;
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
  rowRepaintRevision,
}: UseMembershipFoldsOptions): {
  view: MembershipFoldView;
  toggle: (fold: MembershipFold) => void;
} => {
  const folds = useMemo(() => {
    void rowRepaintRevision;
    return enabled ? planMembershipFolds(events, { isSkipped, pinnedIds }) : [];
  }, [enabled, events, isSkipped, pinnedIds, rowRepaintRevision]);

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

type AppliedRowState = 'hidden' | 'break-closed' | 'break-open';

/**
 * Syncs virtualizer item measurements for folded membership rows, tracking the fold state
 * actually applied per row ID in the current virtualizer so rows that leave and re-enter the
 * window still restore their non-zero estimate when opened or unfolded.
 */
export const useMembershipFoldRowMeasurements = (
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  windowEvents: readonly MatrixEvent[],
  view: MembershipFoldView,
  estimate: (index: number) => number
) => {
  const virtualizerRef = useRef(virtualizer);
  const appliedRef = useRef<Map<string, AppliedRowState>>(new Map());

  useLayoutEffect(() => {
    if (virtualizerRef.current !== virtualizer) {
      virtualizerRef.current = virtualizer;
      appliedRef.current = new Map();
    }
    const applied = appliedRef.current;

    windowEvents.forEach((event, index) => {
      const id = event.getId();
      if (!id) return;

      let desired: AppliedRowState | 'normal';
      if (view.hiddenIds.has(id)) {
        desired = 'hidden';
      } else {
        const breakEntry = view.breaks.get(id);
        desired = breakEntry ? (breakEntry.open ? 'break-open' : 'break-closed') : 'normal';
      }

      const prev = applied.get(id) ?? 'normal';
      if (desired === prev) return;

      if (desired === 'hidden') {
        virtualizer.resizeItem(index, 0);
        applied.set(id, 'hidden');
        return;
      }

      if (prev === 'hidden' || !virtualizer.elementsCache.get(id)?.isConnected) {
        virtualizer.resizeItem(index, estimate(index));
      }

      if (desired === 'normal') {
        applied.delete(id);
      } else {
        applied.set(id, desired);
      }
    });
  }, [virtualizer, windowEvents, view, estimate]);
};
