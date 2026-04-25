import {
  RelationType,
  type EventTimeline,
  type IEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  getRoomCursorAnchor,
  normalizeCachedRoomEvents,
} from '../../features/room/roomEventCache';
import { compareCachedPaginationAnchors } from '../../features/room/eventCacheTokenUtils';
import { serializeEventsForCache } from '../../features/room/eventCacheEditUtils';
import { isThreadOnlyRoomActivity } from '../../features/room/threadRenderUtils';

export {
  getRoomCursorAnchor,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadLatestCachedRoomEvents,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache,
  type CachedRoomEvent,
  type CachedRoomEventPage,
} from '../../features/room/roomEventCache';

export {
  getThreadCursorAnchor,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from '../../features/room/threadEventCache';

export const getThreadCacheTargetId = (room: Room, mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    return threadRootId;
  }

  const relationTargetId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (!relationTargetId) return undefined;

  const relatedEvent = room.findEventById(relationTargetId);
  if (!relatedEvent) return undefined;
  const relatedEventId = relatedEvent.getId();
  if (!relatedEventId) return undefined;

  if (relatedEvent.threadRootId && relatedEvent.threadRootId !== relatedEventId) {
    return relatedEvent.threadRootId;
  }

  return relatedEvent.isThreadRoot || room.getThread(relatedEventId)?.rootEvent?.getId() === relatedEventId
    ? relatedEventId
    : undefined;
};

export const groupThreadCacheEvents = (
  room: Room,
  events: MatrixEvent[]
): Map<string, MatrixEvent[]> => {
  const grouped = new Map<string, MatrixEvent[]>();

  events.forEach((mEvent) => {
    const threadCacheTargetId = getThreadCacheTargetId(room, mEvent);
    if (!threadCacheTargetId) return;
    const cachedThreadEvents = grouped.get(threadCacheTargetId);
    if (cachedThreadEvents) {
      cachedThreadEvents.push(mEvent);
      return;
    }
    grouped.set(threadCacheTargetId, [mEvent]);
  });

  return grouped;
};

export const getMainTimelineCacheEvents = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent[] =>
  linkedTimelines.flatMap((timeline) =>
    timeline.getEvents().filter((mEvent) => !isThreadOnlyRoomActivity(room, mEvent))
  );

export const findEarliestLoadedRoomEventByCacheOrder = (
  cacheEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  const earliestEventId = normalizeCachedRoomEvents(
    cacheEvents.map((mEvent) => mEvent.event as Partial<IEvent>)
  )[0]?.event_id;

  return earliestEventId
    ? cacheEvents.find((mEvent) => mEvent.getId() === earliestEventId)
    : undefined;
};

export const getEarliestLoadedRoomEvent = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent | undefined =>
  findEarliestLoadedRoomEventByCacheOrder(getMainTimelineCacheEvents(room, linkedTimelines));

export const resolveHydratedRoomBeforeToken = (
  cachedBeforeToken: string | null | undefined,
  paginationToken: string | null
): string | null => (cachedBeforeToken !== undefined ? cachedBeforeToken : paginationToken);

export const resolvePersistedRoomBeforeToken = (
  paginationToken: string | null | undefined,
  cachedBeforeToken: string | null | undefined
): string | null | undefined => {
  if (paginationToken === null || cachedBeforeToken === null) return null;
  if (typeof paginationToken === 'string') return paginationToken;
  return cachedBeforeToken;
};

export const getLatestLoadedRoomEvent = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent | undefined => {
  const loadedEvents = getMainTimelineCacheEvents(room, linkedTimelines);
  return loadedEvents[loadedEvents.length - 1];
};

export const shouldHydrateLatestRoomCache = (
  loadedLatestEvent: Partial<IEvent> | undefined,
  cachedLatestEvent: Partial<IEvent> | undefined
): boolean =>
  compareCachedPaginationAnchors(
    getRoomCursorAnchor(cachedLatestEvent),
    getRoomCursorAnchor(loadedLatestEvent)
  ) > 0;

export const filterLatestRoomCacheHydrationEvents = (
  rawCachedEvents: Partial<IEvent>[],
  loadedEvents: MatrixEvent[]
): Partial<IEvent>[] => {
  const loadedEventIds = new Set(
    loadedEvents
      .map((mEvent) => mEvent.getId())
      .filter((eventId): eventId is string => !!eventId)
  );

  return rawCachedEvents.filter(
    (rawEvent) =>
      typeof rawEvent.event_id === 'string' && !loadedEventIds.has(rawEvent.event_id)
  );
};

export const collectStateTargetEvents = (room: Room, events: MatrixEvent[]): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventsById.set(eventId, mEvent);
    }

    const targetEventId =
      mEvent.getRelation()?.rel_type === RelationType.Replace || mEvent.isRedaction()
        ? mEvent.getAssociatedId()
        : undefined;
    if (!targetEventId || eventsById.has(targetEventId)) return;

    const targetEvent = room.findEventById(targetEventId);
    if (targetEvent?.getId()) {
      eventsById.set(targetEventId, targetEvent);
    }
  });

  return Array.from(eventsById.values());
};

export const serializeThreadCacheEvents = (
  room: Room,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent
): Partial<IEvent>[] =>
  serializeEventsForCache(
    room,
    collectStateTargetEvents(room, rootEvent ? [rootEvent, ...events] : events)
  );

export const serializeRoomCacheEvents = (
  room: Room,
  events: MatrixEvent[]
): Partial<IEvent>[] =>
  serializeEventsForCache(
    room,
    collectStateTargetEvents(room, events).filter(
      (mEvent) => !isThreadOnlyRoomActivity(room, mEvent)
    )
  );
