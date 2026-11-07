import type { ThreadSummaryInfo } from '../../../matrix/protocol/threadSummary';
import { reportCacheWriteError } from '../cacheHealth';
import { openCacheStore } from './cacheStoreDb';
import { THREAD_SUMMARIES_BY_ROOM_INDEX, THREAD_SUMMARIES_STORE } from './cacheStoreSchema';
import {
  loadCachedThreadSummaries as loadSummaries,
  saveCachedThreadSummary as saveSummary,
} from './cacheStoreSummaries';

// The offline cache keeps encrypted rooms as the server sends them: events and attachments stay
// ciphertext on disk, and the client decrypts them again after a reload. A thread's title comes
// out of a decrypted notice, and the cache kept it in the clear (P2-e2ee-F011). An encrypted
// room's titles now stay in memory only: the client reads them from the thread's events again.

type EncryptedRoomCheck = (roomId: string) => boolean;

const checks = new Map<string, EncryptedRoomCheck>();

/**
 * Lets the cache of `sessionId` ask its client whether a room is encrypted. Returns a function
 * that forgets the check again.
 */
export const registerEncryptedRoomCheck = (
  sessionId: string,
  check: EncryptedRoomCheck
): (() => void) => {
  checks.set(sessionId, check);
  return () => {
    if (checks.get(sessionId) === check) checks.delete(sessionId);
  };
};

const isEncryptedRoom = (sessionId: string, roomId: string): boolean =>
  checks.get(sessionId)?.(roomId) ?? false;

/** Deletes the titles the cache holds for a room, also those an older version kept. */
const forgetRoomSummaries = async (sessionId: string, roomId: string): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(THREAD_SUMMARIES_STORE, 'readwrite');
    const request = transaction
      .objectStore(THREAD_SUMMARIES_STORE)
      .index(THREAD_SUMMARIES_BY_ROOM_INDEX)
      .openCursor(IDBKeyRange.only(roomId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

/** Saves a thread's title, unless the room is encrypted. */
export const saveCachedThreadSummary = async (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: ThreadSummaryInfo
): Promise<void> => {
  if (!isEncryptedRoom(sessionId, roomId)) {
    await saveSummary(sessionId, roomId, threadRootId, info);
    return;
  }
  await forgetRoomSummaries(sessionId, roomId).catch((error: unknown) =>
    reportCacheWriteError('threadSummaryCache.forget', error)
  );
};

/** The titles the cache holds for a room; none for an encrypted room, whose copies it deletes. */
export const loadCachedThreadSummaries = async (
  sessionId: string,
  roomId: string
): Promise<Map<string, ThreadSummaryInfo>> => {
  if (!isEncryptedRoom(sessionId, roomId)) return loadSummaries(sessionId, roomId);
  await forgetRoomSummaries(sessionId, roomId);
  return new Map();
};
