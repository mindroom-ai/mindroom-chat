import { useState, type MutableRefObject } from 'react';
import {
  captureThreadPrependScrollAnchor,
  type ThreadPrependScrollAnchor,
} from './timelineScrollUtils';
import type { ThreadPaginationRequest } from './session/threadSessionTypes';

type PendingThreadBackPaginationAnchor = ThreadPrependScrollAnchor & {
  eventCount?: number;
  seq: number;
};

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

/** Owns viewport capture plus opening-pin suppression and provenance. */
export const useThreadBackPaginationController = () => {
  const [controller] = useState(() => {
    let owner: ThreadPaginationRequest | undefined;
    let capturing = false;
    let suppressed = false;
    let anchor: PendingThreadBackPaginationAnchor | undefined;
    let pendingOpenBottomPinCount: number | undefined;
    let canceledOpenBottomPinCount: number | undefined;
    let sequence = 0;
    const capture = (scrollRoot: HTMLElement | null | undefined, eventCount?: number) => {
      const captured = captureThreadPrependScrollAnchor(scrollRoot);
      sequence += 1;
      anchor = captured ? { ...captured, eventCount, seq: sequence } : undefined;
      return !!anchor;
    };
    return {
      reset: () => {
        owner = undefined;
        capturing = false;
        suppressed = false;
        anchor = undefined;
        pendingOpenBottomPinCount = undefined;
        canceledOpenBottomPinCount = undefined;
      },
      begin: (
        request: ThreadPaginationRequest,
        scrollRoot: HTMLElement | null | undefined,
        eventCount?: number
      ) => {
        if (capturing) return false;
        owner = request;
        capturing = true;
        suppressed = true;
        capture(scrollRoot, eventCount);
        return true;
      },
      owns: (request: ThreadPaginationRequest) => owner === request,
      finish: (request: ThreadPaginationRequest, committed: boolean) => {
        if (owner !== request) return;
        capturing = false;
        if (!committed) {
          anchor = undefined;
          owner = undefined;
        }
      },
      recaptureAnchor: (
        request: ThreadPaginationRequest,
        scrollRoot: HTMLElement | null | undefined,
        eventCount?: number
      ) => {
        if (owner !== request || !capturing) return false;
        return capture(scrollRoot, eventCount);
      },
      clear: (request: ThreadPaginationRequest) => {
        if (owner === request) anchor = undefined;
      },
      // The ledger consumes the current capture synchronously in its layout phase.
      clearPendingAnchor: () => {
        anchor = undefined;
      },
      getPendingAnchorEventId: () => anchor?.eventId,
      getPendingAnchorSeq: () => anchor?.seq,
      isOpenBottomPinSuppressed: () => suppressed,
      suppressOpenBottomPin: () => {
        suppressed = true;
      },
      requestOpenBottomPin: (scrollToBottomRef: MutableRefObject<ScrollToBottomState>) => {
        if (suppressed) return false;
        const nextCount = scrollToBottomRef.current.count + 1;
        scrollToBottomRef.current = {
          count: nextCount,
          smooth: false,
        };
        // Both the focus-band producer and the session completion adapter
        // register here, so a gesture can distinguish either opening request
        // from a later explicit jump or live-send count.
        pendingOpenBottomPinCount = nextCount;
        return true;
      },
      cancelOpenBottomPin: (currentCount: number) => {
        suppressed = true;
        if (pendingOpenBottomPinCount === currentCount) {
          canceledOpenBottomPinCount = currentCount;
        }
        pendingOpenBottomPinCount = undefined;
      },
      // Keep the shared command count monotonic. Both consumers consult this
      // exact generation; a newer explicit count remains applicable.
      shouldApplyBottomPin: (count: number) => canceledOpenBottomPinCount !== count,
    };
  });
  return controller;
};
export type ThreadBackPaginationController = ReturnType<typeof useThreadBackPaginationController>;
