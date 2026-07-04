import {
  RelationType,
  type EventTimeline,
  type IEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  getRoomCursorAnchor,
  loadCachedRoomEventsBefore as loadCachedRoomEventsBeforeFromCache,
  loadCachedRoomPaginationToken as loadCachedRoomPaginationTokenFromCache,
  loadLatestCachedRoomEvents as loadLatestCachedRoomEventsFromCache,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache as saveRoomEventsToCacheToStorage,
  type CachedRoomEventPage,
} from './roomEventCache';
import {
  deleteThreadEventsFromCache as deleteThreadEventsFromCacheToStorage,
  getThreadCursorAnchor as getCachedThreadCursorAnchor,
  loadCachedThreadEventsBefore as loadCachedThreadEventsBeforeFromCache,
  loadLatestCachedThreadEvents as loadLatestCachedThreadEventsFromCache,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache as saveThreadEventsToCacheToStorage,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from './threadEventCache';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import { serializeEventsForCache } from './eventCacheEditUtils';
import { isThreadOnlyRoomActivity } from './threadRenderUtils';
import { buildThreadReplyCountMap } from './threadUtils';
import { getKnownThreadReplyCount } from './threadRecord';
import {
  getRoomDerivedThreadSnapshotState,
  mergeThreadBackfillEvents,
} from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { countCacheProbe } from './cacheProbe';
import { isCacheWritable, reportCacheWriteError } from './cacheHealth';

export {
  deleteRoomEventsFromCache,
  getRoomCursorAnchor,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadLatestCachedRoomEvents,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache,
  type CachedRoomEvent,
  type CachedRoomEventPage,
} from './roomEventCache';

export {
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  getThreadCursorAnchor,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from './threadEventCache';

/**
 * CINNY-207 P1.2 (finding F6-B): prefer the SDK's live event instance over a
 * cache-mapped clone. The SDK applies redactions and relation removal by
 * object identity, so clones injected into relation aggregations never learn
 * about later redactions. When the SDK already holds the event, hydrate with
 * that instance.
 *
 * The mapper also heals the reverse divergence: the SDK's sync store is saved
 * periodically, so after a reload the restored live instance can predate a
 * redaction that a cached/fetched raw copy already knows about
 * (`unsigned.redacted_because`). Applying it via `makeRedacted` cascades into
 * the SDK's relation cleanup (Relations listens for BeforeRedaction), which
 * is what removes a stale reaction chip.
 */
export const createPreferLiveEventMapper =
  (
    room: Room,
    mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent
  ): ((rawEvent: Partial<IEvent>) => MatrixEvent) =>
  (rawEvent) => {
    const eventId = typeof rawEvent.event_id === 'string' ? rawEvent.event_id : undefined;
    const liveEvent = eventId ? room.findEventById(eventId) : undefined;
    if (!liveEvent) return mapEvent(rawEvent);

    const rawRedactedBecause = rawEvent.unsigned?.redacted_because;
    if (rawRedactedBecause && !liveEvent.isRedacted()) {
      liveEvent.makeRedacted(mapEvent(rawRedactedBecause as Partial<IEvent>), room);
    }
    return liveEvent;
  };

type ThreadCursorAnchor = ReturnType<typeof getCachedThreadCursorAnchor>;

type SaveThreadEventsToCache = typeof saveThreadEventsToCacheToStorage;
type SaveRoomEventsToCache = typeof saveRoomEventsToCacheToStorage;
type LoadCachedRoomEventsBefore = typeof loadCachedRoomEventsBeforeFromCache;
type LoadCachedRoomPaginationToken = typeof loadCachedRoomPaginationTokenFromCache;
type LoadCachedThreadEventsBefore = typeof loadCachedThreadEventsBeforeFromCache;

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
  /**
   * CINNY-207 P1.4: injected so tests can observe/override the lazy cleanup
   * of legacy standalone m.replace records. Defaults to the storage-backed
   * delete API.
   */
  deleteEvents?: typeof deleteThreadEventsFromCacheToStorage;
};

export type CachedThreadSnapshot = CachedThreadEventPage & {
  events: CachedThreadEvent[];
};

/**
 * CINNY-207 P1.4 (finding F5, decision D5): identify legacy standalone
 * `m.replace` records inside a hydrated batch that are safe to delete: their
 * target record is in the same batch AND already carries a bundled edit
 * (`unsigned['m.relations']['m.replace']`) at least as new as the standalone
 * record under the D12 ordering (ts, then event id). Deleting a standalone
 * whose target does NOT yet carry an equal-or-newer bundled edit would lose
 * the edit from cache until some later re-persist — a stale paint on the
 * next open — so those are left in place (the Phase 2 D8 wipe purges them).
 * Cross-sender replaces are never considered.
 */
export const collectLegacyStandaloneReplaceIds = (
  events: Array<Partial<IEvent> | CachedThreadEvent>
): string[] => {
  const eventsById = new Map<string, Partial<IEvent>>();
  events.forEach((rawEvent) => {
    const eventId = rawEvent.event_id;
    if (typeof eventId === 'string' && eventId.length > 0) {
      eventsById.set(eventId, rawEvent);
    }
  });

  const isBundledReplaceAtLeastAsNew = (
    targetEvent: Partial<IEvent>,
    standaloneEvent: Partial<IEvent>
  ): boolean => {
    const relations = (targetEvent.unsigned as Record<string, unknown> | undefined)?.[
      'm.relations'
    ] as Record<string, unknown> | undefined;
    const bundled = relations?.[RelationType.Replace] as Partial<IEvent> | undefined;
    if (!bundled) return false;

    const bundledTs = bundled.origin_server_ts;
    const standaloneTs = standaloneEvent.origin_server_ts;
    if (typeof bundledTs !== 'number' || typeof standaloneTs !== 'number') return false;
    if (bundledTs !== standaloneTs) return bundledTs > standaloneTs;

    const bundledId = bundled.event_id;
    const standaloneId = standaloneEvent.event_id;
    if (typeof bundledId !== 'string' || typeof standaloneId !== 'string') return false;
    // Equal ids mean the bundled edit IS the standalone record's event.
    return bundledId >= standaloneId;
  };

  const legacyReplaceIds: string[] = [];
  events.forEach((rawEvent) => {
    const eventId = rawEvent.event_id;
    if (typeof eventId !== 'string' || eventId.length === 0) return;
    const relatesTo = rawEvent.content?.['m.relates_to'] as
      | { rel_type?: string; event_id?: string }
      | undefined;
    if (relatesTo?.rel_type !== RelationType.Replace) return;
    const targetEventId = relatesTo.event_id;
    if (!targetEventId) return;
    const targetEvent = eventsById.get(targetEventId);
    if (!targetEvent) return;
    if (targetEvent.sender !== rawEvent.sender) return;
    if (!isBundledReplaceAtLeastAsNew(targetEvent, rawEvent)) return;
    legacyReplaceIds.push(eventId);
  });

  return legacyReplaceIds;
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
  deleteEvents,
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

  // CINNY-207 P1.4: lazy cleanup — legacy standalone m.replace records
  // whose target is present in the same batch are dead weight (the target
  // now carries the bundled edit). Delete them best-effort; hydration still
  // sees the replace via the target's bundled edit, and getLatestEdit
  // (P1.3 / D12) picks the newest deterministically. `deleteEvents` is
  // resolved lazily so the storage import is not touched when a test-injected
  // deleter is passed (avoids evaluating the storage identifier under
  // partial vitest mocks that reject unlisted exports).
  const legacyReplaceIds = collectLegacyStandaloneReplaceIds(cachedThreadEvents);
  if (legacyReplaceIds.length > 0) {
    const resolvedDeleteEvents = deleteEvents ?? deleteThreadEventsFromCacheToStorage;
    resolvedDeleteEvents(sessionId, roomId, threadId, legacyReplaceIds).catch(() => undefined);
  }

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

export const mapCachedThreadPageEvents = ({
  events,
  rootEvent,
  mapEvent,
}: {
  events: Partial<IEvent>[];
  rootEvent?: Partial<IEvent>;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
}): MatrixEvent[] =>
  normalizeCachedThreadEvents(events, rootEvent).map((rawEvent) => mapEvent(rawEvent));

export type ThreadCachedSnapshot = {
  cachedPage: CachedThreadSnapshot;
  events: MatrixEvent[];
  rootEvent?: Partial<IEvent>;
  beforeToken?: string | null;
  hasMoreBefore: boolean;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
};

export const loadThreadCachedSnapshot = async ({
  mapEvent,
  ...options
}: LoadCachedThreadSnapshotOptions & {
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
}): Promise<ThreadCachedSnapshot | undefined> => {
  const cachedPage = await loadCachedThreadSnapshot(options);
  if (!cachedPage) return undefined;

  return {
    cachedPage,
    events: mapCachedThreadPageEvents({
      events: cachedPage.events,
      rootEvent: cachedPage.rootEvent,
      mapEvent,
    }),
    rootEvent: cachedPage.rootEvent,
    beforeToken: cachedPage.beforeToken,
    hasMoreBefore: cachedPage.hasMoreBefore,
    expectedReplyCount: cachedPage.expectedReplyCount,
    relationSnapshotComplete: cachedPage.relationSnapshotComplete,
    snapshotComplete: cachedPage.snapshotComplete,
    tailLoaded: cachedPage.tailLoaded,
  };
};

export type ThreadCachedPaginationSnapshot = {
  cachedPage: CachedThreadEventPage;
  events: MatrixEvent[];
  beforeToken?: string | null;
  hasMoreCachedBack: boolean;
  status: 'cache-hit' | 'cache-miss';
};

export const loadThreadCachedPaginationSnapshot = async ({
  sessionId,
  roomId,
  threadId,
  earliestLoadedReply,
  limit,
  mapEvent,
  loadBefore = loadCachedThreadEventsBeforeFromCache,
}: {
  sessionId: string;
  roomId: string;
  threadId: string;
  earliestLoadedReply?: MatrixEvent;
  limit: number;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadBefore?: LoadCachedThreadEventsBefore;
}): Promise<ThreadCachedPaginationSnapshot> => {
  const cachedPage = await loadBefore(
    sessionId,
    roomId,
    threadId,
    getCachedThreadCursorAnchor(earliestLoadedReply?.event as Partial<IEvent> | undefined),
    limit
  );
  const events = mapCachedThreadPageEvents({
    events: cachedPage.events,
    rootEvent: cachedPage.rootEvent,
    mapEvent,
  });

  return {
    cachedPage,
    events,
    beforeToken: cachedPage.beforeToken,
    hasMoreCachedBack: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    status: events.length > 0 ? 'cache-hit' : 'cache-miss',
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

  return relatedEvent.isThreadRoot ||
    room.getThread(relatedEventId)?.rootEvent?.getId() === relatedEventId
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

export type RoomCachePersistenceState = {
  cachedBeforeToken: string | null | undefined;
  beforeTokenForEarliest: string | null | undefined;
  roomStartKnown: boolean;
  shouldClearBackwardToken: boolean;
};

export const loadRoomCachePersistenceState = async ({
  sessionId,
  roomId,
  earliestLoadedEventId,
  currentBeforeToken,
  loadPaginationToken = loadCachedRoomPaginationTokenFromCache,
}: {
  sessionId: string;
  roomId: string;
  earliestLoadedEventId?: string;
  currentBeforeToken: string | null | undefined;
  loadPaginationToken?: LoadCachedRoomPaginationToken;
}): Promise<RoomCachePersistenceState> => {
  const cachedBeforeToken = await loadPaginationToken(sessionId, roomId, earliestLoadedEventId);

  return {
    cachedBeforeToken,
    beforeTokenForEarliest: resolvePersistedRoomBeforeToken(currentBeforeToken, cachedBeforeToken),
    roomStartKnown: currentBeforeToken === null || cachedBeforeToken === null,
    shouldClearBackwardToken: cachedBeforeToken === null && currentBeforeToken !== null,
  };
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
    loadedEvents.map((mEvent) => mEvent.getId()).filter((eventId): eventId is string => !!eventId)
  );

  return rawCachedEvents.filter(
    (rawEvent) => typeof rawEvent.event_id === 'string' && !loadedEventIds.has(rawEvent.event_id)
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

export type RoomCachedBackStateSnapshot = {
  cachedPage: CachedRoomEventPage;
  cachedBeforeToken: string | null | undefined;
  hasCachedBack: boolean;
};

export const loadRoomCachedBackStateSnapshot = async ({
  sessionId,
  roomId,
  earliestLoadedEvent,
  loadBefore = loadCachedRoomEventsBeforeFromCache,
  loadPaginationToken = loadCachedRoomPaginationTokenFromCache,
}: {
  sessionId: string;
  roomId: string;
  earliestLoadedEvent?: MatrixEvent;
  loadBefore?: LoadCachedRoomEventsBefore;
  loadPaginationToken?: LoadCachedRoomPaginationToken;
}): Promise<RoomCachedBackStateSnapshot> => {
  const [cachedPage, cachedBeforeToken] = await Promise.all([
    loadBefore(
      sessionId,
      roomId,
      getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
      1
    ),
    loadPaginationToken(sessionId, roomId, earliestLoadedEvent?.getId()),
  ]);

  return {
    cachedPage,
    cachedBeforeToken,
    hasCachedBack: cachedPage.events.length > 0,
  };
};

export type RoomCachedPaginationSnapshot = {
  cachedBeforeToken: string | null | undefined;
  cachedPage?: CachedRoomEventPage;
  events: MatrixEvent[];
  beforeToken?: string | null;
  hasMoreCachedBack: boolean;
  status: 'start-known' | 'cache-hit' | 'cache-miss';
};

export const loadRoomCachedPaginationSnapshot = async ({
  sessionId,
  roomId,
  earliestLoadedEvent,
  limit,
  mapEvent,
  loadBefore = loadCachedRoomEventsBeforeFromCache,
  loadPaginationToken = loadCachedRoomPaginationTokenFromCache,
}: {
  sessionId: string;
  roomId: string;
  earliestLoadedEvent?: MatrixEvent;
  limit: number;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadBefore?: LoadCachedRoomEventsBefore;
  loadPaginationToken?: LoadCachedRoomPaginationToken;
}): Promise<RoomCachedPaginationSnapshot> => {
  const cachedBeforeToken = await loadPaginationToken(
    sessionId,
    roomId,
    earliestLoadedEvent?.getId()
  );

  if (cachedBeforeToken === null) {
    return {
      cachedBeforeToken,
      events: [],
      hasMoreCachedBack: false,
      status: 'start-known',
    };
  }

  const cachedPage = await loadBefore(
    sessionId,
    roomId,
    getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
    limit
  );
  const events = normalizeCachedRoomEvents(cachedPage.events)
    .map((rawEvent) => mapEvent(rawEvent))
    .reverse();

  return {
    cachedBeforeToken,
    cachedPage,
    events,
    beforeToken: cachedPage.beforeToken,
    hasMoreCachedBack: cachedPage.hasMoreBefore,
    status: events.length > 0 ? 'cache-hit' : 'cache-miss',
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

export const serializeRoomCacheEvents = (room: Room, events: MatrixEvent[]): Partial<IEvent>[] =>
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
    (snapshotComplete === true || (beforeTokenForEarliest === null && tailLoaded === true)
      ? loadedReplyCount
      : undefined);
  const rawEvents = serializeThreadCacheEvents(room, events, resolvedRootEvent);
  const rawRootEvent = resolvedRootEvent
    ? rawEvents.find((rawEvent) => rawEvent.event_id === resolvedRootEvent.getId())
    : undefined;

  countCacheProbe('serializedEvents', rawEvents.length);
  // CINNY-207 P1.5 (F4): failures are surfaced, and after a quota error the
  // session is cache-read-only — skip the write instead of failing again.
  if (isCacheWritable()) {
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
    ).catch((error) => {
      reportCacheWriteError('threadEventCache.save', error);
      return undefined;
    });
  }

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

type ThreadCacheFromRoomEventsOptions = {
  beforeTokenForEarliest?: string | null;
  roomStartKnown?: boolean;
  roomTailLoaded?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
};

export type ThreadCacheFromRoomEventsWrite = {
  threadId: string;
  threadEvents: MatrixEvent[];
  rootEvent?: MatrixEvent;
  nextSeedEvents: MatrixEvent[];
  roomDerivedSnapshot?: ReturnType<typeof getRoomDerivedThreadSnapshotState>;
  cacheSnapshot: ThreadEventCacheSnapshotWrite;
};

export const persistThreadCacheFromRoomEventsSnapshot = ({
  sessionId,
  room,
  events,
  opts,
  getSeedSnapshot = getThreadOpenSeedSnapshot,
  saveSeedSnapshot = saveThreadOpenSeedSnapshot,
  saveThreadSnapshot = saveThreadEventsToCacheToStorage,
}: {
  sessionId: string;
  room: Room;
  events: MatrixEvent[];
  opts?: ThreadCacheFromRoomEventsOptions;
  getSeedSnapshot?: typeof getThreadOpenSeedSnapshot;
  saveSeedSnapshot?: typeof saveThreadOpenSeedSnapshot;
  saveThreadSnapshot?: SaveThreadEventsToCache;
}): ThreadCacheFromRoomEventsWrite[] => {
  const writes: ThreadCacheFromRoomEventsWrite[] = [];
  const groupedThreadEvents = groupThreadCacheEvents(room, events);

  groupedThreadEvents.forEach((threadEvents, threadId) => {
    const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
    const existingThreadSeedEvents = getSeedSnapshot(room, threadId);
    const roomDerivedThreadSeedEvents = rootEvent
      ? mergeThreadBackfillEvents([rootEvent], threadEvents)
      : threadEvents;
    const nextSeedEvents = mergeThreadBackfillEvents(
      existingThreadSeedEvents,
      roomDerivedThreadSeedEvents
    );
    let beforeTokenForEarliest = opts?.beforeTokenForEarliest;
    let expectedReplyCount: number | undefined;
    let snapshotComplete = opts?.snapshotComplete;
    let tailLoaded = opts?.tailLoaded;
    let roomDerivedSnapshot: ReturnType<typeof getRoomDerivedThreadSnapshotState> | undefined;

    if (opts?.roomStartKnown !== undefined || opts?.roomTailLoaded !== undefined) {
      roomDerivedSnapshot = getRoomDerivedThreadSnapshotState({
        room,
        threadId,
        rootEvent,
        threadEvents,
        roomStartKnown: opts?.roomStartKnown === true,
        roomTailLoaded: opts?.roomTailLoaded === true,
      });
      beforeTokenForEarliest = roomDerivedSnapshot.beforeTokenForEarliest;
      expectedReplyCount = roomDerivedSnapshot.expectedReplyCount;
      snapshotComplete = roomDerivedSnapshot.snapshotComplete;
      tailLoaded = roomDerivedSnapshot.tailLoaded;
    }

    saveSeedSnapshot(room, threadId, nextSeedEvents);

    const cacheSnapshot = persistThreadEventCacheSnapshot({
      sessionId,
      room,
      threadId,
      events: threadEvents,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      save: saveThreadSnapshot,
    });

    writes.push({
      threadId,
      threadEvents,
      rootEvent,
      nextSeedEvents,
      roomDerivedSnapshot,
      cacheSnapshot,
    });
  });

  return writes;
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

  countCacheProbe('serializedEvents', rawEvents.length);
  // CINNY-207 P1.5 (F4): same surfacing/read-only gate as the thread path.
  if (isCacheWritable()) {
    save(sessionId, room.roomId, rawEvents, beforeTokenForEarliest).catch((error) => {
      reportCacheWriteError('roomEventCache.save', error);
      return undefined;
    });
  }

  return {
    rawEvents,
    sourceEventCount: events.length,
    beforeTokenForEarliest,
  };
};
