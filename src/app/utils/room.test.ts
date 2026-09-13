import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getEditedEvent, getLatestEdit } from './room';

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
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: `${eventId}`,
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

describe('room edit helpers', () => {
  it('prefers SDK replacement event over relation fallback edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk-latest', 3000, '$target');
    const staleRelationEdit = makeEditEvent('$stale', 2000, '$target');

    targetEvent.makeReplaced(sdkReplacement);

    const getChildEventsForEvent = vi.fn().mockReturnValue({
      getRelations: () => [staleRelationEdit],
    });
    const timelineSet = {
      relations: {
        getChildEventsForEvent,
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(sdkReplacement);
    expect(getChildEventsForEvent).not.toHaveBeenCalled();
  });

  it('falls back to relation edits when SDK replacement is unavailable', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$older', 2000, '$target');
    const newerEdit = makeEditEvent('$newer', 3000, '$target');
    const otherSenderEdit = makeEditEvent('$other', 4000, '$target', '@bob:example.org');

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [olderEdit, otherSenderEdit, newerEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    expect(editedEvent).toBe(newerEdit);
  });

  it('prefers later relations when edits share the same timestamp', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target');

    const latest = getLatestEdit(targetEvent, [firstEdit, secondEdit]);
    expect(latest).toBe(secondEdit);
  });
});
