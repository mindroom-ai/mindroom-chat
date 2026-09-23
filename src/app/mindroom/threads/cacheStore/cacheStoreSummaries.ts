import { repairCachedThreadSummaries } from './cacheStoreSummaryProjection';
import type { MindroomThreadSummaryInfo } from '../../messages/threadSummary';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  openCacheStore,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
} from './cacheStoreDb';
import {
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  type CachedThreadSummaryRecord,
} from './cacheStoreSchema';

export const loadCachedThreadSummaries = async (
  sessionId: string,
  roomId: string
): Promise<Map<string, MindroomThreadSummaryInfo>> => {
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  const result = new Map<string, MindroomThreadSummaryInfo>();
  const db = await openCacheStore(sessionId);
  if (!db || !isCacheStoreWriteLeaseCurrent(lease)) return result;
  if (isCacheWritable()) {
    try {
      await repairCachedThreadSummaries(db, lease, roomId);
    } catch (error) {
      if (isCacheStoreWriteLeaseCurrent(lease)) reportCacheWriteError('summaryMigration', error);
    }
  }
  if (!isCacheStoreWriteLeaseCurrent(lease)) return result;

  return new Promise<Map<string, MindroomThreadSummaryInfo>>((resolve, reject) => {
    const transaction = db.transaction(THREAD_SUMMARIES_STORE, 'readonly');
    const store = transaction.objectStore(THREAD_SUMMARIES_STORE);
    const index = store.index(THREAD_SUMMARIES_BY_ROOM_INDEX);
    const request = index.openCursor(IDBKeyRange.only(roomId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as CachedThreadSummaryRecord;
      result.set(record.threadRootId, {
        summaryText: record.summaryText,
        generatedTs: record.generatedTs,
        ...(record.eventTs !== undefined ? { eventTs: record.eventTs } : {}),
        messageCount: record.messageCount,
        ...(record.isManual ? { isManual: true } : {}),
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () =>
      resolve(isCacheStoreWriteLeaseCurrent(lease) ? result : new Map());
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
