import { IEvent } from 'matrix-js-sdk';
import {
  CachedPaginationTokenMap,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from './eventCacheTokenUtils';

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

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

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
  const tsDiff = a.origin_server_ts - b.origin_server_ts;
  if (tsDiff !== 0) return tsDiff;
  return a.event_id.localeCompare(b.event_id);
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

const openRoomEventCache = (): Promise<IDBDatabase | undefined> => {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(undefined);
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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
        dbPromise = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
};

const runCursorQuery = async (
  roomId: string,
  limit: number,
  upperBound?: RoomCursorAnchor
): Promise<CachedRoomEventPage> => {
  const db = await openRoomEventCache();
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
  roomId: string,
  limit: number
): Promise<CachedRoomEventPage> => runCursorQuery(roomId, limit);

export const loadCachedRoomEventsBefore = async (
  roomId: string,
  before: RoomCursorAnchor | undefined,
  limit: number
): Promise<CachedRoomEventPage> => {
  if (!before) return { events: [], hasMoreBefore: false };
  return runCursorQuery(roomId, limit, before);
};

export const saveRoomEventsToCache = async (
  roomId: string,
  rawEvents: Partial<IEvent>[],
  beforeTokenForEarliest?: string | null
): Promise<void> => {
  const db = await openRoomEventCache();
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

export const deleteRoomEventCache = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  const currentDb = await dbPromise;
  currentDb?.close();
  dbPromise = undefined;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
};
