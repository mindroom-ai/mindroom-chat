import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from '../../features/room/timelineDebug';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import {
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';

type ThreadSeedPrewarmTarget = {
  threadId: string;
};

type EnsureThreadSeedPrewarmOptions = {
  allowWhileThreadOpen?: boolean;
  generation?: number;
  logPrefix?: string;
  traceId?: string;
};

export type ThreadSeedPrewarmController = {
  ensureThreadSeedPrewarm: (
    expectedThreadId: string,
    opts?: EnsureThreadSeedPrewarmOptions
  ) => Promise<void>;
  prewarmedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedIdsRef: MutableRefObject<Set<string>>;
  queuedThreadSeedIdsRef: MutableRefObject<Set<string>>;
  prewarmingThreadSeedPromisesRef: MutableRefObject<Map<string, Promise<void>>>;
};

export const useThreadSeedPrewarmController = ({
  room,
  activeThreadId,
  priorityTargets,
  loadThreadOpenSeedSnapshotFromCache,
  debugTraceId,
}: {
  room: Room;
  activeThreadId: string | undefined;
  priorityTargets: ThreadSeedPrewarmTarget[];
  loadThreadOpenSeedSnapshotFromCache: (expectedThreadId: string) => Promise<MatrixEvent[]>;
  debugTraceId: string;
}): ThreadSeedPrewarmController => {
  const activeThreadIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const prewarmedThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingThreadSeedPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const queuedThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const threadSeedPrewarmQueueRef = useRef<string[]>([]);
  const threadSeedPrewarmRunningRef = useRef(false);
  const threadSeedPrewarmGenerationRef = useRef(0);

  useEffect(() => {
    threadSeedPrewarmGenerationRef.current += 1;
    prewarmedThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedPromisesRef.current.clear();
    queuedThreadSeedIdsRef.current.clear();
    threadSeedPrewarmQueueRef.current = [];
    threadSeedPrewarmRunningRef.current = false;
  }, [room.roomId]);

  const ensureThreadSeedPrewarm = useCallback(
    (
      expectedThreadId: string,
      opts?: EnsureThreadSeedPrewarmOptions
    ): Promise<void> => {
      const existingPromise = prewarmingThreadSeedPromisesRef.current.get(expectedThreadId);
      if (existingPromise) return existingPromise;
      if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) {
        return Promise.resolve();
      }

      const generation = opts?.generation ?? threadSeedPrewarmGenerationRef.current;
      const traceId = opts?.traceId ?? debugTraceId;
      const logPrefix = opts?.logPrefix ?? 'room-thread-seed-prewarm';
      prewarmingThreadSeedIdsRef.current.add(expectedThreadId);
      logTimelineDebug(traceId, `${logPrefix}-start`, {
        threadId: expectedThreadId,
      });

      const prewarmPromise = (async () => {
        try {
          const cachedSeedEvents = await loadThreadOpenSeedSnapshotFromCache(expectedThreadId);
          if (generation !== threadSeedPrewarmGenerationRef.current) return;
          if (!opts?.allowWhileThreadOpen && activeThreadIdRef.current) return;

          if (cachedSeedEvents.length > 0) {
            const nextSeedEvents = mergeThreadBackfillEvents(
              getThreadOpenSeedSnapshot(room, expectedThreadId),
              cachedSeedEvents
            );
            saveThreadOpenSeedSnapshot(room, expectedThreadId, nextSeedEvents);
            logTimelineDebug(traceId, `${logPrefix}-complete`, {
              cachedCount: cachedSeedEvents.length,
              seedCount: nextSeedEvents.length,
              threadId: expectedThreadId,
            });
          } else {
            logTimelineDebug(traceId, `${logPrefix}-empty`, {
              threadId: expectedThreadId,
            });
          }

          prewarmedThreadSeedIdsRef.current.add(expectedThreadId);
        } catch (error) {
          logTimelineDebug(traceId, `${logPrefix}-error`, {
            error: error instanceof Error ? error.message : String(error),
            threadId: expectedThreadId,
          });
        } finally {
          prewarmingThreadSeedIdsRef.current.delete(expectedThreadId);
        }
      })();

      prewarmingThreadSeedPromisesRef.current.set(expectedThreadId, prewarmPromise);
      void prewarmPromise.finally(() => {
        if (
          prewarmingThreadSeedPromisesRef.current.get(expectedThreadId) === prewarmPromise
        ) {
          prewarmingThreadSeedPromisesRef.current.delete(expectedThreadId);
        }
      });

      return prewarmPromise;
    },
    [debugTraceId, loadThreadOpenSeedSnapshotFromCache, room]
  );

  useEffect(() => {
    if (activeThreadId || priorityTargets.length === 0) return undefined;

    priorityTargets.forEach(({ threadId: expectedThreadId }) => {
      if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (prewarmingThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (queuedThreadSeedIdsRef.current.has(expectedThreadId)) return;
      queuedThreadSeedIdsRef.current.add(expectedThreadId);
      threadSeedPrewarmQueueRef.current.push(expectedThreadId);
    });

    if (threadSeedPrewarmRunningRef.current) return undefined;
    threadSeedPrewarmRunningRef.current = true;
    const generation = threadSeedPrewarmGenerationRef.current;

    const prewarmThreadSeeds = async () => {
      try {
        while (threadSeedPrewarmQueueRef.current.length > 0) {
          if (generation !== threadSeedPrewarmGenerationRef.current) return;
          if (activeThreadIdRef.current) return;

          const expectedThreadId = threadSeedPrewarmQueueRef.current.shift();
          if (!expectedThreadId) continue;
          queuedThreadSeedIdsRef.current.delete(expectedThreadId);
          if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) continue;
          if (prewarmingThreadSeedIdsRef.current.has(expectedThreadId)) continue;

          await ensureThreadSeedPrewarm(expectedThreadId, {
            generation,
            logPrefix: 'room-thread-seed-prewarm',
            traceId: debugTraceId,
          });
        }
      } finally {
        if (generation === threadSeedPrewarmGenerationRef.current) {
          threadSeedPrewarmRunningRef.current = false;
        }
        if (
          generation === threadSeedPrewarmGenerationRef.current &&
          !activeThreadIdRef.current &&
          threadSeedPrewarmQueueRef.current.length > 0
        ) {
          queueMicrotask(() => {
            if (threadSeedPrewarmRunningRef.current) return;
            threadSeedPrewarmRunningRef.current = true;
            void prewarmThreadSeeds();
          });
        }
      }
    };

    void prewarmThreadSeeds();

    return undefined;
  }, [activeThreadId, debugTraceId, ensureThreadSeedPrewarm, priorityTargets]);

  return {
    ensureThreadSeedPrewarm,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    queuedThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
  };
};
