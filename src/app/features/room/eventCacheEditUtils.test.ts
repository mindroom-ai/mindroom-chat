import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { applyCachedReplaceRelations, serializeEventsForCache } from './eventCacheEditUtils';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org',
  body = eventId
) =>
  new MatrixEvent({
    content: {
      body: `* ${body}`,
      'm.new_content': {
        body,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

describe('applyCachedReplaceRelations', () => {
  it('applies the latest cached replacement event to the target message', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'older');
    const newerEdit = makeEditEvent('$edit-2', 3000, '$target', '@alice:example.org', 'newer');

    applyCachedReplaceRelations([targetEvent, olderEdit, newerEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$edit-2');
  });

  it('does not override a newer replacement with an older cached edit', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 4000, '$target');
    const olderCachedEdit = makeEditEvent('$cached', 3000, '$target');

    targetEvent.makeReplaced(sdkReplacement);
    applyCachedReplaceRelations([targetEvent, olderCachedEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$sdk');
  });
});

describe('serializeEventsForCache', () => {
  it('stores the latest replacement under unsigned relations for the target event', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'first');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target', '@alice:example.org', 'second');

    const serializedTarget = serializeEventsForCache([targetEvent, firstEdit, secondEdit]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$edit-2',
      content: {
        'm.new_content': {
          body: 'second',
        },
      },
    });
  });

  it('persists an existing sdk replacement even when the edit event is not in the batch', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 3000, '$target', '@alice:example.org', 'latest');

    targetEvent.makeReplaced(sdkReplacement);

    const serializedTarget = serializeEventsForCache([targetEvent]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$sdk',
      content: {
        'm.new_content': {
          body: 'latest',
        },
      },
    });
  });
});
