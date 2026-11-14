import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it } from 'vitest';
import { resetCacheStoreForTesting } from '.';
import { resetCacheHealthForTesting } from '../cacheHealth';
import {
  loadCachedRoomEventsBefore,
  loadCachedThreadEventsBefore,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from './cacheStoreEvents';

// The cache orders events by sent time, then event ID; the server's order inside one millisecond
// is unknown to it. A page before an event therefore also holds the events of that event's
// millisecond that sort after it: some are older on the server, and no other page holds them.

const ROOM = '!room:test';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});

const message = (eventId: string, ts: number, threadId?: string) => ({
  event_id: eventId,
  room_id: ROOM,
  type: 'm.room.message',
  sender: '@alice:test',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: eventId,
    ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
  },
});

const ids = (events: { event_id: string }[]) => events.map((event) => event.event_id);

it("holds an older event of the earliest event's millisecond whose ID sorts after it", async () => {
  // Server order, oldest first: $older, then $zzz and $aaa in the same millisecond.
  await saveRoomEventsToCache('session', ROOM, [
    message('$older', 900),
    message('$zzz', 1000),
    message('$aaa', 1000),
    message('$newer', 1100),
    // Another room's event saved under this room, as an earlier version could: never this room's.
    { ...message('$zzz-elsewhere', 1000), room_id: '!elsewhere:test' },
  ]);

  const page = await loadCachedRoomEventsBefore('session', ROOM, { eventId: '$aaa', ts: 1000 }, 10);

  expect(ids(page.events)).toEqual(['$older', '$zzz']);
});

it('does the same for a thread', async () => {
  await saveThreadEventsToCache('session', ROOM, '$root', [
    message('$older', 900, '$root'),
    message('$zzz', 1000, '$root'),
    message('$aaa', 1000, '$root'),
  ]);

  const page = await loadCachedThreadEventsBefore(
    'session',
    ROOM,
    '$root',
    { eventId: '$aaa', ts: 1000 },
    10
  );

  expect(ids(page.events)).toEqual(['$older', '$zzz']);
});

it("leaves out no event of the earliest event's millisecond when the limit cuts the page", async () => {
  await saveRoomEventsToCache('session', ROOM, [
    message('$a1', 700),
    message('$a2', 800),
    message('$a3', 900),
    message('$m1', 1000),
    message('$m2', 1000),
    message('$m3', 1000),
    message('$m4', 1000),
  ]);

  // The limit counts the events that sort before the earliest event; those of its millisecond
  // that sort after it come on top.
  const page = await loadCachedRoomEventsBefore('session', ROOM, { eventId: '$m2', ts: 1000 }, 2);

  expect(ids(page.events)).toEqual(['$a3', '$m1', '$m3', '$m4']);
  expect(page.hasMoreBefore).toBe(true);
});
