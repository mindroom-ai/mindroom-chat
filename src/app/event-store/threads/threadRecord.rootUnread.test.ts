import { MatrixEvent, ReceiptType } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it } from 'vitest';
import { buildThreadRecord } from './threadRecord';

// A root someone else posted counts toward the room's unread badge until the reader reads it, so
// the unread thread filter finds its card too, also before anyone replies in it.
const ME = '@me:example.org';

const root = (sender: string, ts: number) =>
  new MatrixEvent({
    content: { body: 'Welcome to the room', msgtype: 'm.text' },
    event_id: '$root',
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeRoom = (rootEvent: MatrixEvent, receiptTs?: number): Room =>
  ({
    roomId: '!room:example.org',
    getThread: () => null,
    findEventById: (eventId: string) => (eventId === rootEvent.getId() ? rootEvent : undefined),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    getMember: () => null,
    getLastUnthreadedReceiptFor: () => undefined,
    getReadReceiptForUserId: (_userId: string, _ignore: boolean, type: ReceiptType) =>
      receiptTs !== undefined && type === ReceiptType.Read
        ? { eventId: '$older', data: { ts: receiptTs, thread_id: 'main' } }
        : null,
  } as unknown as Room);

const isUnread = (rootEvent: MatrixEvent, receiptTs?: number) =>
  buildThreadRecord({
    room: makeRoom(rootEvent, receiptTs),
    threadRootId: '$root',
    threadRootEvent: rootEvent,
    currentUserId: ME,
  }).status.isUnread;

describe('buildThreadRecord unread root', () => {
  it('marks a thread unread while its root by someone else is unread, before any reply', () => {
    expect(isUnread(root('@router:example.org', 2000))).toBe(true);
    expect(isUnread(root('@router:example.org', 2000), 1000)).toBe(true);
  });

  it('leaves it read once the reader read past the root, or wrote it', () => {
    expect(isUnread(root('@router:example.org', 2000), 3000)).toBe(false);
    expect(isUnread(root(ME, 2000))).toBe(false);
  });
});
