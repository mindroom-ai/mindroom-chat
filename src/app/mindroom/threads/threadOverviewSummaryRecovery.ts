import { useEffect, useRef } from 'react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  getThreadSummaryInfosFromEventSources,
  hasMindroomThreadSummary,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  getThreadCursorAnchor,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
} from './cacheStore';
import { hydrateCachedEvents } from './eventCacheEditUtils';
import {
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  type ThreadSummaryWriter,
} from './threadSummaryState';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { subscribeThreadCacheChanges } from './cacheStore/cacheStoreThreadChanges';

const SUMMARY_RECOVERY_PAGE_SIZE = 128;

/** Read old summary notices separately, without widening the overview's event tail. */
export const recoverCachedThreadSummaryCandidates = async ({
  sessionId,
  room,
  threadRootId,
  shouldContinue,
}: {
  sessionId: string;
  room: Room;
  threadRootId: string;
  shouldContinue: () => boolean;
}): Promise<Array<MindroomThreadSummaryInfo | undefined> | undefined> => {
  const candidates: MatrixEvent[] = [];
  const referencedTargets = new Set<string>();
  let before: ReturnType<typeof getThreadCursorAnchor>;
  while (shouldContinue()) {
    // Every read has a fixed event bound; no full-history Matrix timeline is retained.
    // eslint-disable-next-line no-await-in-loop
    const page = await (before
      ? loadCachedThreadEventsBefore(
          sessionId,
          room.roomId,
          threadRootId,
          before,
          SUMMARY_RECOVERY_PAGE_SIZE
        )
      : loadLatestCachedThreadEvents(
          sessionId,
          room.roomId,
          threadRootId,
          SUMMARY_RECOVERY_PAGE_SIZE
        ));
    if (!shouldContinue()) return undefined;
    page.events.forEach((event) => {
      const relation = event.content?.['m.relates_to'];
      if (
        relation?.rel_type === 'm.replace' &&
        typeof relation.event_id === 'string' &&
        hasMindroomThreadSummary(event.content ?? {})
      ) {
        referencedTargets.add(relation.event_id);
      }
    });
    const events = page.events
      .filter(
        (event) =>
          isConfirmedMatrixEventId(event.event_id) &&
          (referencedTargets.has(event.event_id) ||
            event.content?.['m.relates_to']?.rel_type === 'm.replace' ||
            hasMindroomThreadSummary(event.content ?? {}) ||
            hasMindroomThreadSummary(
              event.unsigned?.['m.relations']?.['m.replace']?.content ?? {}
            ) ||
            event.type === 'm.room.redaction')
      )
      .map((event) => new MatrixEvent(event));
    // A replacement or redaction can arrive pages before its target. Keep
    // that evidence until selection, but discard ordinary replies immediately.
    candidates.push(...events);
    if (!page.hasMoreBefore || page.events.length === 0) break;
    const next = getThreadCursorAnchor(page.events[0]);
    if (!next || (before?.eventId === next.eventId && before.ts === next.ts)) break;
    before = next;
    // Let interaction and rendering run between history pages.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  if (!shouldContinue()) return undefined;
  // Server timestamps can put a target ahead of its accepted replacement.
  // Recover only those referenced originals that were already passed over.
  const retainedIds = new Set(candidates.map((event) => event.getId()));
  for (const eventId of referencedTargets) {
    if (retainedIds.has(eventId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const target = await loadCachedThreadEvent(sessionId, room.roomId, threadRootId, eventId);
    if (!shouldContinue()) return undefined;
    if (target) candidates.push(new MatrixEvent(target));
  }
  hydrateCachedEvents({ room, events: candidates });
  return getThreadSummaryInfosFromEventSources(
    candidates.filter(
      (event) =>
        !event.isRedacted() &&
        !room.findEventById(event.getId()!)?.isRedacted() &&
        event.getRelation()?.rel_type !== 'm.replace'
    )
  );
};

type Options = {
  enabled: boolean;
  sessionId: string;
  room: Room;
  threadRootIds: string[];
  records: ReadonlyMap<string, ThreadRecord>;
  coverage: ReadonlyMap<string, ThreadCacheCoverage>;
  onStoreThreadSummary: ThreadSummaryWriter;
};

export const useThreadOverviewSummaryRecovery = (options: Options): void => {
  const latest = useRef(options);
  const wake = useRef<() => void>();
  useEffect(() => {
    latest.current = options;
  });

  const { enabled, room, sessionId } = options;
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let running = false;
    const attempted = new Map<
      string,
      { coverage: ThreadCacheCoverage; activity?: number; revision: number }
    >();
    const revisions = new Map<string, number>();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
    const isCurrent = () => !cancelled && isCacheStoreWriteLeaseCurrent(lease);
    const loaded = ensureThreadSummaryStateLoaded(sessionId, room.roomId);
    const run = async () => {
      if (running || !isCurrent()) return;
      running = true;
      try {
        await loaded;
        while (isCurrent()) {
          const current = latest.current;
          const summaries = getThreadSummaryStateSnapshot(sessionId, room.roomId);
          const rootId = current.threadRootIds.find((id) => {
            const coverage = current.coverage.get(id);
            const record = current.records.get(id);
            const previous = attempted.get(id);
            return (
              coverage &&
              (coverage.hasMoreBackward === true || (revisions.get(id) ?? 0) > 0) &&
              !summaries.has(id) &&
              !record?.presentation.summaryText &&
              (!previous ||
                previous.coverage !== coverage ||
                previous.activity !== record?.status.lastActivityTs ||
                previous.revision !== (revisions.get(id) ?? 0))
            );
          });
          if (!rootId) return;
          const observed = {
            coverage: current.coverage.get(rootId)!,
            activity: current.records.get(rootId)?.status.lastActivityTs,
            revision: revisions.get(rootId) ?? 0,
          };
          // eslint-disable-next-line no-await-in-loop
          const candidates = await recoverCachedThreadSummaryCandidates({
            sessionId,
            room,
            threadRootId: rootId,
            shouldContinue: isCurrent,
          });
          if (!isCurrent() || !candidates) return;
          if (observed.revision !== (revisions.get(rootId) ?? 0)) {
            scheduleRetry();
            return;
          }
          attempted.set(rootId, observed);
          if (candidates.length > 0) latest.current.onStoreThreadSummary(rootId, ...candidates);
        }
      } catch {
        // A later render can retry a failed cache read; never spin on a storage failure.
      } finally {
        running = false;
      }
    };
    wake.current = () => {
      void run();
    };
    const scheduleRetry = () => {
      if (retryTimer !== undefined) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void run();
      }, 250);
    };
    const unsubscribe = subscribeThreadCacheChanges(sessionId, room.roomId, (id) => {
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      scheduleRetry();
    });
    wake.current();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      unsubscribe();
      wake.current = undefined;
    };
  }, [enabled, room, sessionId]);

  useEffect(() => {
    wake.current?.();
  });
};
