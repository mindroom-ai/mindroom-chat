import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteCacheStoreDb, saveRoomEventsToCache, saveThreadEventsToCache } from '../index';
import { loadCachedThreadEventsInSpan } from '../cacheStoreThreadSpan';

const SESSION_ID = 'cache-thread-span-session';
const ROOM_ID = '!room:example.org';

const rawEvent = (eventId: string, ts: number) => ({
  event_id: eventId,
  room_id: ROOM_ID,
  origin_server_ts: ts,
  sender: '@alice:example.org',
  type: 'm.room.message',
  content: { body: eventId },
});

const ids = (events: { event_id?: string }[]) => events.map((event) => event.event_id).sort();

describe('loadCachedThreadEventsInSpan', () => {
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
  });

  it("reads every thread's saved events from one point up to another, and no room events", async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [rawEvent('$note', 15), rawEvent('$a', 1)]);
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$a',
      [rawEvent('$a1', 10), rawEvent('$a2', 20), rawEvent('$a3', 30)],
      rawEvent('$a', 1)
    );
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$b',
      [rawEvent('$b1', 25)],
      rawEvent('$b', 2)
    );

    const from = { eventId: '$a2', ts: 20 };
    expect(
      ids(await loadCachedThreadEventsInSpan(SESSION_ID, ROOM_ID, from, { eventId: '$a3', ts: 30 }))
    ).toEqual(['$a2', '$b1']);
    expect(ids(await loadCachedThreadEventsInSpan(SESSION_ID, ROOM_ID, from))).toEqual([
      '$a2',
      '$a3',
      '$b1',
    ]);
    // An empty span reads nothing.
    expect(await loadCachedThreadEventsInSpan(SESSION_ID, ROOM_ID, from, from)).toEqual([]);
  });

  it("leaves out another room's reply saved under this room's thread, and keeps one without a room", async () => {
    // An older build could save room A's replies under a thread scope of room B.
    const { room_id: _roomId, ...noRoom } = rawEvent('$no-room', 20);
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$a',
      [
        rawEvent('$a1', 10),
        { ...rawEvent('$elsewhere', 15), room_id: '!other:example.org' },
        noRoom,
      ],
      rawEvent('$a', 1)
    );

    expect(
      ids(await loadCachedThreadEventsInSpan(SESSION_ID, ROOM_ID, { eventId: '$a1', ts: 10 }))
    ).toEqual(['$a1', '$no-room']);
  });
});
