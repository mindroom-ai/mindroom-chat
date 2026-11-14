import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Direction, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCacheStoreForTesting } from '.';
import { resetCacheHealthForTesting } from '../cacheHealth';
import {
  loadCachedThreadSnapshot,
  loadRoomCachedBackStateSnapshot,
  loadRoomCachedPaginationSnapshot,
  loadThreadCachedPaginationSnapshot,
} from '../eventRepository';
import {
  loadCachedRoomEventsBefore,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from './cacheStoreEvents';
import { loadCachedThreadEventsInSpan } from './cacheStoreThreadSpan';
import { findEarliestLoadedThreadReplyByCacheOrder } from '../../timeline/threadPaginationUtils';
import { mergeThreadRenderEvents } from '../../threads/threadRenderUtils';
import { prependCachedRoomTimeline } from '../../sdk/roomTimelineSdk';

// The cache orders events by sent time, then event ID; the server's order inside one millisecond
// is unknown to it. The room's and the thread's pagers, which drop the events they hold, ask a
// page before an event for the events of that event's millisecond that sort after it too: some
// are older on the server, and no other page holds them. Every other reader keeps the strict
// bound.

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

it('gives the room pager only the held events of the millisecond when nothing older is cached', async () => {
  // The room holds both events of the millisecond; $aaa sorts first, so it is the anchor.
  await saveRoomEventsToCache('session', ROOM, [message('$zzz', 1000), message('$aaa', 1000)]);

  const snapshot = await loadRoomCachedPaginationSnapshot({
    sessionId: 'session',
    roomId: ROOM,
    earliestLoadedEvent: new MatrixEvent(message('$aaa', 1000)),
    limit: 10,
    mapEvent: (raw) => new MatrixEvent(raw),
  });

  // The pager adds none of these and pages from the server: roomPaginationCommandController's test
  // "pages from the server when a cached page holds only events the room has loaded".
  expect(snapshot.events.map((event) => event.getId())).toEqual(['$zzz']);
  expect(snapshot.hasMoreCachedBack).toBe(false);
});

it.each([null, 'cached-token'])(
  "keeps the room's back cursor when only events of the millisecond are new (saved token %s)",
  async (token) => {
    // $zzz was saved as the earliest of its page with a backward token; nothing older than the
    // loaded $aaa's millisecond is cached.
    await saveRoomEventsToCache('session', ROOM, [message('$zzz', 1000)], token);
    await saveRoomEventsToCache('session', ROOM, [message('$aaa', 1000)]);
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:test' });
    const room = new Room(ROOM, mx, '@alice:test', { timelineSupport: true });
    const loaded = new MatrixEvent(message('$aaa', 1000));
    await room.addLiveEvents([loaded], { addToState: false });
    const timeline = room.getLiveTimeline();
    timeline.setPaginationToken('server-cursor', Direction.Backward);

    // Before #342 the page before $aaa was empty, a miss: the server paged from its cursor.
    const strict = await loadCachedRoomEventsBefore(
      'session',
      ROOM,
      { eventId: '$aaa', ts: 1000 },
      10
    );
    expect(strict.events).toEqual([]);

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: ROOM,
      earliestLoadedEvent: loaded,
      limit: 10,
      mapEvent: (raw) => new MatrixEvent(raw),
    });
    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$zzz']);
    await prependCachedRoomTimeline({
      mx,
      room,
      events: snapshot.events,
      firstTimeline: timeline,
      beforeToken: snapshot.beforeToken,
      showThreadRepliesInRoom: false,
    });

    // $zzz's token says what lies before $zzz, not before $aaa: events between them that the cache
    // lacks would be skipped, or the room's history would seem to end.
    expect(timeline.getPaginationToken(Direction.Backward)).toBe('server-cursor');
  }
);

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

describe('thread replies of one millisecond', () => {
  // Server order, oldest first: $older, then $zzz and $aaa in one millisecond, then $newer. The
  // cache sorts $aaa before $zzz.
  const replies = [
    message('$older', 900, '$root'),
    message('$zzz', 1000, '$root'),
    message('$aaa', 1000, '$root'),
    message('$newer', 1100, '$root'),
  ];
  const aaa = { eventId: '$aaa', ts: 1000 };

  beforeEach(async () => {
    await saveThreadEventsToCache('session', ROOM, '$root', replies);
  });

  it("holds, when asked, an older reply of the earliest reply's millisecond whose ID sorts after it", async () => {
    const asked = await loadCachedThreadEventsBefore('session', ROOM, '$root', aaa, 10, {
      withBeforeMillisecond: true,
    });
    const strict = await loadCachedThreadEventsBefore('session', ROOM, '$root', aaa, 10);

    expect(ids(asked.events)).toEqual(['$older', '$zzz']);
    expect(ids(strict.events)).toEqual(['$older']);
  });

  const paginate = (heldEventIds: string[], threadId = '$root') =>
    loadThreadCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: ROOM,
      threadId,
      earliestLoadedReply: new MatrixEvent(message('$aaa', 1000, threadId)),
      heldEventIds: new Set(heldEventIds),
      limit: 10,
      mapEvent: (raw) => new MatrixEvent(raw),
    });

  it('gives the thread pager the reply of the millisecond it does not hold', async () => {
    // The thread came from the server with $aaa and $newer; $zzz is on no strict page before $aaa.
    const snapshot = await paginate(['$aaa', '$newer']);

    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$older', '$zzz']);
  });

  it('calls a page of only held replies a miss', async () => {
    // Only the held $zzz shares the millisecond, and the thread holds $older too.
    const snapshot = await paginate(['$older', '$zzz', '$aaa', '$newer']);

    expect(snapshot.status).toBe('cache-miss');
    expect(snapshot.events).toEqual([]);
  });

  it.each([null, 'cached-token'])(
    "keeps the server's cursor when only replies of the millisecond are new (saved token %s)",
    async (token) => {
      // A separate thread: $zzz was saved as the earliest of its page, with a backward token; no
      // reply before $aaa's millisecond is cached, so the page reaches no further back than $aaa.
      await saveThreadEventsToCache(
        'session',
        ROOM,
        '$other',
        [message('$zzz', 1000, '$other')],
        undefined,
        token
      );
      await saveThreadEventsToCache('session', ROOM, '$other', [message('$aaa', 1000, '$other')]);

      const snapshot = await paginate(['$aaa'], '$other');

      expect(snapshot.status).toBe('cache-hit');
      expect(snapshot.events.map((event) => event.getId())).toEqual(['$zzz']);
      // $zzz's token says what lies before $zzz, not before $aaa: replies between them that the
      // cache lacks would be lost behind it.
      expect(snapshot.cachedPage.beforeToken).toBeUndefined();
    }
  );

  // The thread's snapshot pages from its own earliest cached reply, so its pages run on in cache
  // order and no reply of a millisecond falls between them, whatever the page size.
  it.each([1, 2, 3])('reads every reply in the thread snapshot with pages of %i', async (limit) => {
    const snapshot = await loadCachedThreadSnapshot({
      sessionId: 'session',
      roomId: ROOM,
      threadId: '$root',
      limit,
      maxPages: 10,
    });

    expect(ids(snapshot?.events ?? [])).toEqual(['$older', '$aaa', '$zzz', '$newer']);
  });

  // A span is exact in cache order: two spans that meet at a room event split a millisecond's
  // replies between them, and a span whose start lies after its end (a room page of only events of
  // the millisecond) holds nothing. Classic reads such meeting spans once the newer one was read.
  it('splits the replies of a millisecond between two spans that meet at a room event', async () => {
    const roomEvent = { eventId: '$raaa', ts: 1000 };

    const older = await loadCachedThreadEventsInSpan(
      'session',
      ROOM,
      { eventId: '$r800', ts: 800 },
      roomEvent
    );
    const newer = await loadCachedThreadEventsInSpan('session', ROOM, roomEvent);
    const inverted = await loadCachedThreadEventsInSpan('session', ROOM, roomEvent, {
      eventId: '$r900',
      ts: 900,
    });

    expect(older.map((event) => event.event_id)).toEqual(['$older', '$aaa']);
    expect(newer.map((event) => event.event_id)).toEqual(['$zzz', '$newer']);
    expect(inverted).toEqual([]);
  });
});

it("anchors the thread pager on the store's earliest reply when IDs of one millisecond differ in case", async () => {
  await saveThreadEventsToCache('session', ROOM, '$root', [
    message('$a', 1000, '$root'),
    message('$B', 1000, '$root'),
  ]);

  const stored = await loadLatestCachedThreadEvents('session', ROOM, '$root', 10);
  const earliest = findEarliestLoadedThreadReplyByCacheOrder(
    stored.events.map((raw) => new MatrixEvent(raw)),
    '$root'
  );

  expect(ids(stored.events)).toEqual(['$B', '$a']);
  expect(earliest?.getId()).toBe('$B');
});

describe('a pair of one millisecond the client holds in server order', () => {
  // The server sent $a, then $B; cache order puts $B first. The cached page comes back in cache
  // order; merging it with the events the client holds keeps theirs, in their order, once each.

  it('stays in place when the room prepends a cached page that holds it', async () => {
    await saveRoomEventsToCache('session', ROOM, [
      message('$older', 900),
      message('$a', 1000),
      message('$B', 1000),
    ]);
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:test' });
    const room = new Room(ROOM, mx, '@alice:test', { timelineSupport: true });
    const held = [new MatrixEvent(message('$a', 1000)), new MatrixEvent(message('$B', 1000))];
    await room.addLiveEvents(held, { addToState: false });
    const timeline = room.getLiveTimeline();

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: ROOM,
      earliestLoadedEvent: held[0],
      limit: 10,
      mapEvent: (raw) => new MatrixEvent(raw),
    });
    await prependCachedRoomTimeline({
      mx,
      room,
      events: snapshot.events,
      firstTimeline: timeline,
      beforeToken: snapshot.beforeToken,
      showThreadRepliesInRoom: false,
    });

    expect(snapshot.events.map((event) => event.getId())).toEqual(['$B', '$older']);
    expect(timeline.getEvents().map((event) => event.getId())).toEqual(['$older', '$a', '$B']);
  });

  it('stays in place when the thread merges a cached page that holds it', async () => {
    await saveThreadEventsToCache('session', ROOM, '$root', [
      message('$a', 1000, '$root'),
      message('$B', 1000, '$root'),
    ]);
    const held = [
      new MatrixEvent(message('$a', 1000, '$root')),
      new MatrixEvent(message('$B', 1000, '$root')),
    ];

    const cached = await loadLatestCachedThreadEvents('session', ROOM, '$root', 10);
    const merged = mergeThreadRenderEvents(
      held,
      cached.events.map((raw) => new MatrixEvent(raw))
    );

    expect(ids(cached.events)).toEqual(['$B', '$a']);
    expect(merged.map((event) => event.getId())).toEqual(['$a', '$B']);
    expect(merged).toEqual(held);
  });
});
