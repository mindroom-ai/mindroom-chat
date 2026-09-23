import type { MindroomThreadSummaryInfo } from '../../../messages/threadSummary';

/** Seed the persisted format used before accepted event transactions owned summaries. */
export const seedLegacyCachedThreadSummary = async (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: MindroomThreadSummaryInfo
): Promise<void> => {
  const { openCacheStore } = await import('../cacheStoreDb');
  const { THREAD_SUMMARIES_STORE, buildSummaryCacheKey } = await import('../cacheStoreSchema');
  const db = (await openCacheStore(sessionId))!;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(THREAD_SUMMARIES_STORE, 'readwrite');
    tx.objectStore(THREAD_SUMMARIES_STORE).put({
      cacheKey: buildSummaryCacheKey(roomId, threadRootId),
      roomId,
      threadRootId,
      ...info,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};
