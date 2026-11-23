import { useMemo, type RefObject } from 'react';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type { ThreadPrependViewportPort } from '../threads/open/threadSessionTypes';
import { waitForScrollQuiescence } from './scrollQuiescence';

/**
 * Backward requests hand the reader over from the opening pin and commit at
 * scroll rest. When the headroom scroll owner is enabled, headroom absorbs pages
 * with zero scrollTop writes and holds pages out of threadEvents only if headroom
 * is exhausted mid-gesture.
 */
export const useThreadPrependViewport = ({
  controller,
  scrollRef,
  ownerEnabled = false,
}: {
  controller: ThreadBackPaginationController;
  scrollRef: RefObject<HTMLDivElement>;
  ownerEnabled?: boolean;
}): ThreadPrependViewportPort =>
  useMemo(
    () => ({
      begin: (request) => controller.begin(request),
      waitForQuiescence: async (request) => {
        if (ownerEnabled) return;
        if (controller.owns(request)) await waitForScrollQuiescence(scrollRef.current);
      },
      finish: (request) => controller.finish(request),
    }),
    [controller, ownerEnabled, scrollRef]
  );
