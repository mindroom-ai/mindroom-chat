import { useMemo, type RefObject } from 'react';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type { ThreadPrependViewportPort } from '../threads/open/threadSessionTypes';
import { waitForScrollQuiescence } from './scrollQuiescence';

/**
 * Backward requests hand the reader over from the opening pin and commit at
 * scroll rest. Upstream TanStack Virtual anchoring keeps the reader's rows in
 * place for every page that lands above them, so requests no longer capture an anchor.
 */
export const useThreadPrependViewport = ({
  controller,
  scrollRef,
  onBegin,
}: {
  controller: ThreadBackPaginationController;
  scrollRef: RefObject<HTMLDivElement | null>;
  onBegin?: () => void;
}): ThreadPrependViewportPort =>
  useMemo(
    () => ({
      begin: (request) => {
        const started = controller.begin(request);
        if (started) onBegin?.();
        return started;
      },
      waitForQuiescence: async (request) => {
        if (controller.owns(request)) await waitForScrollQuiescence(scrollRef.current);
      },
      finish: (request) => controller.finish(request),
    }),
    [controller, onBegin, scrollRef]
  );
