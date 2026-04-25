import { IEvent } from 'matrix-js-sdk';
import { getSessionScopedStorageKey, listSessions } from '../../state/sessions';
import {
  CachedPaginationTokenMap,
  compareCachedPaginationAnchors,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from '../../mindroom/threads/eventCacheTokenUtils';
import {
  copyLegacyIndexedDbIfTargetStoreEmpty,
  openExistingDatabase,
} from './cacheDbMigrationUtils';

const DB_NAME = 'mindroom-room-event-cache';
const DB_VERSION = 2;
const EVENT_STORE = 'room_events';
const META_STORE = 'room_meta';
const EVENT_ROOM_TS_INDEX = 'by_room_ts';
const MAX_EVENT_TS = Number.MAX_SAFE_INTEGER;
const MAX_EVENT_ID = '\uffff';

type CachedRoomEventRecord = {
  cacheKey: string;
  roomId: string;
  eventId: string;
  ts: number;
  rawEvent: Partial<IEvent>;
};

type CachedRoomMetaRecord = {
  roomId: string;
  beforeTokens?: CachedPaginationTokenMap;
  updatedAt: number;
};

export type CachedRoomEvent = Partial<IEvent> & {
  event_id: string;
  origin_server_ts: number;
};

export type CachedRoomEventPage = {
  events: CachedRoomEvent[];
  hasMoreBefore: boolean;
  beforeToken?: string | null;
};

type RoomCursorAnchor = {
  eventId: string;
  ts: number;
};

const dbPromiseByName = new Map<string, Promise<IDBDatabase | undefined>>();

const getEventCacheKey = (roomId: string, eventId: string): string => `${roomId}|${eventId}`;

const getEventTs = (rawEvent: Partial<IEvent>): number =>
  typeof rawEvent.origin_server_ts === 'number' && Number.isFinite(rawEvent.origin_server_ts)
    ? rawEvent.origin_server_ts
    : 0;

const toCachedRoomEvent = (rawEvent: Partial<IEvent>): CachedRoomEvent | undefined => {
  if (typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) return undefined;
  return {
    ...rawEvent,
    event_id: rawEvent.event_id,
    origin_server_ts: getEventTs(rawEvent),
  };
};

const sortRoomEvents = (a: CachedRoomEvent, b: CachedRoomEvent): number => {
  return compareCachedPaginationAnchors(getRoomCursorAnchor(a), getRoomCursorAnchor(b));
};

export const normalizeCachedRoomEvents = (rawEvents: Partial<IEvent>[]): CachedRoomEvent[] => {
  const eventMap = new Map<string, CachedRoomEvent>();

  rawEvents.forEach((rawEvent) => {
    const normalized = toCachedRoomEvent(rawEvent);
    if (!normalized) return;
    eventMap.set(normalized.event_id, normalized);
  });

  return Array.from(eventMap.values()).sort(sortRoomEvents);
};

export const getRoomCursorAnchor = (
  rawEvent: Partial<IEvent> | CachedRoomEvent | undefined
): RoomCursorAnchor | undefined => {
  if (!rawEvent || typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) {
    return undefined;
  }

  return {
    eventId: rawEvent.event_id,
    ts: getEventTs(rawEvent),
  };
};

export const getRoomEventCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, DB_NAME);

const shouldAttemptLegacyRoomEventCacheMigration = (sessionId: string): boolean => {
  const sessions = listSessions();
  return sessions.length === 0 || (sessions.length === 1 && sessions[0]?.sessionId === sessionId);
};

const migrateLegacyRoomEventCacheIfNeeded = async (
  sessionId: string,
  targetDb: IDBDatabase
): Promise<void> => {
  if (!shouldAttemptLegacyRoomEventCacheMigration(sessionId)) return;
  if (targetDb.name === DB_NAME) return;

  const legacyDb = await openExistingDatabase(DB_NAME);
  if (!legacyDb || legacyDb.name === targetDb.name) return;

  try {
    await copyLegacyIndexedDbIfTargetStoreEmpty<CachedRoomEventRecord, CachedRoomMetaRecord>({
      targetDb,
      legacyDb,
      primaryStoreName: EVENT_STORE,
      secondaryStoreName: META_STORE,
    });
  } finally {
    legacyDb.close();
  }
};

const openRoomEventCache = (sessionId: string): Promise<IDBDatabase | undefined> => {
  const dbName = getRoomEventCacheDbName(sessionId);
  const currentPromise = dbPromiseByName.get(dbName);
  if (currentPromise) return currentPromise;
  if (typeof indexedDB === 'undefined') {
    const missingDbPromise = Promise.resolve(undefined);
    dbPromiseByName.set(dbName, missingDbPromise);
    return missingDbPromise;
  }

  const dbPromise = new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const eventStore = db.createObjectStore(EVENT_STORE, {
          keyPath: 'cacheKey',
        });
        eventStore.createIndex(EVENT_ROOM_TS_INDEX, ['roomId', 'ts', 'eventId'], {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, {
          keyPath: 'roomId',
        });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromiseByName.delete(dbName);
      };
      migrateLegacyRoomEventCacheIfNeeded(sessionId, db)
        .catch(() => undefined)
        .finally(() => resolve(db));
    };
    request.onerror = () => reject(request.error);
  });

  dbPromiseByName.set(dbName, dbPromise);
  return dbPromise;
};

const runCursorQuery = async (
  sessionId: string,
  roomId: string,
  limit: number,
  upperBound?: RoomCursorAnchor
): Promise<CachedRoomEventPage> => {
  const db = await openRoomEventCache(sessionId);
  if (!db || limit <= 0) return { events: [], hasMoreBefore: false };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readonly');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const index = eventStore.index(EVENT_ROOM_TS_INDEX);
    const lower = [roomId, 0, ''];
    const upper = upperBound
      ? [roomId, upperBound.ts, upperBound.eventId]
      : [roomId, MAX_EVENT_TS, MAX_EVENT_ID];
    const range = IDBKeyRange.bound(lower, upper, false, !!upperBound);
    const metaRequest = metaStore.get(roomId);

    const events: CachedRoomEvent[] = [];
    let hasMoreBefore = false;

    const cursorRequest = index.openCursor(range, 'prev');
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;

      const record = cursor.value as CachedRoomEventRecord;
      const normalized = toCachedRoomEvent(record.rawEvent);
      if (!normalized) {
        cursor.continue();
        return;
      }

      if (events.length < limit) {
        events.push(normalized);
        cursor.continue();
        return;
      }

      hasMoreBefore = true;
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);

    transaction.oncomplete = () =>
      resolve((() => {
        const orderedEvents = events.reverse();
        const meta = metaRequest.result as CachedRoomMetaRecord | undefined;
        return {
          events: orderedEvents,
          hasMoreBefore,
          beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
        };
      })());
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadLatestCachedRoomEvents = async (
  sessionId: string,
  roomId: string,
  limit: number
): Promise<CachedRoomEventPage> => runCursorQuery(sessionId, roomId, limit);

export const loadCachedRoomEventsBefore = async (
  sessionId: string,
  roomId: string,
  before: RoomCursorAnchor | undefined,
  limit: number
): Promise<CachedRoomEventPage> => {
  if (!before) return { events: [], hasMoreBefore: false };
  return runCursorQuery(sessionId, roomId, limit, before);
};

export const loadCachedRoomPaginationToken = async (
  sessionId: string,
  roomId: string,
  eventId: string | undefined
): Promise<string | null | undefined> => {
  if (!eventId) return undefined;

  const db = await openRoomEventCache(sessionId);
  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const metaRequest = metaStore.get(roomId);

    transaction.oncomplete = () => {
      const meta = metaRequest.result as CachedRoomMetaRecord | undefined;
      resolve(getCachedPaginationToken(meta?.beforeTokens, eventId));
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    metaRequest.onerror = () => reject(metaRequest.error);
  });
};

export const loadCachedRoomEvent = async (
  sessionId: string,
  roomId: string,
  eventId: string
): Promise<CachedRoomEvent | undefined> => {
  const db = await openRoomEventCache(sessionId);
  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EVENT_STORE, 'readonly');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const eventRequest = eventStore.get(getEventCacheKey(roomId, eventId));

    transaction.oncomplete = () => {
      const record = eventRequest.result as CachedRoomEventRecord | undefined;
      resolve(record ? toCachedRoomEvent(record.rawEvent) : undefined);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    eventRequest.onerror = () => reject(eventRequest.error);
  });
};

export const saveRoomEventsToCache = async (
  sessionId: string,
  roomId: string,
  rawEvents: Partial<IEvent>[],
  beforeTokenForEarliest?: string | null
): Promise<void> => {
  const db = await openRoomEventCache(sessionId);
  if (!db) return;

  const normalizedEvents = normalizeCachedRoomEvents(rawEvents);
  if (normalizedEvents.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readwrite');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const earliestEventId = normalizedEvents[0]?.event_id;

    normalizedEvents.forEach((rawEvent) => {
      const eventRecord: CachedRoomEventRecord = {
        cacheKey: getEventCacheKey(roomId, rawEvent.event_id),
        roomId,
        eventId: rawEvent.event_id,
        ts: rawEvent.origin_server_ts,
        rawEvent,
      };
      eventStore.put(eventRecord);
    });

    if (beforeTokenForEarliest !== undefined && earliestEventId) {
      const metaRequest = metaStore.get(roomId);
      metaRequest.onsuccess = () => {
        const currentMeta = metaRequest.result as CachedRoomMetaRecord | undefined;
        const nextMeta: CachedRoomMetaRecord = {
          roomId,
          beforeTokens: mergeCachedPaginationTokens(
            currentMeta?.beforeTokens,
            earliestEventId,
            beforeTokenForEarliest
          ),
          updatedAt: Date.now(),
        };
        metaStore.put(nextMeta);
      };
      metaRequest.onerror = () => reject(metaRequest.error);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const deleteRoomEventCache = async (sessionId: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  const dbName = getRoomEventCacheDbName(sessionId);
  const currentDb = await dbPromiseByName.get(dbName);
  currentDb?.close();
  dbPromiseByName.delete(dbName);

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
};
