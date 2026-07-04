import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import type { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { countCacheProbe } from './cacheProbe';
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
    // AC2 STEP 4 iter 2 (2026-07-04): every open of a thread bumps
    // exactly here. The invariant asserted from a docker probe is that
    // this counter equals the sum of `threadOpenScheduledCacheFirst +
    // threadOpenScheduledLifecycle + all threadOpenSkip*` counters —
    // proving which route(s) each open took.
    countCacheProbe('threadOpens');
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
          // CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection, render leg):
          // wire the render's supplemental-events sink into the
          // cache-first path so the reconciler's widened `onRepaired`
          // batch can converge the complete-coverage fallback state.
          setSupplementalThreadEvents,
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
        //
        // AC2 STEP 4 iter 2 (2026-07-04): probe increment goes BEFORE
        // the scheduler call for the same reason as the cache-first
        // site — separate "the open path asked for a reconcile" from
        // "the reconciler exited via which path" (STEP 1 counters).
        countCacheProbe('threadOpenScheduledLifecycle');
        void scheduleReconcile({
          roomId: room.roomId,
          room,
          threadId,
          cachedPage: cacheFirstResult.hydratedCachedPage,
          reason: 'open-partial-coverage',
          // P5-GATE-FIX v3 (AC2 dual-injection, render leg): even on
          // the partial-coverage path where SDK bootstrap DID run,
          // routing the repaired batch through
          // `setSupplementalThreadEvents` keeps the render's fallback
          // events aligned with the SDK's newly-injected events —
          // `mergeThreadRenderEvents` inside the sink dedups by
          // event id so double-injection is a no-op there.
          onRepaired: (repairedEvents) => {
            if (!mounted || threadIdRef.current !== threadId) return;
            if (repairedEvents.length > 0) {
              setSupplementalThreadEvents(threadId, [...repairedEvents]);
            }
            forceTimelineUpdate();
            setThreadTimelineTick((val) => val + 1);
          },
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

    // CINNY-207 P7.2 audit finding #1: the thread-open chain awaits
    // `enqueueThreadBackfillJob` (threadOpenCacheController.ts) which
    // rejects with the abort reason when engine.stop() drains the
    // scheduler (see `abortAll` in `backfillScheduler.ts`). Every layer
    // in the chain — `backfillThreadRelationsIntoCache`,
    // `runThreadOpenCacheFirst`, and `loadThreadTimeline`'s try/FINALLY
    // — lacks a catch, so a queued thread-backfill job aborted during
    // teardown surfaced as an unhandled promise rejection. Swallow here
    // so the outer promise settles quietly on both abort and any other
    // downstream throw; the try/finally inside `loadThreadTimeline`
    // already clears the pending-open flag, and `onThreadLoadError` is
    // invoked from `runThreadOpenSdkBootstrap` on the paths where a
    // user-visible error banner is appropriate.
    loadThreadTimeline().catch(() => undefined);

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
