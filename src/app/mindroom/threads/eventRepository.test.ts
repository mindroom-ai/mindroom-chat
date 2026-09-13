import { RelationType, type MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  collectStateTargetEvents,
  loadRoomCachePersistenceState,
  loadThreadCachedPaginationSnapshot,
  loadThreadCachedSnapshot,
  loadRoomCachedBackStateSnapshot,
  loadRoomCachedPaginationSnapshot,
  loadLatestRoomCacheHydrationSnapshot,
  loadCachedThreadSnapshot,
  persistThreadCacheFromRoomEventsSnapshot,
  persistRoomEventCacheSnapshot,
  persistThreadEventCacheSnapshot,
  serializeRoomCacheEvents,
  serializeThreadCacheEvents,
} from './eventRepository';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';

describe('eventRepository cache serialization helpers', () => {
  it('adds replacement and redaction targets before cache serialization', () => {
    const targetEvent = makeEvent('$target', { ts: 100, content: { body: 'target' } });
    const editEvent = makeEvent('$edit', {
      associatedId: '$target',
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
      ts: 200,
    });
    const redactionEvent = makeEvent('$redaction', {
      associatedId: '$target',
      isRedaction: true,
      ts: 300,
    });
    const room = makeRoom({ liveEvents: [targetEvent] });

    expect(
      collectStateTargetEvents(room as never, [editEvent, redactionEvent] as never).map((event) =>
        event.getId()
      )
    ).toEqual(['$edit', '$target', '$redaction']);
  });

  it('serializes room cache payloads without thread-only activity', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const roomEvent = makeEvent('$room', { ts: 300, content: { body: 'room' } });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent, roomEvent] });

    expect(
      serializeRoomCacheEvents(room as never, [rootEvent, replyEvent, roomEvent] as never).map(
        (event) => event.event_id
      )
    ).toEqual(['$root', '$room']);
  });

  it('serializes thread cache payloads with the root event first when provided', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });

    expect(
      serializeThreadCacheEvents(room as never, [replyEvent] as never, rootEvent as never).map(
        (event) => event.event_id
      )
    ).toEqual(['$root', '$reply']);
  });
});

describe('eventRepository cache persistence snapshots', () => {
  it('persists thread cache snapshots with a derived complete reply count', () => {
    const rootEvent = makeEvent('$root', {
      ts: 100,
      isThreadRoot: true,
      content: { body: 'root' },
    });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });
    const writes: unknown[][] = [];

    const snapshot = persistThreadEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      threadId: '$root',
      events: [replyEvent] as never,
      rootEvent: rootEvent as never,
      beforeTokenForEarliest: null,
      tailLoaded: true,
      snapshotComplete: true,
      save: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshot.loadedReplyCount).toBe(1);
    expect(snapshot.expectedReplyCount).toBe(1);
    expect(snapshot.rawEvents.map((event) => event.event_id)).toEqual(['$root', '$reply']);
    expect(snapshot.rawRootEvent?.event_id).toBe('$root');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      '$root',
      [{ event_id: '$root' }, { event_id: '$reply' }],
      { event_id: '$root' },
      null,
      true,
      true,
      1,
      undefined,
    ]);
  });

  it('persists room cache snapshots without thread-only replies', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const roomEvent = makeEvent('$room', { ts: 300, content: { body: 'room' } });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent, roomEvent] });
    const writes: unknown[][] = [];

    const snapshot = persistRoomEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [rootEvent, replyEvent, roomEvent] as never,
      beforeTokenForEarliest: 'before-root',
      save: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshot.rawEvents.map((event) => event.event_id)).toEqual(['$root', '$room']);
    expect(snapshot.sourceEventCount).toBe(3);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      [{ event_id: '$root' }, { event_id: '$room' }],
      'before-root',
    ]);
  });

  it('persists thread cache snapshots derived from room events and updates open seeds', () => {
    const rootEvent = makeEvent('$root', {
      ts: 100,
      isThreadRoot: true,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });
    const writes: unknown[][] = [];
    const savedSeeds: MatrixEvent[][] = [];

    const snapshots = persistThreadCacheFromRoomEventsSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [replyEvent] as never,
      opts: {
        roomStartKnown: true,
        roomTailLoaded: true,
      },
      getSeedSnapshot: () => [],
      saveSeedSnapshot: (_room, _threadId, events) => {
        savedSeeds.push(events);
      },
      saveThreadSnapshot: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].threadId).toBe('$root');
    expect(snapshots[0].nextSeedEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(snapshots[0].roomDerivedSnapshot).toMatchObject({
      beforeTokenForEarliest: null,
      expectedReplyCount: 1,
      loadedReplyCount: 1,
      snapshotComplete: true,
      tailLoaded: true,
    });
    expect(snapshots[0].cacheSnapshot.expectedReplyCount).toBe(1);
    expect(savedSeeds[0].map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      '$root',
      [{ event_id: '$root' }, { event_id: '$reply' }],
      { event_id: '$root' },
      null,
      true,
      true,
      1,
      undefined,
    ]);
  });
});

describe('eventRepository cached thread snapshots', () => {
  it('loads and stitches cached thread pages from newest to oldest', async () => {
    const rootEvent = { event_id: '$root', origin_server_ts: 10 };
    const newerReply = { event_id: '$newer', origin_server_ts: 30 };
    const olderReply = { event_id: '$older', origin_server_ts: 20 };
    const loadedPageIndexes: number[] = [];

    const snapshot = await loadCachedThreadSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 2,
      maxPages: 5,
      loadLatest: async () => ({
        rootEvent,
        events: [newerReply],
        hasMoreBefore: true,
        beforeToken: 'before-newer',
        expectedReplyCount: 2,
        snapshotComplete: true,
        relationSnapshotComplete: true,
        tailLoaded: true,
      }),
      loadBefore: async (_sessionId, _roomId, _threadId, anchor) => {
        expect(anchor).toEqual({ eventId: '$newer', ts: 30 });
        return {
          events: [olderReply],
          hasMoreBefore: false,
          beforeToken: null,
        };
      },
      onPage: (_page, pageIndex) => {
        loadedPageIndexes.push(pageIndex);
      },
    });

    expect(snapshot.events.map((event) => event.event_id)).toEqual(['$older', '$newer']);
    expect(snapshot.rootEvent).toBe(rootEvent);
    expect(snapshot.beforeToken).toBeNull();
    expect(snapshot.hasMoreBefore).toBe(false);
    expect(snapshot.expectedReplyCount).toBe(2);
    expect(snapshot.snapshotComplete).toBe(true);
    expect(snapshot.relationSnapshotComplete).toBe(true);
    expect(snapshot.tailLoaded).toBe(true);
    expect(loadedPageIndexes).toEqual([1, 2]);
  });

  it('loads mapped cached thread snapshot events in normalized order', async () => {
    const snapshot = await loadThreadCachedSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 50,
      maxPages: 5,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        rootEvent: { event_id: '$root', origin_server_ts: 100 },
        events: [{ event_id: '$reply', origin_server_ts: 200 }],
        hasMoreBefore: false,
        beforeToken: null,
        expectedReplyCount: 1,
        snapshotComplete: true,
        relationSnapshotComplete: true,
        tailLoaded: true,
      }),
    });

    expect(snapshot?.events.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(snapshot?.cachedPage.beforeToken).toBeNull();
    expect(snapshot?.expectedReplyCount).toBe(1);
    expect(snapshot?.snapshotComplete).toBe(true);
    expect(snapshot?.relationSnapshotComplete).toBe(true);
    expect(snapshot?.tailLoaded).toBe(true);
  });

  it('loads mapped cached thread pagination events from the requested anchor', async () => {
    const earliestLoadedReply = makeEvent('$loaded', {
      ts: 300,
      threadRootId: '$root',
    });

    const snapshot = await loadThreadCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      earliestLoadedReply: earliestLoadedReply as never,
      limit: 50,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadBefore: async (_sessionId, _roomId, threadId, anchor, limit) => {
        expect(threadId).toBe('$root');
        expect(anchor).toEqual({ eventId: '$loaded', ts: 300 });
        expect(limit).toBe(50);
        return {
          rootEvent: { event_id: '$root', origin_server_ts: 100 },
          events: [{ event_id: '$older-reply', origin_server_ts: 200 }],
          hasMoreBefore: true,
          beforeToken: 'before-older-reply',
        };
      },
    });

    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$root', '$older-reply']);
    expect(snapshot.beforeToken).toBe('before-older-reply');
    expect(snapshot.hasMoreCachedBack).toBe(true);
  });
});

describe('eventRepository latest room cache hydration snapshots', () => {
  it('skips latest room cache hydration when the loaded timeline is already newer', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 300 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) => makeEvent(rawEvent.event_id ?? '$missing'),
      loadLatest: async () => ({
        events: [{ event_id: '$cached-old', origin_server_ts: 200 }],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('already-loaded');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.loadedRoomCount).toBe(1);
  });

  it('hydrates only cached room events that are not already loaded', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 100 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        events: [
          { event_id: '$loaded', origin_server_ts: 100 },
          { event_id: '$cached-new', origin_server_ts: 200 },
        ],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('hydrate');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$cached-new']);
    expect(snapshot.cachedPage.events).toHaveLength(2);
    expect(snapshot.loadedRoomCount).toBe(1);
  });

  it('does not hydrate cached local echo room events', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 100 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        events: [
          { event_id: '$loaded', origin_server_ts: 100 },
          { event_id: '~!room:example.org:txn-1', origin_server_ts: 200 },
        ],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('empty-after-filter');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.cachedPage.events).toHaveLength(2);
    expect(snapshot.loadedRoomCount).toBe(1);
  });
});

describe('eventRepository room cached-back state snapshots', () => {
  it('loads cached room back state from the earliest loaded room event anchor', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });
    let requestedAnchor: unknown;

    const snapshot = await loadRoomCachedBackStateSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      loadBefore: async (_sessionId, _roomId, anchor, limit) => {
        requestedAnchor = anchor;
        expect(limit).toBe(1);
        return {
          events: [{ event_id: '$cached-before', origin_server_ts: 200 }],
          hasMoreBefore: false,
        };
      },
      loadPaginationToken: async () => null,
    });

    expect(requestedAnchor).toEqual({ eventId: '$loaded', ts: 300 });
    expect(snapshot.hasCachedBack).toBe(true);
    expect(snapshot.cachedBeforeToken).toBeNull();
  });
});

describe('eventRepository room cached pagination snapshots', () => {
  it('does not query cached room events when cache metadata proves the room start', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });
    let beforeQueried = false;

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      limit: 50,
      mapEvent: (rawEvent) => makeEvent(rawEvent.event_id ?? '$missing'),
      loadPaginationToken: async () => null,
      loadBefore: async () => {
        beforeQueried = true;
        return { events: [], hasMoreBefore: false };
      },
    });

    expect(beforeQueried).toBe(false);
    expect(snapshot.status).toBe('start-known');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.hasMoreCachedBack).toBe(false);
  });

  it('loads cached room pagination events in timeline-prepend order', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      limit: 50,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadPaginationToken: async () => undefined,
      loadBefore: async (_sessionId, _roomId, anchor, limit) => {
        expect(anchor).toEqual({ eventId: '$loaded', ts: 300 });
        expect(limit).toBe(50);
        return {
          events: [
            { event_id: '$older', origin_server_ts: 100 },
            { event_id: '$newer', origin_server_ts: 200 },
          ],
          hasMoreBefore: true,
          beforeToken: 'before-older',
        };
      },
    });

    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$newer', '$older']);
    expect(snapshot.beforeToken).toBe('before-older');
    expect(snapshot.hasMoreCachedBack).toBe(true);
  });
});

describe('eventRepository room cache persistence state', () => {
  it('clears stale SDK backward tokens when cached metadata proves the room start', async () => {
    const state = await loadRoomCachePersistenceState({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEventId: '$earliest',
      currentBeforeToken: 'sdk-before',
      loadPaginationToken: async (sessionId, roomId, eventId) => {
        expect(sessionId).toBe('session');
        expect(roomId).toBe('!room:example.org');
        expect(eventId).toBe('$earliest');
        return null;
      },
    });

    expect(state.cachedBeforeToken).toBeNull();
    expect(state.beforeTokenForEarliest).toBeNull();
    expect(state.roomStartKnown).toBe(true);
    expect(state.shouldClearBackwardToken).toBe(true);
  });

  it('keeps the SDK backward token when cache metadata has no stronger coverage fact', async () => {
    const state = await loadRoomCachePersistenceState({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEventId: '$earliest',
      currentBeforeToken: 'sdk-before',
      loadPaginationToken: async () => undefined,
    });

    expect(state.cachedBeforeToken).toBeUndefined();
    expect(state.beforeTokenForEarliest).toBe('sdk-before');
    expect(state.roomStartKnown).toBe(false);
    expect(state.shouldClearBackwardToken).toBe(false);
  });
});
