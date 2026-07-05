import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import { getLinkedTimelines } from './timelinePagination';
import { logTimelineDebug } from './timelineDebug';
import { countCacheProbe } from './cacheProbe';
import { createPreferLiveEventMapper, mapCachedThreadPageEvents } from './eventRepository';
import {
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldBackfillThreadRelationsFromCoverage,
} from './threadCacheCoverage';
import type { HydratedThreadCachePage } from './types';
import type { ThreadOpenCacheController } from './threadOpenCacheController';
import type { ReconcileResult, ScheduleReconcileArgs } from '../engine/reconciler';

type ThreadOpenSeedSession = {
  applyInitialUntargetedThreadSeed: () => void;
  mergeWithInitialRoomThreadSeedEvents: (events: MatrixEvent[]) => MatrixEvent[];
};

/**
 * Injected scheduler entry point. Component-side callers pre-bind the
 * engine's mx / sessionId / scheduler so this file does not need to
 * reach into the engine directly (keeps arch-guard boundaries clean).
 */
export type ScheduleReconcileFn = (
  args: Pick<
    ScheduleReconcileArgs,
    'roomId' | 'room' | 'threadId' | 'cachedPage' | 'reason' | 'onRepaired'
  >
) => Promise<ReconcileResult>;

type RunThreadOpenCacheFirstOptions = {
  backfillThreadRelationsIntoCache: ThreadOpenCacheController['backfillThreadRelationsIntoCache'];
  debugTraceId: string | undefined;
  forceTimelineUpdate: () => void;
  hydrateThreadFromCache: ThreadOpenCacheController['hydrateThreadFromCache'];
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  pinThreadToBottomOnOpen: () => void;
  /**
   * CINNY-207 P5.1 (D7): replaces the deleted
   * `refreshLatestThreadRelationsTail`. The complete-coverage path
   * still schedules a reconcile so a stale cache converges after open
   * without reload — coverage decides PAINT, never REVALIDATE.
   */
  scheduleReconcile: ScheduleReconcileFn;
  room: Room;
  /**
   * CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection, render leg): the
   * reconciler's widened `onRepaired` callback hands us the
   * fully-mapped batch of fetched events; we route them into the
   * render's supplemental-events sink so the complete-coverage
   * cache-first path (SDK bootstrap skipped by design) converges. The
   * sink itself lives in `useThreadRenderState.setSupplementalThreadEvents`
   * and dedups by event id, so re-passing an already-known live event
   * is a no-op there. Kept as a separate injected function so this
   * module does not import from `useThreadRenderState` and so the
   * engine boundary stays clean (engine has no knowledge of
   * `setSupplementalThreadEvents`).
   */
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadInitialCacheHydrated: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
  threadOpenSeedSession: ThreadOpenSeedSession;
};

type RunThreadOpenCacheFirstResult = {
  hydratedCachedPage?: HydratedThreadCachePage;
  shouldContinue: boolean;
};

export const runThreadOpenCacheFirst = async ({
  backfillThreadRelationsIntoCache,
  debugTraceId,
  forceTimelineUpdate,
  hydrateThreadFromCache,
  isCurrentThreadOpen,
  mx,
  pinThreadToBottomOnOpen,
  scheduleReconcile,
  room,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadInitialCacheHydrated,
  setThreadTailLoaded,
  setThreadTimelineTick,
  shouldScrollToLatestOnOpen,
  threadId,
  threadOpenSeedSession,
}: RunThreadOpenCacheFirstOptions): Promise<RunThreadOpenCacheFirstResult> => {
  let hydratedCachedPage;
  try {
    hydratedCachedPage = await hydrateThreadFromCache(threadId);
  } catch {
    if (!isCurrentThreadOpen()) {
      // AC2 STEP 4 iter 2 (2026-07-04): hydrate threw and the guard
      // says the thread has been closed/re-navigated in the meantime.
      // No scheduleReconcile fires — count this skip.
      countCacheProbe('threadOpenSkipCacheFirstHydrateGuard');
      return { shouldContinue: false };
    }
    hydratedCachedPage = undefined;
  }
  if (!isCurrentThreadOpen()) {
    // AC2 STEP 4 iter 2 (2026-07-04): guard flipped between hydrate
    // returning and this check — the open aborted before we reached
    // the choke-point schedule. This is one of the two legitimate
    // "no reconcile fires" paths: the thread is closed, there is no
    // convergence work to do.
    countCacheProbe('threadOpenSkipCacheFirstPostHydrateGuard');
    return { shouldContinue: false };
  }

  // CINNY-207 AC2 revision (2026-07-04): SINGLE UNSKIPPABLE CHOKE-POINT
  // SCHEDULE. Product-owner directive replaces the earlier bandage shape
  // (bolt a `scheduleReconcile` onto each branch that could bail without
  // scheduling). D7 SWR rule: coverage decides PAINT, never REVALIDATE
  // — so the reconcile schedule belongs ABOVE every coverage/bootstrap
  // conditional, structurally impossible for any early return to skip.
  //
  // Every thread open that survives the hydrate + post-hydrate guards
  // schedules exactly one reconcile here. The scheduler's
  // (roomId|threadId|kind=reconcile) dedup key coalesces this call
  // against any in-flight reconcile from a prior tab/focus event.
  //
  // The reconciler runs to completion regardless of navigation (the
  // paired R1/R2 revert removed `shouldContinue` from the engine); the
  // component-mount check lives inside `onRepaired` so a moved-away
  // component no-ops on render while the persist leg still teaches the
  // cache.
  //
  // The `cachedPage` argument is the hydrated snapshot (may be
  // undefined). The reconciler uses it to short-circuit its fetch loop
  // when the fetched chunk overlaps the cached window by event id — so
  // the "cached was right" case still costs at most one /relations page.
  countCacheProbe('threadOpenScheduledCacheFirst');
  void scheduleReconcile({
    roomId: room.roomId,
    room,
    threadId,
    cachedPage: hydratedCachedPage,
    reason: 'open-thread-choke-point',
    onRepaired: (repairedEvents) => {
      // CINNY-207 AC2 render-gap RG1 (2026-07-04): sink counters.
      // These three counters partition the outcomes of the
      // component-side onRepaired callback so a docker probe snapshot
      // can name which seam the render-gap lives at without another
      // blind cycle. Invariant asserted by the render-gap
      // instrumentation:
      //   reconcilesOnRepairedFired ==
      //     onRepairedGuardBailed +
      //     supplementalEventsExecuted +
      //     supplementalEventsSkippedEmpty
      // (reconcilesOnRepairedFired is bumped in reconciler.ts BEFORE
      // this callback is invoked.)
      if (!isCurrentThreadOpen()) {
        countCacheProbe('onRepairedGuardBailed');
        return;
      }
      if (repairedEvents.length > 0) {
        setSupplementalThreadEvents(threadId, [...repairedEvents]);
        countCacheProbe('supplementalEventsExecuted');
      } else {
        countCacheProbe('supplementalEventsSkippedEmpty');
      }
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
    },
  }).catch((err) => {
    // CINNY-207 AC2 review F6 (2026-07-04): the scheduler's own
    // rejection paths already bump `schedulerFailed` /
    // `schedulerAborted`, so this catch used to silently return
    // undefined to avoid an unhandled promise rejection. That left a
    // triage ambiguity: from a browser log you couldn't tell WHICH
    // rejection this was, only that one had happened. A single warn
    // line here names the site without changing behavior — the
    // counters remain the source of truth for aggregate counts.
    // eslint-disable-next-line no-console
    console.warn('[thread-open-choke-point] scheduleReconcile rejected', err);
  });

  const cachedThreadHasLocalSnapshot =
    !!hydratedCachedPage &&
    hasUsableThreadCacheSnapshot({
      eventCount: hydratedCachedPage.events.length,
      rootPresent: !!hydratedCachedPage.rootEvent,
    });

  if (shouldScrollToLatestOnOpen && !cachedThreadHasLocalSnapshot) {
    threadOpenSeedSession.applyInitialUntargetedThreadSeed();
  }
  setThreadInitialCacheHydrated(true);

  const hasCompleteCachedThreadSnapshot =
    shouldScrollToLatestOnOpen &&
    !!hydratedCachedPage &&
    isCompleteThreadCacheCoverage({
      coverage: hydratedCachedPage.cacheCoverage,
      hasLocalSnapshot: cachedThreadHasLocalSnapshot,
    });

  if (hasCompleteCachedThreadSnapshot && hydratedCachedPage) {
    const firstThreadLiveTimeline = room
      .getThread(threadId)
      ?.getUnfilteredTimelineSet()
      .getLiveTimeline();
    const firstThreadTimeline = firstThreadLiveTimeline
      ? getLinkedTimelines(firstThreadLiveTimeline)[0]
      : undefined;
    firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
    setThreadHasMoreCachedBack(false);
    setThreadTailLoaded(true);
    forceTimelineUpdate();
    setThreadTimelineTick((val) => val + 1);
    logTimelineDebug(debugTraceId, 'thread-open-complete-cache-hit', {
      cachedCount: hydratedCachedPage.events.length,
      threadId,
    });
    logTimelineDebug(debugTraceId, 'thread-open-complete', {
      shouldScrollToLatestOnOpen,
      skipNetworkBootstrap: true,
      threadId,
    });
    // CINNY-207 AC2 revision (2026-07-04): the branch-local reconcile
    // schedule that used to live here has been relocated to the
    // choke-point call above (after the post-hydrate guard). D7 says
    // coverage decides PAINT, never REVALIDATE — the schedule sits
    // above the coverage branching now, so this branch only PAINTS
    // and returns.
    pinThreadToBottomOnOpen();
    return {
      hydratedCachedPage,
      shouldContinue: false,
    };
  }

  const canBackfillThreadRelations =
    shouldScrollToLatestOnOpen &&
    !!hydratedCachedPage &&
    shouldBackfillThreadRelationsFromCoverage({
      coverage: hydratedCachedPage.cacheCoverage,
      hasLocalSnapshot: cachedThreadHasLocalSnapshot,
    });
  if (canBackfillThreadRelations && hydratedCachedPage) {
    const mapper = mx.getEventMapper();
    const cachedSnapshotEvents = mapCachedThreadPageEvents({
      events: hydratedCachedPage.events,
      rootEvent: hydratedCachedPage.rootEvent,
      mapEvent: createPreferLiveEventMapper(room, mapper),
    });
    const baselineBackfillEvents =
      threadOpenSeedSession.mergeWithInitialRoomThreadSeedEvents(cachedSnapshotEvents);
    const relationBackfill = await backfillThreadRelationsIntoCache(
      threadId,
      hydratedCachedPage.rootEvent,
      baselineBackfillEvents,
      hydratedCachedPage.expectedReplyCount
    );
    if (!isCurrentThreadOpen()) {
      // Guard flipped between backfill returning and this check. The
      // choke-point reconcile already fired above so no skip counter
      // is needed — the reconcile runs to completion regardless of
      // navigation.
      return { shouldContinue: false };
    }
    if (relationBackfill?.completed) {
      logTimelineDebug(debugTraceId, 'thread-open-complete', {
        completedBy: 'relations-backfill',
        shouldScrollToLatestOnOpen,
        skipNetworkBootstrap: true,
        threadId,
      });
      pinThreadToBottomOnOpen();
      // CINNY-207 AC2 revision (2026-07-04): the bandage-shape schedule
      // that iter 2 STEP d added here has been removed. The choke-point
      // schedule at the top of this function covers this path — the
      // backfill-completed branch just PAINTS and returns.
      return {
        hydratedCachedPage,
        shouldContinue: false,
      };
    }
  }

  return {
    hydratedCachedPage,
    shouldContinue: true,
  };
};
