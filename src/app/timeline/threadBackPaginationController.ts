import { useState, type MutableRefObject } from 'react';
import type { ThreadPaginationRequest } from '../threads/open/threadSessionTypes';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

/** Owns the backward request lock plus opening-pin suppression and provenance. */
export const useThreadBackPaginationController = () => {
  const [controller] = useState(() => {
    let owner: ThreadPaginationRequest | undefined;
    let suppressed = false;
    let pendingOpenBottomPinCount: number | undefined;
    let canceledOpenBottomPinCount: number | undefined;
    return {
      reset: () => {
        ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'suppress', why: 'reset' }), stack: new Error().stack }));
        owner = undefined;
        suppressed = false;
        pendingOpenBottomPinCount = undefined;
        canceledOpenBottomPinCount = undefined;
      },
      // A reader who asks for older history takes over from the opening pin.
      begin: (request: ThreadPaginationRequest) => {
        if (owner) return false;
        owner = request;
        ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'suppress', why: 'begin' }), stack: new Error().stack }));
        suppressed = true;
        return true;
      },
      owns: (request: ThreadPaginationRequest) => owner === request,
      finish: (request: ThreadPaginationRequest) => {
        if (owner === request) owner = undefined;
      },
      isOpenBottomPinSuppressed: () => suppressed,
      suppressOpenBottomPin: () => {
        ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'suppress', why: 'suppressOpenBottomPin' }), stack: new Error().stack }));
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
        ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'suppress', why: 'cancelOpenBottomPin' }), stack: new Error().stack }));
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
