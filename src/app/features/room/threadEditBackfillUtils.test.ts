import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { shouldFetchMissingThreadEdit } from './threadEditBackfillUtils';

const makeMessageEvent = (eventId: string, type = 'm.room.message') =>
  new MatrixEvent({
    content: {
      body: 'hello',
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

describe('shouldFetchMissingThreadEdit', () => {
  it('allows a new MatrixEvent instance for the same event id to retry backfill', () => {
    const attemptedEvents = new WeakSet<MatrixEvent>();
    const firstInstance = makeMessageEvent('$target');
    const secondInstance = makeMessageEvent('$target');

    attemptedEvents.add(firstInstance);

    expect(shouldFetchMissingThreadEdit(firstInstance, attemptedEvents)).toBe(false);
    expect(shouldFetchMissingThreadEdit(secondInstance, attemptedEvents)).toBe(true);
  });

  it('ignores already replaced or unsupported events', () => {
    const attemptedEvents = new WeakSet<MatrixEvent>();
    const targetEvent = makeMessageEvent('$target');
    const editEvent = new MatrixEvent({
      content: {
        body: '* edited',
        'm.new_content': {
          body: 'edited',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit',
      origin_server_ts: 2,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    targetEvent.makeReplaced(editEvent);

    expect(shouldFetchMissingThreadEdit(targetEvent, attemptedEvents)).toBe(false);
    expect(shouldFetchMissingThreadEdit(makeMessageEvent('$reaction', 'm.reaction'), attemptedEvents)).toBe(
      false
    );
  });
});
