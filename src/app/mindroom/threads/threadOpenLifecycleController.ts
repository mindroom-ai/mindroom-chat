import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import type { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { createThreadOpenSeedSession } from './threadOpenSeedController';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';
import {
  runThreadOpenTargetEvent,
  type PendingThreadOpen,
} from './threadOpenTargetEvent';
import type { PersistThreadEventCache } from '../engine/enginePersistFacade';
import type { Timeline } from './timelinePagination';
import type { ThreadOpenCacheController } from './threadOpenCacheController';
import type { ThreadSeedPrewarmController } from './threadSeedPrewarmController';
import type { ScheduleReconcileFn } from './threadOpenCacheFirst';

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
  refreshLatestThreadSlice,
  scheduleReconcile,
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
  refreshLatestThreadSlice: ThreadOpenCacheController['refreshLatestThreadSlice'];
  /**
   * CINNY-207 P5.1: replaces the deleted
   * `refreshLatestThreadRelationsTail`. Both the cache-first path (see
   * `runThreadOpenCacheFirst`) and this lifecycle controller schedule
   * a reconcile pass on every open — coverage decides paint, never
   * revalidation.
   */
  scheduleReconcile: ScheduleReconcileFn;
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
          scheduleReconcile,
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

        // CINNY-207 P5.1 (D7 / AC9): the partial-coverage path also
        // schedules a reconcile — every open, without exception. The
        // scheduler dedups against the complete-coverage schedule from
        // `runThreadOpenCacheFirst` when both fire on the same open,
        // so the second call returns the in-flight promise identity
        // rather than firing a duplicate fetch.
        void scheduleReconcile({
          roomId: room.roomId,
          room,
          threadId,
          cachedPage: cacheFirstResult.hydratedCachedPage,
          reason: 'open-partial-coverage',
          onRepaired: () => {
            if (!mounted || threadIdRef.current !== threadId) return;
            forceTimelineUpdate();
            setThreadTimelineTick((val) => val + 1);
          },
          shouldContinue: () => mounted && threadIdRef.current === threadId,
        }).catch(() => undefined);

        // CINNY-207 P5.1 Commit 2: `runThreadOpenPostBootstrapRefresh`
        // was deleted. Its two behaviors are inlined here.
        //
        // shouldScrollToLatestOnOpen=true → the jump-to-latest full
        // pagination stays as-is (refreshLatestThreadSlice — not the
        // pre-P5 tail refresh; a genuinely different function that
        // loads all backward history for the "go to bottom" flow).
        //
        // shouldScrollToLatestOnOpen=false → the pre-P5 refresher's
        // limit-200 fetchRelations is REPLACED by the P5 reconcile
        // that was scheduled above (see the scheduleReconcile call
        // after runThreadOpenSdkBootstrap). The forward-gap check +
        // 'thread-open-forward-gap-check' log still fires from here
        // so the arch guard can keep asserting the log string exists.
        if (shouldScrollToLatestOnOpen) {
          await refreshLatestThreadSlice(threadId);
          if (!mounted || threadIdRef.current !== threadId) return;
        } else {
          const hasForwardGap = !!room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline()
            .getPaginationToken(Direction.Forward);
          if (!hasForwardGap) {
            setThreadTailLoaded(true);
          }
          logTimelineDebug(threadDebugTraceId, 'thread-open-forward-gap-check', {
            hasForwardGap,
            threadId,
          });
        }

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
    refreshLatestThreadSlice,
    scheduleReconcile,
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
