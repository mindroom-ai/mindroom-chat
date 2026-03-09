import { IEvent } from 'matrix-js-sdk';
import { getSessionScopedStorageKey } from '../../state/sessions';
import {
  CachedPaginationTokenMap,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from './eventCacheTokenUtils';

const DB_NAME = 'mindroom-thread-event-cache';
const DB_VERSION = 1;
const EVENT_STORE = 'thread_events';
const META_STORE = 'thread_meta';
const EVENT_THREAD_TS_INDEX = 'by_thread_ts';
const MAX_EVENT_TS = Number.MAX_SAFE_INTEGER;
const MAX_EVENT_ID = '\uffff';

type CachedThreadEventRecord = {
  cacheKey: string;
  roomId: string;
  threadId: string;
  eventId: string;
  ts: number;
  rawEvent: Partial<IEvent>;
};

type CachedThreadMetaRecord = {
  threadKey: string;
  roomId: string;
  threadId: string;
  beforeTokens?: CachedPaginationTokenMap;
  rootEvent?: Partial<IEvent>;
  updatedAt: number;
};

export type CachedThreadEvent = Partial<IEvent> & {
  event_id: string;
  origin_server_ts: number;
};

export type CachedThreadEventPage = {
  rootEvent?: Partial<IEvent>;
  events: CachedThreadEvent[];
  hasMoreBefore: boolean;
  beforeToken?: string | null;
};

type ThreadCursorAnchor = {
  eventId: string;
  ts: number;
};

const dbPromiseByName = new Map<string, Promise<IDBDatabase | undefined>>();

const getThreadKey = (roomId: string, threadId: string): string => `${roomId}|${threadId}`;
const getEventCacheKey = (roomId: string, threadId: string, eventId: string): string =>
  `${roomId}|${threadId}|${eventId}`;

const getEventTs = (rawEvent: Partial<IEvent>): number =>
  typeof rawEvent.origin_server_ts === 'number' && Number.isFinite(rawEvent.origin_server_ts)
    ? rawEvent.origin_server_ts
    : 0;

const toCachedThreadEvent = (rawEvent: Partial<IEvent>): CachedThreadEvent | undefined => {
  if (typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) return undefined;
  return {
    ...rawEvent,
    event_id: rawEvent.event_id,
    origin_server_ts: getEventTs(rawEvent),
  };
};

const sortThreadEvents = (a: CachedThreadEvent, b: CachedThreadEvent): number => {
  const tsDiff = a.origin_server_ts - b.origin_server_ts;
  if (tsDiff !== 0) return tsDiff;
  return a.event_id.localeCompare(b.event_id);
};

export const filterPageableCachedThreadEvents = (
  rawEvents: CachedThreadEvent[],
  threadId: string
): CachedThreadEvent[] => rawEvents.filter((rawEvent) => rawEvent.event_id !== threadId);

export const normalizeCachedThreadEvents = (
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>
): CachedThreadEvent[] => {
  const eventMap = new Map<string, CachedThreadEvent>();

  rawEvents.forEach((rawEvent) => {
    const normalized = toCachedThreadEvent(rawEvent);
    if (!normalized) return;
    eventMap.set(normalized.event_id, normalized);
  });

  const normalizedRoot = rootEvent ? toCachedThreadEvent(rootEvent) : undefined;
  if (normalizedRoot && !eventMap.has(normalizedRoot.event_id)) {
    eventMap.set(normalizedRoot.event_id, normalizedRoot);
  }

  return Array.from(eventMap.values()).sort(sortThreadEvents);
};

export const getThreadCursorAnchor = (
  rawEvent: Partial<IEvent> | CachedThreadEvent | undefined
): ThreadCursorAnchor | undefined => {
  if (!rawEvent || typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) {
    return undefined;
  }

  return {
    eventId: rawEvent.event_id,
    ts: getEventTs(rawEvent),
  };
};

export const getThreadEventCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, DB_NAME);

const openThreadEventCache = (sessionId: string): Promise<IDBDatabase | undefined> => {
  const dbName = getThreadEventCacheDbName(sessionId);
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
        eventStore.createIndex(EVENT_THREAD_TS_INDEX, ['roomId', 'threadId', 'ts', 'eventId'], {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, {
          keyPath: 'threadKey',
        });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromiseByName.delete(dbName);
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });

  dbPromiseByName.set(dbName, dbPromise);
  return dbPromise;
};

const runCursorQuery = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  limit: number,
  upperBound?: ThreadCursorAnchor
): Promise<CachedThreadEventPage> => {
  const db = await openThreadEventCache(sessionId);
  if (!db || limit <= 0) return { events: [], hasMoreBefore: false };

  const threadKey = getThreadKey(roomId, threadId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readonly');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const index = eventStore.index(EVENT_THREAD_TS_INDEX);
    const lower = [roomId, threadId, 0, ''];
    const upper = upperBound
      ? [roomId, threadId, upperBound.ts, upperBound.eventId]
      : [roomId, threadId, MAX_EVENT_TS, MAX_EVENT_ID];
    const range = IDBKeyRange.bound(lower, upper, false, !!upperBound);

    const metaRequest = metaStore.get(threadKey);
    const events: CachedThreadEvent[] = [];
    let hasMoreBefore = false;

    const cursorRequest = index.openCursor(range, 'prev');
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;

      const record = cursor.value as CachedThreadEventRecord;
      const normalized = toCachedThreadEvent(record.rawEvent);
      if (!normalized) {
        cursor.continue();
        return;
      }
      if (normalized.event_id === threadId) {
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

    transaction.oncomplete = () => {
      const meta = metaRequest.result as CachedThreadMetaRecord | undefined;
      const orderedEvents = events.reverse();
      resolve({
        rootEvent: meta?.rootEvent,
        events: orderedEvents,
        hasMoreBefore,
        beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
      });
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadLatestCachedThreadEvents = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  limit: number
): Promise<CachedThreadEventPage> => runCursorQuery(sessionId, roomId, threadId, limit);

export const loadCachedThreadEventsBefore = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  before: ThreadCursorAnchor | undefined,
  limit: number
): Promise<CachedThreadEventPage> => {
  if (!before) return { events: [], hasMoreBefore: false };
  return runCursorQuery(sessionId, roomId, threadId, limit, before);
};

export const saveThreadEventsToCache = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>,
  beforeTokenForEarliest?: string | null
): Promise<void> => {
  const db = await openThreadEventCache(sessionId);
  if (!db) return;

  const normalizedEvents = filterPageableCachedThreadEvents(
    normalizeCachedThreadEvents(rawEvents),
    threadId
  );
  if (normalizedEvents.length === 0 && !rootEvent) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readwrite');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const threadKey = getThreadKey(roomId, threadId);
    const earliestEventId = normalizedEvents[0]?.event_id;

    normalizedEvents.forEach((rawEvent) => {
      const eventRecord: CachedThreadEventRecord = {
        cacheKey: getEventCacheKey(roomId, threadId, rawEvent.event_id),
        roomId,
        threadId,
        eventId: rawEvent.event_id,
        ts: rawEvent.origin_server_ts,
        rawEvent,
      };
      eventStore.put(eventRecord);
    });

    const metaRequest = metaStore.get(threadKey);
    metaRequest.onsuccess = () => {
      const currentMeta = metaRequest.result as CachedThreadMetaRecord | undefined;
      const nextMeta: CachedThreadMetaRecord = {
        threadKey,
        roomId,
        threadId,
        beforeTokens: mergeCachedPaginationTokens(
          currentMeta?.beforeTokens,
          earliestEventId,
          beforeTokenForEarliest
        ),
        rootEvent: rootEvent ?? currentMeta?.rootEvent,
        updatedAt: Date.now(),
      };
      metaStore.put(nextMeta);
    };
    metaRequest.onerror = () => reject(metaRequest.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const deleteThreadEventCache = async (sessionId: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  const dbName = getThreadEventCacheDbName(sessionId);
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
