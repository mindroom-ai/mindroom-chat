import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import type { MutableRefObject } from 'react';
import { hydrateCachedEvents } from '../../features/room/eventCacheEditUtils';
import { logTimelineDebug } from '../../features/room/timelineDebug';
import { reactionOrEditEvent } from '../../utils/room';
import {
  getLoadedRoomThreadEvents,
  getLoadedRoomThreadSeedEvents,
  getLoadedThreadModelSeedEvents,
  THREAD_OPEN_PREWARM_WAIT_MS,
} from './threadBootstrap';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot } from './threadOpenSeedCache';

type ThreadOpenSeedSource = 'initial' | 'room-prewarm';

type CreateThreadOpenSeedSessionOptions = {
  debugTraceId: string | undefined;
  ensureThreadSeedPrewarm: (
    threadId: string,
    opts?: {
      allowWhileThreadOpen?: boolean;
      logPrefix?: string;
      traceId?: string;
    }
  ) => Promise<void>;
  prewarmedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedIdsRef: MutableRefObject<Set<string>>;
  queuedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedPromisesRef: MutableRefObject<Map<string, Promise<void>>>;
  room: Room;
  roomTimelineSet: EventTimelineSet;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

export type ThreadOpenSeedSession = {
  applyInitialRoomThreadSeed: () => boolean;
  applyInitialUntargetedThreadSeed: (
    memorySeedEvents?: MatrixEvent[],
    source?: ThreadOpenSeedSource
  ) => boolean;
  cleanup: () => void;
  initialRoomThreadEvents: MatrixEvent[];
  initialRoomThreadSeedEvents: MatrixEvent[];
  initialThreadMemorySeedEvents: MatrixEvent[];
  mergeWithInitialRoomThreadSeedEvents: (events: MatrixEvent[]) => MatrixEvent[];
  startUntargetedSeedPrewarmWait: (isCurrentThreadOpen: () => boolean) => void;
};

export const createThreadOpenSeedSession = ({
  debugTraceId,
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
}: CreateThreadOpenSeedSessionOptions): ThreadOpenSeedSession => {
  const initialRoomThreadEvents = getLoadedRoomThreadEvents(room, threadId);
  const hasInitialRoomThreadVisibleEvents = initialRoomThreadEvents.length > 0;
  const initialThreadMemorySeedEvents = shouldScrollToLatestOnOpen
    ? getThreadOpenSeedSnapshot(room, threadId)
    : [];
  const initialThreadModelSeedEvents = shouldScrollToLatestOnOpen
    ? getLoadedThreadModelSeedEvents(room, threadId)
    : [];
  const initialRoomThreadSeedEvents = hasInitialRoomThreadVisibleEvents
    ? getLoadedRoomThreadSeedEvents(room, threadId)
    : [];

  const buildUntargetedThreadSeedEvents = (memorySeedEvents: MatrixEvent[]) =>
    shouldScrollToLatestOnOpen
      ? mergeThreadBackfillEvents(
          memorySeedEvents,
          mergeThreadBackfillEvents(initialThreadModelSeedEvents, initialRoomThreadSeedEvents)
        )
      : [];

  const initialUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(
    initialThreadMemorySeedEvents
  );

  logTimelineDebug(debugTraceId, 'thread-open-seed-scan', {
    localThreadMemorySeedCount: initialThreadMemorySeedEvents.length,
    localThreadModelSeedCount: initialThreadModelSeedEvents.length,
    mergedSeedVisibleCount: initialUntargetedThreadSeedEvents.filter(
      (mEvent) => !reactionOrEditEvent(mEvent) && !mEvent.isRedaction()
    ).length,
    mergedSeedCount: initialUntargetedThreadSeedEvents.length,
    seedRelationCount: Math.max(
      0,
      initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length
    ),
    seedVisibleCount: initialRoomThreadEvents.length,
    threadId,
  });

  let untargetedThreadSeedApplied = false;
  let untargetedThreadSeedFallbackTimeout: ReturnType<typeof setTimeout> | undefined;

  const hydrateInitialRoomThreadSeedEvents = () => {
    if (!hasInitialRoomThreadVisibleEvents) return;
    hydrateCachedEvents({
      room,
      events: initialRoomThreadSeedEvents,
      timelineSets: [roomTimelineSet],
    });
  };

  const applyInitialUntargetedThreadSeed = (
    memorySeedEvents: MatrixEvent[] = initialThreadMemorySeedEvents,
    source: ThreadOpenSeedSource = 'initial'
  ): boolean => {
    if (untargetedThreadSeedApplied) return true;

    hydrateInitialRoomThreadSeedEvents();
    const nextUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(memorySeedEvents);
    if (nextUntargetedThreadSeedEvents.length === 0) return false;

    untargetedThreadSeedApplied = true;
    setSupplementalThreadEvents(threadId, nextUntargetedThreadSeedEvents);
    logTimelineDebug(debugTraceId, 'thread-open-live-seed-applied', {
      memorySeedCount: memorySeedEvents.length,
      modelSeedVisibleCount: initialThreadModelSeedEvents.length,
      roomSeedVisibleCount: initialRoomThreadEvents.length,
      seedCount: nextUntargetedThreadSeedEvents.length,
      source,
      threadId,
    });
    return true;
  };

  const applyInitialRoomThreadSeed = (): boolean => {
    if (!hasInitialRoomThreadVisibleEvents) return false;

    hydrateInitialRoomThreadSeedEvents();
    setSupplementalThreadEvents(threadId, initialRoomThreadEvents);
    logTimelineDebug(debugTraceId, 'thread-open-seed-applied', {
      seedRelationCount: Math.max(
        0,
        initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length
      ),
      seedVisibleCount: initialRoomThreadEvents.length,
      threadId,
    });
    return true;
  };

  const maybeApplyPrewarmedUntargetedThreadSeed = (): boolean => {
    const prewarmedMemorySeedEvents = getThreadOpenSeedSnapshot(room, threadId);
    if (prewarmedMemorySeedEvents.length > initialThreadMemorySeedEvents.length) {
      return applyInitialUntargetedThreadSeed(prewarmedMemorySeedEvents, 'room-prewarm');
    }
    return false;
  };

  const startUntargetedSeedPrewarmWait = (isCurrentThreadOpen: () => boolean): void => {
    if (!shouldScrollToLatestOnOpen) return;

    const shouldAwaitRoomPrewarm =
      prewarmedThreadSeedIdsRef.current.has(threadId) ||
      prewarmingThreadSeedIdsRef.current.has(threadId) ||
      queuedThreadSeedIdsRef.current.has(threadId);
    const threadSeedPrewarmPromise = shouldAwaitRoomPrewarm
      ? prewarmingThreadSeedPromisesRef.current.get(threadId) ??
        ensureThreadSeedPrewarm(threadId, {
          allowWhileThreadOpen: true,
          logPrefix: 'thread-open-room-prewarm',
          traceId: debugTraceId,
        })
      : undefined;

    if (threadSeedPrewarmPromise) {
      logTimelineDebug(debugTraceId, 'thread-open-awaiting-room-prewarm', {
        threadId,
      });
      untargetedThreadSeedFallbackTimeout = setTimeout(() => {
        if (!isCurrentThreadOpen()) return;
        if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
        applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
      }, THREAD_OPEN_PREWARM_WAIT_MS);
      void threadSeedPrewarmPromise.finally(() => {
        if (untargetedThreadSeedFallbackTimeout !== undefined) {
          clearTimeout(untargetedThreadSeedFallbackTimeout);
          untargetedThreadSeedFallbackTimeout = undefined;
        }
        if (!isCurrentThreadOpen()) return;
        if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
        applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
      });
      return;
    }

    if (!maybeApplyPrewarmedUntargetedThreadSeed()) {
      applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
    }
  };

  return {
    applyInitialRoomThreadSeed,
    applyInitialUntargetedThreadSeed,
    cleanup: () => {
      if (untargetedThreadSeedFallbackTimeout !== undefined) {
        clearTimeout(untargetedThreadSeedFallbackTimeout);
        untargetedThreadSeedFallbackTimeout = undefined;
      }
    },
    initialRoomThreadEvents,
    initialRoomThreadSeedEvents,
    initialThreadMemorySeedEvents,
    mergeWithInitialRoomThreadSeedEvents: (events) =>
      initialRoomThreadSeedEvents.length > 0
        ? mergeThreadBackfillEvents(events, initialRoomThreadSeedEvents)
        : events,
    startUntargetedSeedPrewarmWait,
  };
};
