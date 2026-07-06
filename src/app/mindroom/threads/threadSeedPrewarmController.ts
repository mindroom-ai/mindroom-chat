import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import {
  createPreferLiveEventMapper,
  loadLatestCachedThreadEvents,
  loadThreadCachedSnapshot,
} from './eventRepository';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { MAX_THREAD_FETCH_ITERATIONS } from './threadBootstrap';
import { fetchAndPersistThreadContent } from './threadContentPrefetch';
import { useMindroomSyncEngine } from '../engine';

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
  mx,
  sessionId,
  prefetchDepthRef,
  activeThreadId,
  priorityTargets,
  loadThreadOpenSeedSnapshotFromCache: loadThreadOpenSeedSnapshotFromCacheProp,
  debugTraceId,
}: {
  room: Room;
  mx: MatrixClient;
  sessionId: string;
  prefetchDepthRef: MutableRefObject<number>;
  activeThreadId: string | undefined;
  priorityTargets: ThreadSeedPrewarmTarget[];
  loadThreadOpenSeedSnapshotFromCache?: (expectedThreadId: string) => Promise<MatrixEvent[]>;
  debugTraceId: string;
}): ThreadSeedPrewarmController => {
  const syncEngine = useMindroomSyncEngine();
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
  const prefetchedThreadContentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    threadSeedPrewarmGenerationRef.current += 1;
    prewarmedThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedPromisesRef.current.clear();
    queuedThreadSeedIdsRef.current.clear();
    threadSeedPrewarmQueueRef.current = [];
    threadSeedPrewarmRunningRef.current = false;
    prefetchedThreadContentIdsRef.current.clear();
  }, [room.roomId]);

  const loadThreadOpenSeedSnapshotFromCache = useCallback(
    async (expectedThreadId: string): Promise<MatrixEvent[]> => {
      if (loadThreadOpenSeedSnapshotFromCacheProp) {
        return loadThreadOpenSeedSnapshotFromCacheProp(expectedThreadId);
      }

      const mapper = mx.getEventMapper();
      const cachedSnapshot = await loadThreadCachedSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        limit: prefetchDepthRef.current,
        maxPages: MAX_THREAD_FETCH_ITERATIONS,
        mapEvent: createPreferLiveEventMapper(room, mapper),
      });
      return cachedSnapshot?.events ?? [];
    },
    [loadThreadOpenSeedSnapshotFromCacheProp, mx, room, prefetchDepthRef, sessionId]
  );

  // CINNY-207 P4.4: dedup migrated onto the engine's BackfillScheduler.
  // The per-controller `prewarmingThreadSeedPromisesRef` map used to be
  // the F9 dedup point — but it only deduped WITHIN a single
  // MindroomRoomTimeline mount. Routing the actual work through
  // `syncEngine.scheduler.enqueue({kind: 'thread-seed', ...})` gives us
  // client-scoped dedup: concurrent seeds for the same (room, thread)
  // from any producer (remount, sibling controller, priority target
  // drain below) share the same in-flight promise. The controller-
  // local refs are still populated so downstream consumers
  // (threadOpenSeedController's untargeted-seed wait) continue to work
  // unchanged — the refs mirror scheduler state, they no longer own
  // dedup.
  const ensureThreadSeedPrewarm = useCallback(
    (expectedThreadId: string, opts?: EnsureThreadSeedPrewarmOptions): Promise<void> => {
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

      const prewarmPromise = syncEngine.scheduler.enqueue<void>({
        roomId: room.roomId,
        threadId: expectedThreadId,
        kind: 'thread-seed',
        // Priority 3 = thread inventory prewarm band; deep-history
        // band-4 jobs yield to us so a room-open makes thread-open
        // fast even if a room-deep-history sweep is running.
        priority: 3,
        execute: async () => {
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
          }
        },
      });

      prewarmingThreadSeedPromisesRef.current.set(expectedThreadId, prewarmPromise);
      // CINNY-207 P7.2 audit finding #2: `void p.finally(cb)` returns a
      // NEW promise that re-rejects with the original reason and is
      // unhandled. The 'thread-seed' executor swallows its own errors,
      // so the promise only ever rejects via the scheduler's queued-abort
      // path (`abortAll` at engine teardown / logout). Route cleanup
      // through `.then(cb, cb)` so cleanup fires on both fulfil and
      // reject without producing a further unhandled rejection.
      const cleanupPrewarmRefs = () => {
        prewarmingThreadSeedIdsRef.current.delete(expectedThreadId);
        if (prewarmingThreadSeedPromisesRef.current.get(expectedThreadId) === prewarmPromise) {
          prewarmingThreadSeedPromisesRef.current.delete(expectedThreadId);
        }
      };
      void prewarmPromise.then(cleanupPrewarmRefs, cleanupPrewarmRefs);

      return prewarmPromise;
    },
    [debugTraceId, loadThreadOpenSeedSnapshotFromCache, room, syncEngine]
  );

  // 2026-07-06 eager-cache fix: the IDB seed pass above cannot help a
  // cold cache — after a cache clear there is nothing to read. Threads
  // must be downloaded BEFORE they are opened (product direction:
  // background prefetch owns the network cost; opening is instant from
  // cache). After each priority target's seed pass, check the cached
  // snapshot's proof flags and, when not relations-proven complete,
  // drain the thread's /relations through the shared
  // `fetchAndPersistThreadContent` pipeline. The network side is a
  // band-3 'thread-backfill' scheduler job, so a user OPENING the
  // thread mid-prefetch coalesces onto the same in-flight fetch (AC8
  // dedup) instead of downloading twice. Runs from this component-side
  // drain loop — NOT nested inside a scheduler executor, which could
  // deadlock the 2-slot concurrency cap.
  const prefetchThreadContentIfIncomplete = useCallback(
    async (expectedThreadId: string, generation: number): Promise<void> => {
      if (prefetchedThreadContentIdsRef.current.has(expectedThreadId)) return;
      const cachedPage = await loadLatestCachedThreadEvents(
        sessionId,
        room.roomId,
        expectedThreadId,
        1
      );
      if (generation !== threadSeedPrewarmGenerationRef.current) return;
      if (activeThreadIdRef.current) return;
      if (cachedPage.snapshotComplete === true && cachedPage.tailLoaded === true) {
        // Complete under the open-time coverage policy (count-proven or
        // relations-proven) — the open will paint from cache without a
        // drain, so there is nothing to prefetch. Requiring
        // relationSnapshotComplete here (2026-07-06 review finding #4)
        // made every sweep-warmed thread pay a redundant full proving
        // drain, and threads that can never prove relations (>5000
        // replies hit the fetch cap; count-mismatch threads never flag
        // complete) re-drained on EVERY room mount.
        prefetchedThreadContentIdsRef.current.add(expectedThreadId);
        return;
      }
      logTimelineDebug(debugTraceId, 'room-thread-content-prefetch-start', {
        threadId: expectedThreadId,
      });
      const result = await fetchAndPersistThreadContent({
        mx,
        scheduler: syncEngine.scheduler,
        room,
        threadId: expectedThreadId,
        // Band 3 — thread inventory prewarm; yields to opens/gap-fills.
        priority: 3,
        shouldContinue: () =>
          generation === threadSeedPrewarmGenerationRef.current &&
          // Keep fetching if the user opened THIS thread (the open's
          // backfill dedups onto this very job); stop when they moved
          // their attention to a different thread.
          (!activeThreadIdRef.current || activeThreadIdRef.current === expectedThreadId),
        persistThreadEventCache: (
          threadId,
          events,
          rootEvent,
          beforeTokenForEarliest,
          tailLoaded,
          snapshotComplete,
          expectedReplyCount,
          relationSnapshotComplete
        ) =>
          syncEngine.persist.persistThreadEventCache(
            room,
            threadId,
            events,
            rootEvent,
            beforeTokenForEarliest,
            tailLoaded,
            snapshotComplete,
            expectedReplyCount,
            relationSnapshotComplete
          ),
      });
      if (result) {
        prefetchedThreadContentIdsRef.current.add(expectedThreadId);
        logTimelineDebug(debugTraceId, 'room-thread-content-prefetch-complete', {
          fetchedCount: result.fetchedCount,
          relationSnapshotComplete: result.relationSnapshotComplete,
          snapshotComplete: result.snapshotComplete,
          threadId: expectedThreadId,
        });
      }
    },
    [debugTraceId, mx, room, sessionId, syncEngine]
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

          // CINNY-207 P7.2 audit finding #2: ensureThreadSeedPrewarm
          // returns the scheduler promise verbatim; that promise
          // rejects with the abort reason when the scheduler drains
          // a queued 'thread-seed' job at engine.stop(). Swallow the
          // rejection so the drain loop keeps going (the aborted job
          // is discarded, the next queued id gets a fresh enqueue) and
          // the outer `void prewarmThreadSeeds()` never sees an unhandled
          // rejection. Non-abort errors in the executor are already
          // logged via the try/catch inside execute() and never
          // surface here.
          await ensureThreadSeedPrewarm(expectedThreadId, {
            generation,
            logPrefix: 'room-thread-seed-prewarm',
            traceId: debugTraceId,
          }).catch(() => undefined);

          if (generation !== threadSeedPrewarmGenerationRef.current) return;
          if (activeThreadIdRef.current) return;
          // Network content phase (2026-07-06 eager cache) — see
          // prefetchThreadContentIfIncomplete. Errors are swallowed the
          // same way as the seed pass so one failed thread does not
          // stall the drain.
          await prefetchThreadContentIfIncomplete(expectedThreadId, generation).catch(
            () => undefined
          );
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
            void prewarmThreadSeeds().catch(() => undefined);
          });
        }
      }
    };

    void prewarmThreadSeeds().catch(() => undefined);

    return undefined;
  }, [
    activeThreadId,
    debugTraceId,
    ensureThreadSeedPrewarm,
    prefetchThreadContentIfIncomplete,
    priorityTargets,
  ]);

  return {
    ensureThreadSeedPrewarm,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    queuedThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
  };
};
