import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCachedEventAcrossRoomScopes, loadRoomOfflineEventBatch } from '../cacheStoreEvents';
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

const seedVersionThreeDatabase = async (version = 3): Promise<CachedEventRecord> => {
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
  const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), version);
  request.onupgradeneeded = () => {
    const db = request.result;
    const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    events.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId']);
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
    db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
    const summaries = db.createObjectStore(THREAD_SUMMARIES_STORE, { keyPath: 'cacheKey' });
    summaries.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId');
    if (version >= 4) {
      db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'mxcUri' });
      const refs = db.createObjectStore(ATTACHMENT_REFERENCES_STORE, { keyPath: 'referenceKey' });
      refs.createIndex(ATTACHMENT_REFERENCES_BY_ROOM_INDEX, 'roomId');
      refs.createIndex(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX, 'mxcUri');
    }
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

  it.each([3, 4, 5])('adds indexes without replacing version-%s events', async (version) => {
    const seededEvent = await seedVersionThreeDatabase(version);

    const db = await openCacheStore(SESSION_ID);

    expect(db?.objectStoreNames.contains(ATTACHMENTS_STORE)).toBe(true);
    expect(
      db?.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).indexNames.contains('by_room_event')
    ).toBe(true);
    expect(db?.objectStoreNames.contains(ATTACHMENT_REFERENCES_STORE)).toBe(true);
    const transaction = db?.transaction([EVENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readonly');
    const eventRequest = transaction?.objectStore(EVENTS_STORE).get(seededEvent.cacheKey);
    const references = transaction?.objectStore(ATTACHMENT_REFERENCES_STORE);
    expect(db?.version).toBe(6);
    expect(
      db
        ?.transaction(ATTACHMENTS_STORE)
        .objectStore(ATTACHMENTS_STORE)
        .indexNames.contains('by_access_bytes')
    ).toBe(true);
    expect(references?.indexNames.contains('by_owner')).toBe(true);
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

it('indexed target lookup merges duplicate tombstones and finds metadata-only roots', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  const row = await seedVersionThreeDatabase(4);
  const db = (await openCacheStore(SESSION_ID))!;
  const tx = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
  const tombstone = {
    ...row.rawEvent,
    content: {},
    unsigned: {
      redacted_because: { type: 'm.room.redaction', event_id: '$redaction', content: {} },
    },
  };
  tx.objectStore(EVENTS_STORE).put({
    ...row,
    cacheKey: 'duplicate',
    scope: '$thread',
    rawEvent: tombstone,
  });
  tx.objectStore(META_STORE).put({
    metaKey: row.roomId + '|$root',
    roomId: row.roomId,
    scope: '$root',
    rootEvent: { ...row.rawEvent, event_id: '$root' },
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  expect(
    (await loadCachedEventAcrossRoomScopes(SESSION_ID, row.roomId, '$event'))?.unsigned
      ?.redacted_because
  ).toBeDefined();
  expect((await loadCachedEventAcrossRoomScopes(SESSION_ID, row.roomId, '$root'))?.event_id).toBe(
    '$root'
  );
  const batch = await loadRoomOfflineEventBatch(SESSION_ID, row.roomId, undefined, 1);
  expect(batch.events).toHaveLength(1);
  expect(batch.events[0].unsigned?.redacted_because).toBeDefined();
  expect(
    await loadCachedEventAcrossRoomScopes(SESSION_ID, '!other:test', '$event')
  ).toBeUndefined();
});
