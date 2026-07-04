import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { createThreadOpenSeedSession } from './threadOpenSeedController';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';
import { runThreadOpenPostBootstrapRefresh } from './threadOpenPostBootstrapRefresh';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';
import {
  runThreadOpenTargetEvent,
  type PendingThreadOpen,
} from './threadOpenTargetEvent';
import type { PersistThreadEventCache } from '../engine/enginePersistFacade';
import type { Timeline } from './timelinePagination';
import type { ThreadOpenCacheController } from './threadOpenCacheController';
import type { ThreadSeedPrewarmController } from './threadSeedPrewarmController';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

type FocusItemState = {
  eventId?: string;
  highlight: boolean;
  index: number;
  scrollTo: boolean;
};

export const useThreadOpenLifecycleController = ({
  backfillThreadRelationsIntoCache,
  ensureThreadSeedPrewarm,
  eventId,
  forceTimelineUpdate,
  hydrateThreadFromCache,
  mx,
  onThreadLoadError,
  pendingThreadOpenRef,
  persistThreadEventCache,
  prewarmedThreadSeedIdsRef,
  prewarmingThreadSeedIdsRef,
  prewarmingThreadSeedPromisesRef,
  queuedThreadSeedIdsRef,
  refreshLatestThreadRelationsTail,
  refreshLatestThreadSlice,
  resetThreadBackPagination,
  resetThreadRenderState,
  room,
  roomTimelineSet,
  scrollToBottomRef,
  setAtBottom,
  setFocusItem,
  setPendingThreadOpenTick,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadInitialCacheHydrated,
  setThreadLatestOpenPending,
  setThreadLoadError,
  setThreadPaginatingFront,
  setThreadTailLoaded,
  setThreadTimelineTick,
  setTimeline,
  suppressThreadOpenBottomPinRef,
  threadDebugTraceId,
  threadEditFetchAttemptedRef,
  threadId,
  threadIdRef,
}: {
  backfillThreadRelationsIntoCache: ThreadOpenCacheController['backfillThreadRelationsIntoCache'];
  ensureThreadSeedPrewarm: ThreadSeedPrewarmController['ensureThreadSeedPrewarm'];
  eventId?: string;
  forceTimelineUpdate: () => void;
  hydrateThreadFromCache: ThreadOpenCacheController['hydrateThreadFromCache'];
  mx: MatrixClient;
  onThreadLoadError?: (threadId: string) => void;
  pendingThreadOpenRef: MutableRefObject<PendingThreadOpen | undefined>;
  persistThreadEventCache: PersistThreadEventCache;
  prewarmedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedPromisesRef: MutableRefObject<Map<string, Promise<void>>>;
  queuedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  refreshLatestThreadRelationsTail: ThreadOpenCacheController['refreshLatestThreadRelationsTail'];
  refreshLatestThreadSlice: ThreadOpenCacheController['refreshLatestThreadSlice'];
  resetThreadBackPagination: () => void;
  resetThreadRenderState: (nextThreadId?: string) => void;
  room: Room;
  roomTimelineSet: EventTimelineSet;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setFocusItem: Dispatch<SetStateAction<FocusItemState | undefined>>;
  setPendingThreadOpenTick: Dispatch<SetStateAction<number>>;
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadInitialCacheHydrated: Dispatch<SetStateAction<boolean>>;
  setThreadLatestOpenPending: Dispatch<SetStateAction<boolean>>;
  setThreadLoadError: Dispatch<SetStateAction<boolean>>;
  setThreadPaginatingFront: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  suppressThreadOpenBottomPinRef: MutableRefObject<boolean>;
  threadDebugTraceId: string | undefined;
  threadEditFetchAttemptedRef: MutableRefObject<WeakMap<MatrixEvent, number>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}) => {
  useEffect(() => {
    if (!threadId) return undefined;
    setFocusItem(undefined);
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadTimelineTick(0);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadBackPagination();
    resetThreadRenderState(threadId);
    const shouldScrollToLatestOnOpen = !eventId;
    const threadOpenSeedSession = createThreadOpenSeedSession({
      debugTraceId: threadDebugTraceId,
      ensureThreadSeedPrewarm,
      prewarmedThreadSeedIdsRef,
      prewarmingThreadSeedIdsRef,
      queuedThreadSeedIdsRef,
      prewarmingThreadSeedPromisesRef,
      room,
      roomTimelineSet,
      setSupplementalThreadEvents,
      shouldScrollToLatestOnOpen,
      threadId,
    });
    let mounted = true;
    threadOpenSeedSession.startUntargetedSeedPrewarmWait(
      () => mounted && threadIdRef.current === threadId
    );
    if (!shouldScrollToLatestOnOpen) {
      threadOpenSeedSession.applyInitialRoomThreadSeed();
    }
    setThreadLatestOpenPending(shouldScrollToLatestOnOpen);
    const loadThreadTimeline = async () => {
      const pinThreadToBottomOnOpen = () => {
        if (
          !mounted ||
          threadIdRef.current !== threadId ||
          suppressThreadOpenBottomPinRef.current
        ) {
          return;
        }
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
      };

      try {
        const cacheFirstResult = await runThreadOpenCacheFirst({
          backfillThreadRelationsIntoCache,
          debugTraceId: threadDebugTraceId,
          forceTimelineUpdate,
          hydrateThreadFromCache,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          pinThreadToBottomOnOpen,
          refreshLatestThreadRelationsTail,
          room,
          setThreadHasMoreCachedBack,
          setThreadInitialCacheHydrated,
          setThreadTailLoaded,
          setThreadTimelineTick,
          shouldScrollToLatestOnOpen,
          threadId,
          threadOpenSeedSession,
        });
        if (!cacheFirstResult.shouldContinue) return;

        const shouldContinueAfterSdkBootstrap = await runThreadOpenSdkBootstrap({
          debugTraceId: threadDebugTraceId,
          hydratedCachedPage: cacheFirstResult.hydratedCachedPage,
          isMounted: () => mounted,
          mx,
          onThreadLoadError,
          persistThreadEventCache,
          pinThreadToBottomOnOpen,
          room,
          setSupplementalThreadEvents,
          setThreadHasMoreCachedBack,
          setThreadLoadError,
          setThreadTailLoaded,
          setThreadTimelineTick,
          setTimeline,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterSdkBootstrap) return;

        const shouldContinueAfterPostBootstrapRefresh = await runThreadOpenPostBootstrapRefresh({
          debugTraceId: threadDebugTraceId,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          persistThreadEventCache,
          refreshLatestThreadSlice,
          room,
          setSupplementalThreadEvents,
          setThreadHasMoreCachedBack,
          setThreadTailLoaded,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterPostBootstrapRefresh) return;

        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (shouldScrollToLatestOnOpen) {
          pinThreadToBottomOnOpen();
        }

        const shouldContinueAfterTargetEvent = await runThreadOpenTargetEvent({
          eventId,
          forceTimelineUpdate,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          room,
          setPendingThreadOpen: (pending) => {
            pendingThreadOpenRef.current = pending;
          },
          setPendingThreadOpenTick,
          setThreadTimelineTick,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterTargetEvent) return;
      } finally {
        if (mounted && threadIdRef.current === threadId) {
          setThreadLatestOpenPending(false);
        }
      }
    };

    loadThreadTimeline();

    return () => {
      mounted = false;
      threadOpenSeedSession.cleanup();
    };
  }, [
    backfillThreadRelationsIntoCache,
    ensureThreadSeedPrewarm,
    eventId,
    forceTimelineUpdate,
    hydrateThreadFromCache,
    mx,
    onThreadLoadError,
    pendingThreadOpenRef,
    persistThreadEventCache,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
    queuedThreadSeedIdsRef,
    refreshLatestThreadRelationsTail,
    refreshLatestThreadSlice,
    resetThreadBackPagination,
    resetThreadRenderState,
    room,
    roomTimelineSet,
    scrollToBottomRef,
    setAtBottom,
    setFocusItem,
    setPendingThreadOpenTick,
    setSupplementalThreadEvents,
    setThreadHasMoreCachedBack,
    setThreadInitialCacheHydrated,
    setThreadLatestOpenPending,
    setThreadLoadError,
    setThreadTailLoaded,
    setThreadTimelineTick,
    setTimeline,
    suppressThreadOpenBottomPinRef,
    threadDebugTraceId,
    threadEditFetchAttemptedRef,
    threadId,
    threadIdRef,
  ]);

  useEffect(() => {
    if (threadId) return;
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadLatestOpenPending(false);
    setThreadTimelineTick(0);
    setThreadPaginatingFront(false);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadBackPagination();
    resetThreadRenderState(undefined);
  }, [
    pendingThreadOpenRef,
    resetThreadBackPagination,
    resetThreadRenderState,
    setPendingThreadOpenTick,
    setThreadHasMoreCachedBack,
    setThreadInitialCacheHydrated,
    setThreadLatestOpenPending,
    setThreadLoadError,
    setThreadPaginatingFront,
    setThreadTailLoaded,
    setThreadTimelineTick,
    threadEditFetchAttemptedRef,
    threadId,
  ]);
};
