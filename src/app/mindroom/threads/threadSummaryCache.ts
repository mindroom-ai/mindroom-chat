import { getSessionScopedStorageKey } from '../../state/sessions';
import { MindroomThreadSummaryInfo } from '../messages/threadSummary';

const DB_NAME = 'mindroom-thread-summary-cache';
const DB_VERSION = 1;
const SUMMARY_STORE = 'thread_summaries';

type CachedThreadSummaryRecord = {
  cacheKey: string;
  roomId: string;
  threadRootId: string;
  summaryText: string;
  generatedTs?: number;
  messageCount?: number;
  updatedAt: number;
};

const dbPromiseByName = new Map<string, Promise<IDBDatabase | undefined>>();

const getCacheKey = (roomId: string, threadRootId: string): string =>
  `${roomId}|${threadRootId}`;

export const getThreadSummaryCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, DB_NAME);

const openThreadSummaryCache = (sessionId: string): Promise<IDBDatabase | undefined> => {
  const dbName = getThreadSummaryCacheDbName(sessionId);
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
      if (!db.objectStoreNames.contains(SUMMARY_STORE)) {
        const store = db.createObjectStore(SUMMARY_STORE, { keyPath: 'cacheKey' });
        store.createIndex('by_room', 'roomId', { unique: false });
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

export const saveCachedThreadSummary = async (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: MindroomThreadSummaryInfo
): Promise<void> => {
  const db = await openThreadSummaryCache(sessionId);
  if (!db || !info.summaryText) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SUMMARY_STORE, 'readwrite');
    const store = transaction.objectStore(SUMMARY_STORE);

    const record: CachedThreadSummaryRecord = {
      cacheKey: getCacheKey(roomId, threadRootId),
      roomId,
      threadRootId,
      summaryText: info.summaryText!,
      generatedTs: info.generatedTs,
      messageCount: info.messageCount,
      updatedAt: Date.now(),
    };
    store.put(record);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadCachedThreadSummaries = async (
  sessionId: string,
  roomId: string
): Promise<Map<string, MindroomThreadSummaryInfo>> => {
  const result = new Map<string, MindroomThreadSummaryInfo>();
  const db = await openThreadSummaryCache(sessionId);
  if (!db) return result;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SUMMARY_STORE, 'readonly');
    const store = transaction.objectStore(SUMMARY_STORE);
    const index = store.index('by_room');
    const request = index.openCursor(IDBKeyRange.only(roomId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as CachedThreadSummaryRecord;
      result.set(record.threadRootId, {
        summaryText: record.summaryText,
        generatedTs: record.generatedTs,
        messageCount: record.messageCount,
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const deleteThreadSummaryCache = async (sessionId: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  const dbName = getThreadSummaryCacheDbName(sessionId);
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
