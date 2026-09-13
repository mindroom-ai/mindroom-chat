import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getEditedEvent, getLatestEdit, roomHaveUnread } from './room';

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

const makeThreadReplyEvent = (eventId: string, ts: number, sender = '@bob:example.org') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: '$thread-root',
        'm.in_reply_to': {
          event_id: '$thread-root',
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
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

describe('roomHaveUnread', () => {
  it('ignores hidden thread-only activity when no visible main-timeline unread remains', () => {
    const threadReply = makeThreadReplyEvent('$thread-reply', 1000);
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => null),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [threadReply],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(false);
  });

  it('keeps the unread fallback when the loaded main-timeline slice still contains visible activity', () => {
    const mainEvent = makeMessageEvent('$main', 1000, '@bob:example.org');
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => '$older'),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [mainEvent],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(true);
  });
});
