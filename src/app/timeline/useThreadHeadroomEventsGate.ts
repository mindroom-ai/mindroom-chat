import { useCallback, useRef, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  computeHeadroomBudget,
  createThreadScrollOwnerState,
  estimatePrependedHeight,
  resetThreadScrollOwnerState,
  type ThreadScrollOwnerState,
} from './threadScrollHeadroom';

/**
 * Gates `rawThreadEvents` at the timeline boundary so that when headroom is exhausted
 * mid-gesture, a fetched prepend page is held out of `threadEvents` until scroll rest.
 * Pure with respect to DOM layout: reads only committed headroom and committed anchor.
 */
export const useThreadHeadroomEventsGate = ({
  viewKey,
  threadId,
  ownerEnabled,
  rawThreadEvents,
  threadUserScrolled,
}: {
  viewKey: string;
  threadId: string | undefined;
  ownerEnabled: boolean;
  rawThreadEvents: MatrixEvent[];
  threadUserScrolled: boolean;
}): {
  owner: ThreadScrollOwnerState;
  presentedThreadEvents: MatrixEvent[];
  hasHeldThreadEvents: boolean;
} => {
  const [, setCommitTick] = useState(0);
  const bumpCommitTick = useCallback(() => {
    setCommitTick((tick) => tick + 1);
  }, []);

  const ownerRef = useRef<ThreadScrollOwnerState | undefined>(undefined);
  if (!ownerRef.current) {
    ownerRef.current = createThreadScrollOwnerState(rawThreadEvents, bumpCommitTick);
  }
  const owner = ownerRef.current;
  owner.bumpCommitTick = bumpCommitTick;

  if (owner.viewKey !== viewKey) {
    resetThreadScrollOwnerState(owner, viewKey, rawThreadEvents);
  }

  if (!ownerEnabled || !threadId) {
    owner.presentedEvents = rawThreadEvents;
    owner.heldRawEvents = undefined;
    owner.heldPrependEstimatePx = 0;
    return { owner, presentedThreadEvents: rawThreadEvents, hasHeldThreadEvents: false };
  }

  if (owner.presentedEvents === rawThreadEvents) {
    owner.heldRawEvents = undefined;
    owner.heldPrependEstimatePx = 0;
  } else if (!threadUserScrolled) {
    owner.presentedEvents = rawThreadEvents;
    owner.heldRawEvents = undefined;
    owner.heldPrependEstimatePx = 0;
  } else {
    const insideReserve = owner.anchorRef?.current === undefined && owner.committedHeadroomPx > 0;
    const estimatedPrependPx = estimatePrependedHeight({
      rawEvents: rawThreadEvents,
      presentedEvents: owner.presentedEvents,
      anchor: owner.anchorRef?.current,
      threadId,
      sizeCache: owner.sizeCache,
      avgRowHeight: owner.lastAvgRowHeight,
      fillReserve: insideReserve,
    });
    // Once a page is held out of threadEvents mid-gesture, never release it during render;
    // only the single commit-time layout effect at genuine rest releases it.
    const requiredHeadroomPx = estimatedPrependPx > 0 ? Math.ceil(estimatedPrependPx) : 0;
    if (owner.heldRawEvents !== undefined || requiredHeadroomPx > owner.committedHeadroomPx) {
      owner.heldRawEvents = rawThreadEvents;
      owner.heldPrependEstimatePx = Math.max(owner.heldPrependEstimatePx, estimatedPrependPx);
    } else {
      owner.presentedEvents = rawThreadEvents;
      owner.heldRawEvents = undefined;
      owner.heldPrependEstimatePx = 0;
    }
  }

  return {
    owner,
    presentedThreadEvents: owner.presentedEvents,
    hasHeldThreadEvents: owner.heldRawEvents !== undefined,
  };
};

/**
 * Computes an opening headroom reservation, recalibration, or open-completion trim
 * while the reader has not yet scrolled.
 */
export const planOpeningHeadroomTransition = ({
  owner,
  threadUserScrolled,
  threadOpenedAtLatest,
  hasMoreHistory,
  threadEventsLength,
  expectedThreadEvents,
  unmeasuredVisible,
  avgRowHeight,
  scrollTop,
  contentHeight,
  viewHeight,
  viewWidth,
}: {
  owner: ThreadScrollOwnerState;
  threadUserScrolled: boolean;
  threadOpenedAtLatest: boolean;
  hasMoreHistory: boolean;
  threadEventsLength: number;
  expectedThreadEvents: number;
  unmeasuredVisible: number;
  avgRowHeight: number;
  scrollTop: number;
  contentHeight: number;
  viewHeight: number;
  viewWidth: number;
}):
  | { nextHeadroom: number; scrollKind: 'offset' | 'bottom'; targetScrollTop: number }
  | undefined => {
  if (threadUserScrolled || threadEventsLength === 0) return undefined;
  if (hasMoreHistory) {
    const desired = computeHeadroomBudget({
      unloadedReplies: Math.max(0, expectedThreadEvents - threadEventsLength),
      unmeasuredLoaded: unmeasuredVisible,
      avgRowHeight,
      viewHeight,
      viewWidth,
      hasMoreHistory: true,
    });
    const shouldSeed = !owner.headroomInitialized;
    const shouldRecalibrate =
      owner.committedHeadroomPx < desired * 0.85 ||
      owner.committedHeadroomPx > desired * 1.25 + viewHeight;
    if (shouldSeed || shouldRecalibrate) {
      owner.headroomInitialized = true;
      const delta = desired - owner.committedHeadroomPx;
      if (Math.abs(delta) > 1) {
        return {
          nextHeadroom: desired,
          scrollKind: threadOpenedAtLatest ? 'bottom' : 'offset',
          targetScrollTop: Math.max(0, scrollTop + delta),
        };
      }
    }
    return undefined;
  }
  if (owner.heldRawEvents === undefined) {
    const perUnmeasured = viewWidth < 600 ? 12 : 8;
    const desiredCushion =
      contentHeight > viewHeight * 1.25
        ? Math.min(unmeasuredVisible * perUnmeasured, Math.round(viewHeight * 2))
        : 0;
    if (owner.committedHeadroomPx > 0) {
      const keepCushion = Math.min(owner.committedHeadroomPx, desiredCushion);
      const trim = owner.committedHeadroomPx - keepCushion;
      if (trim > 1) {
        return {
          nextHeadroom: keepCushion,
          scrollKind: threadOpenedAtLatest ? 'bottom' : 'offset',
          targetScrollTop: Math.max(0, scrollTop - trim),
        };
      }
    } else if (
      !owner.headroomInitialized &&
      threadOpenedAtLatest &&
      contentHeight > viewHeight * 1.5 &&
      unmeasuredVisible > 15 &&
      desiredCushion > 1
    ) {
      // Cache-hit open with unmeasured rows above: reserve a wrap/estimate cushion before first scroll.
      owner.headroomInitialized = true;
      return {
        nextHeadroom: desiredCushion,
        scrollKind: 'bottom',
        targetScrollTop: Math.max(0, scrollTop + desiredCushion),
      };
    }
  }
  return undefined;
};
