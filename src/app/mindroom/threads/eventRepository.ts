import {
  RelationType,
  type EventTimeline,
  type IEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  getRoomCursorAnchor,
  loadLatestCachedRoomEvents as loadLatestCachedRoomEventsFromCache,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache as saveRoomEventsToCacheToStorage,
  type CachedRoomEventPage,
} from '../../features/room/roomEventCache';
import {
  getThreadCursorAnchor as getCachedThreadCursorAnchor,
  loadCachedThreadEventsBefore as loadCachedThreadEventsBeforeFromCache,
  loadLatestCachedThreadEvents as loadLatestCachedThreadEventsFromCache,
  saveThreadEventsToCache as saveThreadEventsToCacheToStorage,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from '../../features/room/threadEventCache';
import { compareCachedPaginationAnchors } from '../../features/room/eventCacheTokenUtils';
import { serializeEventsForCache } from '../../features/room/eventCacheEditUtils';
import { isThreadOnlyRoomActivity } from '../../features/room/threadRenderUtils';
import { buildThreadReplyCountMap } from '../../features/room/threadUtils';
import { getKnownThreadReplyCount } from './threadRecord';

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

type ThreadCursorAnchor = ReturnType<typeof getCachedThreadCursorAnchor>;

type SaveThreadEventsToCache = typeof saveThreadEventsToCacheToStorage;
type SaveRoomEventsToCache = typeof saveRoomEventsToCacheToStorage;

type LoadCachedThreadSnapshotOptions = {
  sessionId: string;
  roomId: string;
  threadId: string;
  limit: number;
  maxPages: number;
  shouldContinue?: () => boolean;
  onPage?: (page: CachedThreadEventPage, pageIndex: number, snapshot: CachedThreadSnapshot) => void;
  loadLatest?: typeof loadLatestCachedThreadEventsFromCache;
  loadBefore?: typeof loadCachedThreadEventsBeforeFromCache;
};

export type CachedThreadSnapshot = CachedThreadEventPage & {
  events: CachedThreadEvent[];
};

export const loadCachedThreadSnapshot = async ({
  sessionId,
  roomId,
  threadId,
  limit,
  maxPages,
  shouldContinue,
  onPage,
  loadLatest = loadLatestCachedThreadEventsFromCache,
  loadBefore = loadCachedThreadEventsBeforeFromCache,
}: LoadCachedThreadSnapshotOptions): Promise<CachedThreadSnapshot | undefined> => {
  let cachedPage = await loadLatest(sessionId, roomId, threadId, limit);
  const cachedThreadEvents = [...cachedPage.events];
  let cachedRootEvent = cachedPage.rootEvent;
  let cachedBeforeToken = cachedPage.beforeToken;
  let cachedHasMoreBefore = cachedPage.hasMoreBefore;
  let cachedExpectedReplyCount = cachedPage.expectedReplyCount;
  const cachedSnapshotComplete = cachedPage.snapshotComplete === true;
  const cachedRelationSnapshotComplete = cachedPage.relationSnapshotComplete === true;
  const tailLoaded = cachedPage.tailLoaded === true;

  onPage?.(cachedPage, 1, {
    ...cachedPage,
    beforeToken: cachedBeforeToken,
    events: cachedThreadEvents,
    hasMoreBefore: cachedHasMoreBefore,
    rootEvent: cachedRootEvent,
    expectedReplyCount: cachedExpectedReplyCount,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete: cachedSnapshotComplete,
    tailLoaded,
  });

  for (let pageIndex = 1; cachedPage.hasMoreBefore && pageIndex < maxPages; pageIndex += 1) {
    if (shouldContinue && !shouldContinue()) return undefined;

    const earliestCachedReply = cachedPage.events[0];
    const beforeAnchor: ThreadCursorAnchor = getCachedThreadCursorAnchor(earliestCachedReply);
    if (!beforeAnchor) break;

    cachedPage = await loadBefore(sessionId, roomId, threadId, beforeAnchor, limit);
    cachedThreadEvents.unshift(...cachedPage.events);
    cachedRootEvent ??= cachedPage.rootEvent;
    cachedBeforeToken = cachedPage.beforeToken;
    cachedHasMoreBefore = cachedPage.hasMoreBefore;
    cachedExpectedReplyCount = cachedPage.expectedReplyCount ?? cachedExpectedReplyCount;
    onPage?.(cachedPage, pageIndex + 1, {
      ...cachedPage,
      beforeToken: cachedBeforeToken,
      events: cachedThreadEvents,
      hasMoreBefore: cachedHasMoreBefore,
      rootEvent: cachedRootEvent,
      expectedReplyCount: cachedExpectedReplyCount,
      relationSnapshotComplete: cachedRelationSnapshotComplete,
      snapshotComplete: cachedSnapshotComplete,
      tailLoaded,
    });

    if (cachedPage.events.length === 0) {
      break;
    }
  }

  if (shouldContinue && !shouldContinue()) return undefined;

  return {
    ...cachedPage,
    beforeToken: cachedBeforeToken,
    events: cachedThreadEvents,
    hasMoreBefore: cachedHasMoreBefore,
    rootEvent: cachedRootEvent,
    expectedReplyCount: cachedExpectedReplyCount,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete: cachedSnapshotComplete,
    tailLoaded,
  };
};

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

type LoadLatestRoomCacheHydrationSnapshotOptions = {
  sessionId: string;
  roomId: string;
  limit: number;
  loadedEvents: MatrixEvent[];
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadLatest?: typeof loadLatestCachedRoomEventsFromCache;
};

export type LatestRoomCacheHydrationSnapshot = {
  cachedPage: CachedRoomEventPage;
  events: MatrixEvent[];
  loadedRoomCount: number;
  status: 'already-loaded' | 'empty-after-filter' | 'hydrate';
};

export const loadLatestRoomCacheHydrationSnapshot = async ({
  sessionId,
  roomId,
  limit,
  loadedEvents,
  mapEvent,
  loadLatest = loadLatestCachedRoomEventsFromCache,
}: LoadLatestRoomCacheHydrationSnapshotOptions): Promise<LatestRoomCacheHydrationSnapshot> => {
  const cachedPage = await loadLatest(sessionId, roomId, limit);
  const loadedLatestEvent = loadedEvents[loadedEvents.length - 1]?.event as
    | Partial<IEvent>
    | undefined;

  if (
    !shouldHydrateLatestRoomCache(
      loadedLatestEvent,
      cachedPage.events[cachedPage.events.length - 1]
    )
  ) {
    return {
      cachedPage,
      events: [],
      loadedRoomCount: loadedEvents.length,
      status: 'already-loaded',
    };
  }

  const events = normalizeCachedRoomEvents(
    filterLatestRoomCacheHydrationEvents(cachedPage.events, loadedEvents)
  ).map((rawEvent) => mapEvent(rawEvent));

  return {
    cachedPage,
    events,
    loadedRoomCount: loadedEvents.length,
    status: events.length > 0 ? 'hydrate' : 'empty-after-filter',
  };
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

export type ThreadEventCacheSnapshotWrite = {
  rawEvents: Partial<IEvent>[];
  rawRootEvent?: Partial<IEvent>;
  loadedReplyCount: number;
  expectedReplyCount?: number;
  beforeTokenForEarliest?: string | null;
  tailLoaded?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
};

export const persistThreadEventCacheSnapshot = ({
  sessionId,
  room,
  threadId,
  events,
  rootEvent,
  beforeTokenForEarliest,
  tailLoaded,
  snapshotComplete,
  expectedReplyCount,
  relationSnapshotComplete,
  save = saveThreadEventsToCacheToStorage,
}: {
  sessionId: string;
  room: Room;
  threadId: string;
  events: MatrixEvent[];
  rootEvent?: MatrixEvent | null;
  beforeTokenForEarliest?: string | null;
  tailLoaded?: boolean;
  snapshotComplete?: boolean;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  save?: SaveThreadEventsToCache;
}): ThreadEventCacheSnapshotWrite => {
  const resolvedRootEvent = rootEvent ?? undefined;
  const loadedReplyCount = buildThreadReplyCountMap(events).get(threadId) ?? 0;
  const persistedExpectedReplyCount =
    expectedReplyCount ??
    (resolvedRootEvent ? getKnownThreadReplyCount(resolvedRootEvent) : undefined) ??
    ((snapshotComplete === true || (beforeTokenForEarliest === null && tailLoaded === true))
      ? loadedReplyCount
      : undefined);
  const rawEvents = serializeThreadCacheEvents(room, events, resolvedRootEvent);
  const rawRootEvent = resolvedRootEvent
    ? rawEvents.find((rawEvent) => rawEvent.event_id === resolvedRootEvent.getId())
    : undefined;

  save(
    sessionId,
    room.roomId,
    threadId,
    rawEvents,
    rawRootEvent,
    beforeTokenForEarliest,
    tailLoaded,
    snapshotComplete,
    persistedExpectedReplyCount,
    relationSnapshotComplete
  ).catch(() => undefined);

  return {
    rawEvents,
    rawRootEvent,
    loadedReplyCount,
    expectedReplyCount: persistedExpectedReplyCount,
    beforeTokenForEarliest,
    tailLoaded,
    snapshotComplete,
    relationSnapshotComplete,
  };
};

export type RoomEventCacheSnapshotWrite = {
  rawEvents: Partial<IEvent>[];
  sourceEventCount: number;
  beforeTokenForEarliest?: string | null;
};

export const persistRoomEventCacheSnapshot = ({
  sessionId,
  room,
  events,
  beforeTokenForEarliest,
  save = saveRoomEventsToCacheToStorage,
}: {
  sessionId: string;
  room: Room;
  events: MatrixEvent[];
  beforeTokenForEarliest?: string | null;
  save?: SaveRoomEventsToCache;
}): RoomEventCacheSnapshotWrite => {
  const rawEvents = serializeRoomCacheEvents(room, events);

  save(sessionId, room.roomId, rawEvents, beforeTokenForEarliest).catch(() => undefined);

  return {
    rawEvents,
    sourceEventCount: events.length,
    beforeTokenForEarliest,
  };
};
