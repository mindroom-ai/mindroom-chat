import { countCacheProbe } from '../cacheProbe';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import { openCacheStore } from './cacheStoreDb';
import {
  MAX_THREAD_HEIGHT_ENTRIES,
  THREAD_HEIGHTS_STORE,
  buildThreadHeightsCacheKey,
  type CachedThreadHeightsRecord,
} from './cacheStoreSchema';

// Schema v4: measured tile heights per thread. On reopen the record seeds
// the virtualizer's initialMeasurementsCache so revisited rows are priced
// exactly instead of estimated (device trace ride-trace-1783444824925:
// +6327px of estimate error over one ride through real agent content —
// every boundary settle repaying such debt is a momentum interruption).

export const saveCachedThreadHeights = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  layoutKey: string,
  heights: Record<string, number>
): Promise<void> => {
  if (!isCacheWritable()) return;

  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(THREAD_HEIGHTS_STORE, 'readwrite');
      const store = transaction.objectStore(THREAD_HEIGHTS_STORE);
      const cacheKey = buildThreadHeightsCacheKey(roomId, threadId);
      const getRequest = store.get(cacheKey);
      getRequest.onsuccess = () => {
        const previous = getRequest.result as CachedThreadHeightsRecord | undefined;
        // Merge over the previous record so regions measured in earlier
        // sessions survive rides that only revisit part of the thread —
        // unless the layout changed, which invalidates every old height.
        const merged =
          previous && previous.layoutKey === layoutKey
            ? { ...previous.heights, ...heights }
            : { ...heights };
        let entries = Object.entries(merged);
        if (entries.length > MAX_THREAD_HEIGHT_ENTRIES) {
          // No per-entry timestamps to rank by; dropping the surplus from
          // the front keeps the record bounded and the estimator covers
          // whatever was dropped.
          entries = entries.slice(entries.length - MAX_THREAD_HEIGHT_ENTRIES);
        }
        const record: CachedThreadHeightsRecord = {
          cacheKey,
          roomId,
          threadId,
          layoutKey,
          heights: Object.fromEntries(entries),
          updatedAt: Date.now(),
        };
        store.put(record);
        countCacheProbe('threadHeightsSaves');
      };
      getRequest.onerror = () => reject(getRequest.error);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    reportCacheWriteError('threadHeightsCache.save', error);
  }
};

export const loadCachedThreadHeights = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedLayoutKey: string
): Promise<Record<string, number> | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;

  return new Promise<Record<string, number> | undefined>((resolve, reject) => {
    const transaction = db.transaction(THREAD_HEIGHTS_STORE, 'readonly');
    const store = transaction.objectStore(THREAD_HEIGHTS_STORE);
    const request = store.get(buildThreadHeightsCacheKey(roomId, threadId));

    let loaded: Record<string, number> | undefined;
    request.onsuccess = () => {
      const record = request.result as CachedThreadHeightsRecord | undefined;
      if (!record) return;
      if (record.layoutKey !== expectedLayoutKey) {
        // Layout changed since measurement (width/zoom/density): every
        // height is wrong in the same direction — seeding thousands of
        // wrong prices is worse than estimating. Discard wholesale.
        countCacheProbe('threadHeightsLayoutMismatches');
        return;
      }
      loaded = record.heights;
      countCacheProbe('threadHeightsSeedLoads');
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => resolve(loaded);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
