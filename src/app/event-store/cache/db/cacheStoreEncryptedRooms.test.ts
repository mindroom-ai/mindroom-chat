import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cache from './index';
import { openCacheStore, resetCacheStoreForTesting } from './cacheStoreDb';
import { registerEncryptedRoomCheck } from './cacheStoreEncryptedRooms';
import { THREAD_SUMMARIES_STORE } from './cacheStoreSchema';

// Regression (P2-e2ee-F011): the offline cache keeps an encrypted room's events as ciphertext, but
// it kept the room's AI thread titles, read out of decrypted notices, in the clear.

vi.mock('./cacheStoreLegacyWipe', () => ({
  performLegacyDbWipe: vi.fn(async () => undefined),
}));

const SESSION_ID = 'encrypted-titles-session';
const SECURE = '!secure:example.org';
const PLAIN = '!plain:example.org';
const TITLE = { summaryText: 'Quarterly budget review', generatedTs: 1, messageCount: 2 };

const storedTitles = async (): Promise<Array<{ roomId: string; summaryText: string }>> => {
  const db = (await openCacheStore(SESSION_ID))!;
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(THREAD_SUMMARIES_STORE, 'readonly')
      .objectStore(THREAD_SUMMARIES_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result as never);
    request.onerror = () => reject(request.error);
  });
};

describe('thread titles of encrypted rooms in the offline cache', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    resetCacheStoreForTesting();
  });

  it('keep the titles of an encrypted room off disk and delete what an older version kept', async () => {
    // An older version, which had no check, kept the title in the clear.
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$old', TITLE);
    expect((await storedTitles()).map((record) => record.roomId)).toEqual([SECURE]);

    const forget = registerEncryptedRoomCheck(SESSION_ID, (roomId) => roomId === SECURE);
    expect((await cache.loadCachedThreadSummaries(SESSION_ID, SECURE)).size).toBe(0);
    expect(await storedTitles()).toEqual([]);

    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$new', TITLE);
    await cache.saveCachedThreadSummary(SESSION_ID, PLAIN, '$plain', TITLE);
    expect((await storedTitles()).map((record) => record.roomId)).toEqual([PLAIN]);
    expect((await cache.loadCachedThreadSummaries(SESSION_ID, PLAIN)).get('$plain')).toMatchObject(
      TITLE
    );

    // Once the session's client is gone, nothing is known to be encrypted.
    forget();
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$later', TITLE);
    expect((await storedTitles()).map((record) => record.roomId).sort()).toEqual([PLAIN, SECURE]);
  });
});
