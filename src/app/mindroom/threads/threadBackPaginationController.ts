import { useState } from 'react';
import {
  captureThreadPrependScrollAnchor,
  type ThreadPrependScrollAnchor,
} from './timelineScrollUtils';
import type { ThreadPaginationRequest } from './session/threadSessionTypes';

type PendingThreadBackPaginationAnchor = ThreadPrependScrollAnchor & {
  eventCount?: number;
  seq: number;
};

/** Owns viewport capture and pin suppression; request loading belongs to pagination. */
export const useThreadBackPaginationController = () => {
  const [controller] = useState(() => {
    let owner: ThreadPaginationRequest | undefined;
    let capturing = false;
    let suppressed = false;
    let anchor: PendingThreadBackPaginationAnchor | undefined;
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
    };
  });
  return controller;
};
export type ThreadBackPaginationController = ReturnType<typeof useThreadBackPaginationController>;
