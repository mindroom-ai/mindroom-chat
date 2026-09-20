import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCacheStoreDbName, openCacheStore, resetCacheStoreForTesting } from '../cacheStoreDb';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  type CachedEventRecord,
} from '../cacheStoreSchema';

const SESSION_ID = 'schema-upgrade-session';

const seedVersionThreeDatabase = async (): Promise<CachedEventRecord> => {
  const seededEvent: CachedEventRecord = {
    cacheKey: '!room:example.org||$event',
    roomId: '!room:example.org',
    scope: '',
    eventId: '$event',
    ts: 123,
    rawEvent: {
      event_id: '$event',
      origin_server_ts: 123,
      room_id: '!room:example.org',
      type: 'm.room.message',
      content: { body: 'preserved', msgtype: 'm.text' },
    },
    approxBytes: 128,
  };
  const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    events.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId']);
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
    db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
    const summaries = db.createObjectStore(THREAD_SUMMARIES_STORE, { keyPath: 'cacheKey' });
    summaries.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId');
    events.put(seededEvent);
  };
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  return seededEvent;
};

describe('cacheStore attachment schema', () => {
  beforeEach(() => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
  });

  it('adds attachment stores and indexes without replacing version-three events', async () => {
    const seededEvent = await seedVersionThreeDatabase();

    const db = await openCacheStore(SESSION_ID);

    expect(db?.objectStoreNames.contains(ATTACHMENTS_STORE)).toBe(true);
    expect(db?.objectStoreNames.contains(ATTACHMENT_REFERENCES_STORE)).toBe(true);
    const transaction = db?.transaction([EVENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readonly');
    const eventRequest = transaction?.objectStore(EVENTS_STORE).get(seededEvent.cacheKey);
    const references = transaction?.objectStore(ATTACHMENT_REFERENCES_STORE);
    expect(references?.indexNames.contains(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)).toBe(true);
    expect(references?.indexNames.contains(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)).toBe(true);
    const preservedEvent = await new Promise<CachedEventRecord | undefined>((resolve, reject) => {
      if (!eventRequest) {
        resolve(undefined);
        return;
      }
      eventRequest.onsuccess = () => resolve(eventRequest.result as CachedEventRecord | undefined);
      eventRequest.onerror = () => reject(eventRequest.error);
    });
    expect(preservedEvent?.rawEvent.content).toEqual({
      body: 'preserved',
      msgtype: 'm.text',
    });
  });
});
