import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../../../../matrix/protocol/backgroundJobsContract';
import { getCacheStoreDbName, openCacheStore, resetCacheStoreForTesting } from '../cacheStoreDb';
import { loadLatestCachedRoomEvents } from '../cacheStoreEvents';
import { readLedgerSnapshot } from '../cacheStoreLedger';
import {
  ATTACHMENTS_STORE,
  ATTACHMENT_REFERENCES_STORE,
  EMBEDDED_EVENTS_STORE,
  EVENTS_BY_ROOM_EVENT_INDEX,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_STORE,
  buildEventCacheKey,
  type CachedEventRecord,
} from '../cacheStoreSchema';

vi.mock('../cacheStoreLegacyWipe', () => ({
  performLegacyDbWipe: vi.fn(async () => undefined),
}));

const SESSION_ID = 'jobs-state-session';
const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_code:example.org';

const message = (eventId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:example.org',
  content: { msgtype: 'm.text', body: eventId },
});
const jobsState = (eventId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  origin_server_ts: ts,
  type: MINDROOM_BACKGROUND_JOBS_EVENT,
  sender: AGENT,
  state_key: AGENT,
  content: { jobs: [], total: 0 },
});

/** A cache as a v7 build left it, with the room's ledger: its rows' bytes and count. */
const seedVersionSevenCache = async (rawEvents: Partial<IEvent>[]) => {
  const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), 7);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'mxcUri' });
    db.createObjectStore(ATTACHMENT_REFERENCES_STORE, { keyPath: 'referenceKey' });
    db.createObjectStore(EMBEDDED_EVENTS_STORE);
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
    db.createObjectStore(THREAD_SUMMARIES_STORE, { keyPath: 'cacheKey' });
    const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    events.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId']);
    events.createIndex(EVENTS_BY_ROOM_EVENT_INDEX, ['roomId', 'eventId']);
    rawEvents.forEach((rawEvent) =>
      events.put({
        cacheKey: buildEventCacheKey(ROOM_ID, '', rawEvent.event_id!),
        roomId: ROOM_ID,
        scope: '',
        eventId: rawEvent.event_id!,
        ts: rawEvent.origin_server_ts!,
        rawEvent,
        approxBytes: 10,
      } satisfies CachedEventRecord)
    );
    db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' }).put({
      roomId: ROOM_ID,
      approxBytes: 10 * rawEvents.length,
      eventCount: rawEvents.length,
      lastActivityTs: 1,
      pinned: true,
    });
  };
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
});
afterEach(() => resetCacheStoreForTesting());

it('deletes the jobs state an earlier version saved, which filled whole pages of the room', async () => {
  await seedVersionSevenCache([
    message('$older', 100),
    ...Array.from({ length: 250 }, (_, index) => jobsState(`$jobs-${index}`, 200 + index)),
    message('$newer', 1000),
  ]);

  const db = await openCacheStore(SESSION_ID);

  const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 200);
  expect(page.events.map((event) => event.event_id)).toEqual(['$older', '$newer']);
  expect(await readLedgerSnapshot(db!)).toEqual([
    { roomId: ROOM_ID, approxBytes: 20, eventCount: 2, lastActivityTs: 1, pinned: true },
  ]);
  // The upgrade finds the rows by an index it drops again.
  expect([...db!.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).indexNames].sort()).toEqual([
    EVENTS_BY_ROOM_EVENT_INDEX,
    EVENTS_BY_SCOPE_TS_INDEX,
  ]);
});
