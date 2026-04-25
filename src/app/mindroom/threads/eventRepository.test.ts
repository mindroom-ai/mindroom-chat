import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  collectStateTargetEvents,
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
