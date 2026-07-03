import { IEvent } from 'matrix-js-sdk';
import { getSessionScopedStorageKey, listSessions } from '../../state/sessions';
import {
  getThreadSummaryEventInfo,
  hasMindroomThreadSummary,
  MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import {
  CachedPaginationTokenMap,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from './eventCacheTokenUtils';
import {
  copyLegacyIndexedDbIfTargetStoreEmpty,
  openExistingDatabase,
} from './cacheDbMigrationUtils';
import { countCacheProbe } from './cacheProbe';

export const MINDROOM_THREAD_EVENT_CACHE_DB_NAME = 'mindroom-thread-event-cache';
const DB_NAME = MINDROOM_THREAD_EVENT_CACHE_DB_NAME;
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
  expectedReplyCount?: number;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
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
  expectedReplyCount?: number;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
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

const hasRequiredThreadEventCacheStores = (
  db: Pick<IDBDatabase, 'objectStoreNames'>
): boolean =>
  db.objectStoreNames.contains(EVENT_STORE) && db.objectStoreNames.contains(META_STORE);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getCachedThreadSummaryInfoFromRawEvent = (
  rawEvent: Partial<IEvent>
): MindroomThreadSummaryInfo | undefined => {
  const content = rawEvent.content;
  if (!isRecord(content) || !hasMindroomThreadSummary(content)) return undefined;

  return getThreadSummaryEventInfo({
    getContent: () => content,
  });
};

const getRawTransactionId = (rawEvent: Partial<IEvent>): string | undefined => {
  const txnId =
    typeof rawEvent.txn_id === 'string' && rawEvent.txn_id.length > 0
      ? rawEvent.txn_id
      : typeof rawEvent.unsigned?.transaction_id === 'string' &&
          rawEvent.unsigned.transaction_id.length > 0
        ? rawEvent.unsigned.transaction_id
        : undefined;

  return txnId;
};

const getRawEventKeys = (rawEvent: Partial<IEvent>): string[] => {
  const keys: string[] = [];

  if (typeof rawEvent.event_id === 'string' && rawEvent.event_id.length > 0) {
    keys.push(`event:${rawEvent.event_id}`);
  }

  const txnId = getRawTransactionId(rawEvent);
  if (txnId) {
    keys.push(`txn:${txnId}`);
  }

  return keys;
};

const isRawLocalEchoEvent = (rawEvent: Partial<IEvent>): boolean =>
  typeof rawEvent.event_id === 'string' && rawEvent.event_id.startsWith('~');

const pickPreferredCachedThreadEvent = (
  existingEvent: CachedThreadEvent,
  incomingEvent: CachedThreadEvent
): CachedThreadEvent => {
  const existingLocalEcho = isRawLocalEchoEvent(existingEvent);
  const incomingLocalEcho = isRawLocalEchoEvent(incomingEvent);
  if (existingLocalEcho !== incomingLocalEcho) {
    return existingLocalEcho ? incomingEvent : existingEvent;
  }

  return incomingEvent;
};

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

  const setEventForKeys = (keys: string[], mEvent: CachedThreadEvent) => {
    keys.forEach((key) => {
      eventMap.set(key, mEvent);
    });
  };

  const findExistingEvent = (keys: string[]): CachedThreadEvent | undefined =>
    keys.map((key) => eventMap.get(key)).find((mEvent): mEvent is CachedThreadEvent => !!mEvent);

  rawEvents.forEach((rawEvent) => {
    const normalized = toCachedThreadEvent(rawEvent);
    if (!normalized) return;
    if (isRawLocalEchoEvent(normalized)) return;
    const incomingKeys = getRawEventKeys(normalized);
    if (incomingKeys.length === 0) return;
    const existingEvent = findExistingEvent(incomingKeys);
    if (!existingEvent) {
      setEventForKeys(incomingKeys, normalized);
      return;
    }

    const preferredEvent = pickPreferredCachedThreadEvent(existingEvent, normalized);
    const mergedKeys = Array.from(new Set([...getRawEventKeys(existingEvent), ...incomingKeys]));
    setEventForKeys(mergedKeys, preferredEvent);
  });

  const normalizedRoot = rootEvent ? toCachedThreadEvent(rootEvent) : undefined;
  if (normalizedRoot && !isRawLocalEchoEvent(normalizedRoot)) {
    const rootKeys = getRawEventKeys(normalizedRoot);
    if (rootKeys.length > 0 && !findExistingEvent(rootKeys)) {
      setEventForKeys(rootKeys, normalizedRoot);
    }
  }

  return Array.from(new Set(eventMap.values())).sort(sortThreadEvents);
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

const shouldAttemptLegacyThreadEventCacheMigration = (sessionId: string): boolean => {
  const sessions = listSessions();
  return sessions.length === 0 || (sessions.length === 1 && sessions[0]?.sessionId === sessionId);
};

const migrateLegacyThreadEventCacheIfNeeded = async (
  sessionId: string,
  targetDb: IDBDatabase
): Promise<void> => {
  if (!shouldAttemptLegacyThreadEventCacheMigration(sessionId)) return;
  if (targetDb.name === DB_NAME) return;

  const legacyDb = await openExistingDatabase(DB_NAME);
  if (!legacyDb || legacyDb.name === targetDb.name) return;

  try {
    await copyLegacyIndexedDbIfTargetStoreEmpty<CachedThreadEventRecord, CachedThreadMetaRecord>({
      targetDb,
      legacyDb,
      primaryStoreName: EVENT_STORE,
      secondaryStoreName: META_STORE,
    });
  } finally {
    legacyDb.close();
  }
};

const deleteIndexedDb = async (dbName: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
};

const openThreadEventCache = (
  sessionId: string,
  allowRecovery = true
): Promise<IDBDatabase | undefined> => {
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
      if (!hasRequiredThreadEventCacheStores(db)) {
        db.close();
        dbPromiseByName.delete(dbName);

        if (allowRecovery) {
          deleteIndexedDb(dbName)
            .catch(() => undefined)
            .then(() => openThreadEventCache(sessionId, false))
            .then(resolve)
            .catch(reject);
          return;
        }

        openExistingDatabase(DB_NAME)
          .then((legacyDb) => {
            if (!legacyDb) return undefined;
            if (!hasRequiredThreadEventCacheStores(legacyDb)) {
              legacyDb.close();
              return undefined;
            }
            legacyDb.onversionchange = () => {
              legacyDb.close();
              dbPromiseByName.delete(dbName);
            };
            return legacyDb;
          })
          .then(resolve)
          .catch(reject);
        return;
      }

      db.onversionchange = () => {
        db.close();
        dbPromiseByName.delete(dbName);
      };
      migrateLegacyThreadEventCacheIfNeeded(sessionId, db)
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
        expectedReplyCount: normalizeExpectedReplyCount(meta?.expectedReplyCount),
        snapshotComplete: meta?.snapshotComplete === true,
        relationSnapshotComplete: meta?.relationSnapshotComplete === true,
        tailLoaded: meta?.tailLoaded === true,
      });
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const mergeThreadCacheFlag = (
  currentValue: boolean | undefined,
  nextValue: boolean | undefined
): boolean | undefined =>
  nextValue === undefined ? (currentValue === true ? true : undefined) : nextValue === true;

const normalizeExpectedReplyCount = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export const loadLatestCachedThreadEvents = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  limit: number
): Promise<CachedThreadEventPage> => runCursorQuery(sessionId, roomId, threadId, limit);

export const loadCachedThreadPaginationToken = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  eventId: string
): Promise<string | null | undefined> => {
  const db = await openThreadEventCache(sessionId);
  if (!db) return undefined;

  const threadKey = getThreadKey(roomId, threadId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([META_STORE], 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const metaRequest = metaStore.get(threadKey);

    transaction.oncomplete = () => {
      const meta = metaRequest.result as CachedThreadMetaRecord | undefined;
      resolve(getCachedPaginationToken(meta?.beforeTokens, eventId));
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

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

export const loadLatestCachedThreadSummaryInfo = async (
  sessionId: string,
  roomId: string,
  threadId: string
): Promise<MindroomThreadSummaryInfo | undefined> => {
  const db = await openThreadEventCache(sessionId);
  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EVENT_STORE, 'readonly');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const index = eventStore.index(EVENT_THREAD_TS_INDEX);
    const range = IDBKeyRange.bound(
      [roomId, threadId, 0, ''],
      [roomId, threadId, MAX_EVENT_TS, MAX_EVENT_ID]
    );

    let summaryInfo: MindroomThreadSummaryInfo | undefined;

    const cursorRequest = index.openCursor(range, 'prev');
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || summaryInfo?.summaryText) return;

      const record = cursor.value as CachedThreadEventRecord;
      if (record.eventId === threadId) {
        cursor.continue();
        return;
      }

      const info = getCachedThreadSummaryInfoFromRawEvent(record.rawEvent);
      if (!info?.summaryText) {
        cursor.continue();
        return;
      }

      summaryInfo = info;
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);

    transaction.oncomplete = () => resolve(summaryInfo);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadCachedThreadEvent = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  eventId: string
): Promise<CachedThreadEvent | undefined> => {
  const db = await openThreadEventCache(sessionId);
  if (!db) return undefined;

  const threadKey = getThreadKey(roomId, threadId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readonly');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const eventRequest = eventStore.get(getEventCacheKey(roomId, threadId, eventId));
    const metaRequest = eventId === threadId ? metaStore.get(threadKey) : undefined;

    transaction.oncomplete = () => {
      const record = eventRequest.result as CachedThreadEventRecord | undefined;
      if (record) {
        resolve(toCachedThreadEvent(record.rawEvent));
        return;
      }

      if (!metaRequest) {
        resolve(undefined);
        return;
      }

      const meta = metaRequest.result as CachedThreadMetaRecord | undefined;
      resolve(meta?.rootEvent ? toCachedThreadEvent(meta.rootEvent) : undefined);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    eventRequest.onerror = () => reject(eventRequest.error);
    metaRequest?.addEventListener('error', () => reject(metaRequest.error));
  });
};

export const saveThreadEventsToCache = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
): Promise<void> => {
  const db = await openThreadEventCache(sessionId);
  if (!db) return;

  const normalizedEvents = filterPageableCachedThreadEvents(
    normalizeCachedThreadEvents(rawEvents),
    threadId
  );
  if (normalizedEvents.length === 0 && !rootEvent) return;

  countCacheProbe('threadSaveCalls');
  countCacheProbe('threadEventPuts', normalizedEvents.length);
  countCacheProbe('threadMetaPuts');

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENT_STORE, META_STORE], 'readwrite');
    const eventStore = transaction.objectStore(EVENT_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const threadKey = getThreadKey(roomId, threadId);
    const earliestEventId = normalizedEvents[0]?.event_id;
    const normalizedExpectedReplyCount = normalizeExpectedReplyCount(expectedReplyCount);

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
        rootEvent: (rootEvent && !isRawLocalEchoEvent(rootEvent)) ? rootEvent : currentMeta?.rootEvent,
        expectedReplyCount: normalizedExpectedReplyCount ?? currentMeta?.expectedReplyCount,
        snapshotComplete: mergeThreadCacheFlag(currentMeta?.snapshotComplete, snapshotComplete),
        relationSnapshotComplete: mergeThreadCacheFlag(
          currentMeta?.relationSnapshotComplete,
          relationSnapshotComplete
        ),
        tailLoaded: mergeThreadCacheFlag(currentMeta?.tailLoaded, tailLoaded),
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
