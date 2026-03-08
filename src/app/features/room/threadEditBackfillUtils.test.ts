import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  markThreadEditBackfillAttempted,
  shouldFetchThreadEditBackfill,
} from './threadEditBackfillUtils';

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

describe('shouldFetchThreadEditBackfill', () => {
  it('allows retry after the thread tail settles and for new MatrixEvent instances', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
    const firstInstance = makeMessageEvent('$target');
    const secondInstance = makeMessageEvent('$target');

    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, false)).toBe(true);
    markThreadEditBackfillAttempted(firstInstance, attemptedEvents, false);

    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, false)).toBe(false);
    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, true)).toBe(true);
    expect(shouldFetchThreadEditBackfill(secondInstance, attemptedEvents, false)).toBe(true);

    markThreadEditBackfillAttempted(firstInstance, attemptedEvents, true);
    expect(shouldFetchThreadEditBackfill(firstInstance, attemptedEvents, true)).toBe(false);
  });

  it('skips replaced events before tail load but revalidates them after tail load', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();
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

    expect(shouldFetchThreadEditBackfill(targetEvent, attemptedEvents, false)).toBe(false);
    expect(shouldFetchThreadEditBackfill(targetEvent, attemptedEvents, true)).toBe(true);
  });

  it('ignores unsupported event types', () => {
    const attemptedEvents = new WeakMap<MatrixEvent, number>();

    expect(
      shouldFetchThreadEditBackfill(makeMessageEvent('$reaction', 'm.reaction'), attemptedEvents, true)
    ).toBe(false);
  });
});
