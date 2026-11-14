import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, expect, it } from 'vitest';
import { resetCacheStoreForTesting } from '.';
import { resetCacheHealthForTesting } from '../cacheHealth';
import {
  loadCachedThreadSnapshot,
  loadRoomCachedBackStateSnapshot,
  loadRoomCachedPaginationSnapshot,
} from '../eventRepository';
import {
  loadCachedRoomEventsBefore,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from './cacheStoreEvents';

// The cache orders events by sent time, then event ID; the server's order inside one millisecond
// is unknown to it. The room's pager, which drops the events it holds, asks a page before an event
// for the events of that event's millisecond that sort after it too: some are older on the
// server, and no other page holds them. Every other reader keeps the strict bound.

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

it("holds, when asked, an older event of the earliest event's millisecond whose ID sorts after it", async () => {
  // Server order, oldest first: $older, then $zzz and $aaa in the same millisecond.
  await saveRoomEventsToCache('session', ROOM, [
    message('$older', 900),
    message('$zzz', 1000),
    message('$aaa', 1000),
    message('$newer', 1100),
    // Another room's event saved under this room, as an earlier version could: never this room's.
    { ...message('$zzz-elsewhere', 1000), room_id: '!elsewhere:test' },
  ]);
  const before = { eventId: '$aaa', ts: 1000 };

  const asked = await loadCachedRoomEventsBefore('session', ROOM, before, 10, {
    withBeforeMillisecond: true,
  });
  const strict = await loadCachedRoomEventsBefore('session', ROOM, before, 10);

  expect(ids(asked.events)).toEqual(['$older', '$zzz']);
  expect(ids(strict.events)).toEqual(['$older']);
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
  const page = await loadCachedRoomEventsBefore('session', ROOM, { eventId: '$m2', ts: 1000 }, 2, {
    withBeforeMillisecond: true,
  });

  expect(ids(page.events)).toEqual(['$a3', '$m1', '$m3', '$m4']);
  expect(page.hasMoreBefore).toBe(true);
});

it('ends the room pager on a page of only held events, with nothing older cached', async () => {
  // The room holds both events of the millisecond; $aaa sorts first, so it is the anchor.
  await saveRoomEventsToCache('session', ROOM, [message('$zzz', 1000), message('$aaa', 1000)]);

  const snapshot = await loadRoomCachedPaginationSnapshot({
    sessionId: 'session',
    roomId: ROOM,
    earliestLoadedEvent: new MatrixEvent(message('$aaa', 1000)),
    limit: 10,
    mapEvent: (raw) => new MatrixEvent(raw),
  });

  // The pager adds none of these, so it pages from the server (roomPaginationCommandController,
  // "pages from the server when a cached page holds only events the room has loaded").
  expect(snapshot.events.map((event) => event.getId())).toEqual(['$zzz']);
  expect(snapshot.hasMoreCachedBack).toBe(false);
});

it('finds nothing older for the back state when only held events share the millisecond', async () => {
  await saveRoomEventsToCache('session', ROOM, [message('$zzz', 1000), message('$aaa', 1000)]);

  const state = await loadRoomCachedBackStateSnapshot({
    sessionId: 'session',
    roomId: ROOM,
    earliestLoadedEvent: new MatrixEvent(message('$aaa', 1000)),
  });

  expect(state.hasCachedBack).toBe(false);
});

it('reads a thread whose replies share a millisecond once each', async () => {
  await saveThreadEventsToCache('session', ROOM, '$root', [
    message('$r1', 1000, '$root'),
    message('$r2', 1000, '$root'),
    message('$r3', 1000, '$root'),
    message('$r4', 1000, '$root'),
  ]);

  const snapshot = await loadCachedThreadSnapshot({
    sessionId: 'session',
    roomId: ROOM,
    threadId: '$root',
    limit: 2,
    maxPages: 5,
  });

  expect(ids(snapshot?.events ?? [])).toEqual(['$r1', '$r2', '$r3', '$r4']);
});
