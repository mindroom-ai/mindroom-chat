import { useMemo, type RefObject } from 'react';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type {
  ThreadPaginationRequest,
  ThreadPrependViewportPort,
} from './session/threadSessionTypes';
import { waitForScrollQuiescence } from './scrollQuiescence';

type ThreadPrependCapture = {
  threadId: string;
  anchorEventId: string;
  anchorIndex: number;
  anchorSeq: number;
};

/** Bind DOM capture to the ledger only after its committed event index is available. */
export const useThreadPrependViewport = ({
  controller,
  scrollRef,
  eventIndex,
  capture,
  clearCapture,
}: {
  controller: ThreadBackPaginationController;
  scrollRef: RefObject<HTMLDivElement>;
  eventIndex: RefObject<Map<string, number>>;
  capture: (anchor: ThreadPrependCapture) => void;
  clearCapture: () => void;
}): ThreadPrependViewportPort =>
  useMemo(() => {
    const captureLedger = (request: ThreadPaginationRequest) => {
      const anchorEventId = controller.getPendingAnchorEventId();
      const anchorSeq = controller.getPendingAnchorSeq();
      const anchorIndex =
        anchorEventId === undefined ? undefined : eventIndex.current?.get(anchorEventId);
      if (
        anchorEventId !== undefined &&
        anchorSeq !== undefined &&
        typeof anchorIndex === 'number'
      ) {
        capture({ threadId: request.lease.threadId, anchorEventId, anchorIndex, anchorSeq });
      }
    };
    const clear = (request: ThreadPaginationRequest) => {
      if (!controller.owns(request)) return;
      controller.clear(request);
      clearCapture();
    };
    return {
      begin: (request, eventCount) => {
        if (!controller.begin(request, scrollRef.current, eventCount)) return false;
        clearCapture();
        captureLedger(request);
        return true;
      },
      waitForQuiescence: async (request) => {
        if (controller.owns(request)) await waitForScrollQuiescence(scrollRef.current);
      },
      recapture: (request, eventCount) => {
        if (!controller.owns(request)) return false;
        if (!controller.recaptureAnchor(request, scrollRef.current, eventCount)) {
          clear(request);
          return false;
        }
        captureLedger(request);
        return true;
      },
      clear,
      finish: (request, committed) => {
        if (!controller.owns(request)) return;
        if (!committed) clear(request);
        controller.finish(request, committed);
      },
    };
  }, [controller, scrollRef, eventIndex, capture, clearCapture]);
