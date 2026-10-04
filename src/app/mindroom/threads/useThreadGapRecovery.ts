import { useEffect } from 'react';
import { RelationType, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { MindroomSyncEngine } from '../engine';
import { hydrateThreadFromCache } from './threadOpenCacheController';

export type ThreadGapRecoveryOptions = {
  engine: MindroomSyncEngine;
  room: Room;
  threadId?: string;
  append: (threadId: string, events: MatrixEvent[]) => void;
  /** The thread events currently rendered, oldest first. */
  getLoadedEvents?: () => readonly MatrixEvent[];
};

const compareThreadOrder = (left: MatrixEvent, right: MatrixEvent): number =>
  left.getTs() - right.getTs() || (left.getId() ?? '').localeCompare(right.getId() ?? '');

/**
 * Recovered events restore what the reader's loaded span missed: replies inside or after it, and
 * edits, reactions and redactions. Older replies stay behind Load Older, whose pagination keeps
 * the reader's scroll anchor. Adding them here would insert rows above a reader who scrolled up.
 */
export const keepRecoveredEventsInLoadedSpan = (
  threadId: string,
  recoveredEvents: MatrixEvent[],
  loadedEvents: readonly MatrixEvent[]
): MatrixEvent[] => {
  const earliestLoadedReply = loadedEvents.find((mEvent) => mEvent.getId() !== threadId);
  if (!earliestLoadedReply) return recoveredEvents;
  const loadedEventIds = new Set(loadedEvents.map((mEvent) => mEvent.getId()));
  return recoveredEvents.filter((mEvent) => {
    const relationType = mEvent.getRelation()?.rel_type;
    return (
      loadedEventIds.has(mEvent.getId()) ||
      relationType === RelationType.Replace ||
      relationType === RelationType.Annotation ||
      mEvent.isRedaction() ||
      compareThreadOrder(mEvent, earliestLoadedReply) >= 0
    );
  });
};

export const useThreadGapRecovery = ({
  engine,
  room,
  threadId,
  append,
  getLoadedEvents,
}: ThreadGapRecoveryOptions): void => {
  useEffect(() => {
    if (!threadId) return undefined;
    let active = true;
    let reading = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        // Coalesce pages committed during a read, then read again so a late
        // commit cannot be hidden by the earlier IndexedDB snapshot.
        while (active && dirty) {
          dirty = false;
          // eslint-disable-next-line no-await-in-loop
          const page = await hydrateThreadFromCache(
            {
              mx: engine.mx,
              sessionId: engine.sessionId,
              room,
              isCurrentThread: () => active,
            },
            threadId
          ).catch(() => undefined);
          const recoveredEvents =
            active && page?.hydratedEvents?.length
              ? keepRecoveredEventsInLoadedSpan(
                  threadId,
                  page.hydratedEvents,
                  getLoadedEvents?.() ?? []
                )
              : [];
          if (recoveredEvents.length) append(threadId, recoveredEvents);
        }
      } finally {
        reading = false;
      }
    };
    const unsubscribe = engine.subscribeRoomRecovery(room.roomId, () => {
      void refresh().catch(() => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [engine, room, threadId, append, getLoadedEvents]);
};
