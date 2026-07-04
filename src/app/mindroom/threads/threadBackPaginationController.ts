import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  captureThreadPrependScrollAnchor,
  restoreThreadPrependScrollAnchor,
  type ThreadPrependScrollAnchor,
} from './timelineScrollUtils';

type PendingThreadBackPaginationAnchor = ThreadPrependScrollAnchor & {
  eventCount?: number;
  threadId: string;
  // Distinguishes successive captures even when they anchor the same event id
  // (e.g. a rapid second Load Older with the same first-visible row).
  seq: number;
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
  clearPendingAnchor: () => void;
  recaptureAnchor: (
    threadId: string | undefined,
    scrollRoot: HTMLElement | null | undefined,
    eventCount?: number
  ) => boolean;
  getPendingAnchorEventId: () => string | undefined;
  getPendingAnchorSeq: () => number | undefined;
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
  const pendingAnchorSeqRef = useRef(0);

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
      pendingAnchorSeqRef.current += 1;
      pendingAnchorRef.current = capturedAnchor
        ? {
            ...capturedAnchor,
            eventCount,
            threadId,
            seq: pendingAnchorSeqRef.current,
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

  // Task #125 follow-up: with the prepend render commit deferred to
  // scroll quiescence, the begin-time anchor goes stale — the user
  // keeps scrolling between fire and commit, and restoring the old
  // anchor would teleport them back to the fire position. Re-capture
  // just before the commit so the restore targets where the user
  // actually is. Only valid while a pagination is in flight.
  const recaptureAnchor = useCallback(
    (
      threadId: string | undefined,
      scrollRoot: HTMLElement | null | undefined,
      eventCount?: number
    ): boolean => {
      if (!threadId || !isPaginatingBackRef.current) return false;
      const capturedAnchor = captureThreadPrependScrollAnchor(scrollRoot);
      if (!capturedAnchor) return false;
      pendingAnchorSeqRef.current += 1;
      pendingAnchorRef.current = {
        ...capturedAnchor,
        eventCount,
        threadId,
        seq: pendingAnchorSeqRef.current,
      };
      return true;
    },
    []
  );

  const getPendingAnchorEventId = useCallback(() => pendingAnchorRef.current?.eventId, []);

  const getPendingAnchorSeq = useCallback(() => pendingAnchorRef.current?.seq, []);

  const clearPendingAnchor = useCallback(() => {
    pendingAnchorRef.current = undefined;
  }, []);

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
    clearPendingAnchor,
    recaptureAnchor,
    getPendingAnchorEventId,
    getPendingAnchorSeq,
    restorePendingAnchor,
  };
};
