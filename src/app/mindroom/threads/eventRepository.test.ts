import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  collectStateTargetEvents,
  loadCachedThreadSnapshot,
  serializeRoomCacheEvents,
  serializeThreadCacheEvents,
} from './eventRepository';
import { makeEvent, makeRoom } from '../../features/room/RoomTimeline.test.shared';

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
});
