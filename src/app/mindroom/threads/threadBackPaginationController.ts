import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  captureThreadPrependScrollAnchor,
  restoreThreadPrependScrollAnchor,
  type ThreadPrependScrollAnchor,
} from './timelineScrollUtils';

type PendingThreadBackPaginationAnchor = ThreadPrependScrollAnchor & {
  eventCount?: number;
  threadId: string;
};

export type ThreadBackPaginationController = {
  isPaginatingBack: boolean;
  isPaginatingBackRef: MutableRefObject<boolean>;
  suppressOpenBottomPinRef: MutableRefObject<boolean>;
  reset: () => void;
  begin: (
    threadId: string | undefined,
    scrollRoot: HTMLElement | null | undefined,
    eventCount?: number
  ) => boolean;
  finish: (opts: { didPaginateBack: boolean; threadId: string; currentThreadId?: string }) => void;
  restorePendingAnchor: (
    scrollRoot: HTMLElement | null | undefined,
    threadId: string | undefined,
    eventCount?: number
  ) => boolean;
};

export const useThreadBackPaginationController = (): ThreadBackPaginationController => {
  const [isPaginatingBack, setIsPaginatingBack] = useState(false);
  const isPaginatingBackRef = useRef(false);
  const suppressOpenBottomPinRef = useRef(false);
  const pendingAnchorRef = useRef<PendingThreadBackPaginationAnchor | undefined>();

  useEffect(() => {
    isPaginatingBackRef.current = isPaginatingBack;
  }, [isPaginatingBack]);

  const reset = useCallback(() => {
    pendingAnchorRef.current = undefined;
    suppressOpenBottomPinRef.current = false;
    isPaginatingBackRef.current = false;
    setIsPaginatingBack(false);
  }, []);

  const begin = useCallback(
    (
      threadId: string | undefined,
      scrollRoot: HTMLElement | null | undefined,
      eventCount?: number
    ): boolean => {
      if (!threadId || isPaginatingBackRef.current) return false;

      suppressOpenBottomPinRef.current = true;
      const capturedAnchor = captureThreadPrependScrollAnchor(scrollRoot);
      pendingAnchorRef.current = capturedAnchor
        ? {
            ...capturedAnchor,
            eventCount,
            threadId,
          }
        : undefined;
      isPaginatingBackRef.current = true;
      setIsPaginatingBack(true);
      return true;
    },
    []
  );

  const finish = useCallback(
    ({
      didPaginateBack,
      threadId,
      currentThreadId,
    }: {
      didPaginateBack: boolean;
      threadId: string;
      currentThreadId?: string;
    }) => {
      if (!didPaginateBack && currentThreadId === threadId) {
        pendingAnchorRef.current = undefined;
      }
      isPaginatingBackRef.current = false;
      setIsPaginatingBack(false);
    },
    []
  );

  const restorePendingAnchor = useCallback(
    (
      scrollRoot: HTMLElement | null | undefined,
      threadId: string | undefined,
      eventCount = 0
    ): boolean => {
      if (!threadId) {
        pendingAnchorRef.current = undefined;
        return false;
      }

      const pendingAnchor = pendingAnchorRef.current;
      if (!pendingAnchor || pendingAnchor.threadId !== threadId) return false;
      if (
        typeof eventCount === 'number' &&
        typeof pendingAnchor.eventCount === 'number' &&
        eventCount <= pendingAnchor.eventCount
      ) {
        return false;
      }

      const restored = restoreThreadPrependScrollAnchor(scrollRoot, pendingAnchor);
      if (restored) {
        pendingAnchorRef.current = undefined;
      }
      return restored;
    },
    []
  );

  return {
    isPaginatingBack,
    isPaginatingBackRef,
    suppressOpenBottomPinRef,
    reset,
    begin,
    finish,
    restorePendingAnchor,
  };
};
