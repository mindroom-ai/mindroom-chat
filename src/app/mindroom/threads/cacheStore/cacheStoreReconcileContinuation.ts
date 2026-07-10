import { openCacheStore } from './cacheStoreDb';
import { buildMetaKey, META_STORE, type CachedMetaRecord } from './cacheStoreSchema';

export type ThreadReconcileContinuation = NonNullable<
  CachedMetaRecord['threadReconcileContinuation']
>;

const updateThreadMeta = async <T>(
  sessionId: string,
  roomId: string,
  threadId: string,
  update: (existing: CachedMetaRecord | undefined, store: IDBObjectStore) => T
): Promise<T> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new Error('Thread reconciliation storage is unavailable.');
  const metaKey = buildMetaKey(roomId, threadId);
  let result: T;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const request = store.get(metaKey);
    request.onsuccess = () => {
      result = update(request.result as CachedMetaRecord | undefined, store);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  return result!;
};

export const loadThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string
): Promise<ThreadReconcileContinuation | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new Error('Thread reconciliation storage is unavailable.');
  const metaKey = buildMetaKey(roomId, threadId);
  return new Promise<ThreadReconcileContinuation | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(metaKey);
    request.onsuccess = () => {
      resolve((request.result as CachedMetaRecord | undefined)?.threadReconcileContinuation);
    };
    request.onerror = () => reject(request.error);
  });
};

/** Create a continuation unless another pass already owns one. */
export const beginThreadReconcileContinuation = (
  sessionId: string,
  roomId: string,
  threadId: string,
  candidate: ThreadReconcileContinuation
): Promise<ThreadReconcileContinuation> =>
  updateThreadMeta(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (current) return current;
    store.put({
      ...(existing ?? {
        metaKey: buildMetaKey(roomId, threadId),
        roomId,
        scope: threadId,
      }),
      updatedAt: Date.now(),
      threadReconcileContinuation: candidate,
    } satisfies CachedMetaRecord);
    return candidate;
  });

export const checkpointThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string,
  nextToken: string
): Promise<boolean> =>
  updateThreadMeta(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return false;
    store.put({
      ...existing,
      updatedAt: Date.now(),
      threadReconcileContinuation: { ...current, nextToken },
    } satisfies CachedMetaRecord);
    return true;
  });

/** Restart from the live head while retaining the original overlap boundary. */
export const restartThreadReconcileContinuationFromHead = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string,
  nextGeneration: string
): Promise<ThreadReconcileContinuation | undefined> =>
  updateThreadMeta(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return undefined;
    const { nextToken: _drop, ...marker } = current;
    const restarted = {
      ...marker,
      generation: nextGeneration,
      validatingHead: true as const,
    };
    store.put({
      ...existing,
      updatedAt: Date.now(),
      threadReconcileContinuation: restarted,
    } satisfies CachedMetaRecord);
    return restarted;
  });

export const clearThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string
): Promise<boolean> =>
  updateThreadMeta(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return false;
    const { threadReconcileContinuation: _drop, ...rest } = existing;
    store.put({ ...rest, updatedAt: Date.now() } satisfies CachedMetaRecord);
    return true;
  });
