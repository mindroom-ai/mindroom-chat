import {
  MatrixEvent,
  ReceiptType,
  RelationType,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { getThreadRootReadAction, roomHaveUnread } from '../room';
import { isMainTimelineMessageUnread } from '../mainTimelineRead';
import { clearSeenThreadRoots, rememberSeenThreadRoot } from '../seenThreadRoots';

// Opening a thread reads its root, which lives in the main timeline. The server reads the whole
// main timeline on any main receipt (measured on Tuwunel: a receipt on the oldest of three unread
// roots clears all three), so the receipt goes out only when nothing else there is unread; until
// then the root counts as read on this device only.
const ME = '@me:example.org';
const ALICE = '@alice:example.org';

const message = (eventId: string, ts: number, sender: string, threadRootId?: string) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...(threadRootId
        ? {
            'm.relates_to': {
              rel_type: RelationType.Thread,
              event_id: threadRootId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: threadRootId },
            },
          }
        : {}),
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeRoom = ({
  main,
  receiptTs,
  olderHistory = false,
  mainCount = 0,
}: {
  main: MatrixEvent[];
  /** When the reader sent their main-timeline receipt, on the first event of `main`. */
  receiptTs?: number;
  /** Older events the client has not loaded. */
  olderHistory?: boolean;
  /** The server's count of unread main-timeline notifications. */
  mainCount?: number;
}): Room =>
  ({
    roomId: '!room:example.org',
    getLiveTimeline: () => ({
      getEvents: () => main,
      getPaginationToken: () => (olderHistory ? 'older' : null),
      getNeighbouringTimeline: () => null,
    }),
    findEventById: (eventId: string) => main.find((event) => event.getId() === eventId),
    getEventReadUpTo: () => (receiptTs === undefined ? null : main[0]?.getId() ?? null),
    getReadReceiptForUserId: (_userId: string, _ignore: boolean, type: ReceiptType) =>
      receiptTs !== undefined && type === ReceiptType.Read
        ? { eventId: main[0]?.getId(), data: { ts: receiptTs, thread_id: 'main' } }
        : null,
    getLastUnthreadedReceiptFor: () => undefined,
    getThread: () => null,
    getRoomUnreadNotificationCount: () => mainCount,
  } as unknown as Room);

const client = (notifies = true) =>
  ({
    getUserId: () => ME,
    getPushActionsForEvent: () => ({ notify: notifies, tweaks: {} }),
  } as unknown as MatrixClient);

afterEach(() => clearSeenThreadRoots(ME));

describe('reading a thread root', () => {
  // The room: an older message the reader read, then three roots by Alice.
  const older = message('$older', 1000, ALICE);
  const root1 = message('$root1', 3000, ALICE);
  const root2 = message('$root2', 4000, ALICE);
  const root3 = message('$root3', 5000, ALICE);

  it('sends the receipt when the root is the only unread message in the main timeline', () => {
    const room = makeRoom({ main: [older, root1], receiptTs: 2000 });
    expect(getThreadRootReadAction(client(), room, root1)).toBe('receipt');
  });

  it('keeps the receipt back while an older root is unread', () => {
    const room = makeRoom({ main: [older, root1, root2, root3], receiptTs: 2000 });
    expect(getThreadRootReadAction(client(), room, root3)).toBe('seen');
  });

  it('keeps the receipt back while a newer root is unread, which it would read too', () => {
    const room = makeRoom({ main: [older, root1, root2, root3], receiptTs: 2000 });
    expect(getThreadRootReadAction(client(), room, root1)).toBe('seen');
  });

  it('does nothing for a root the reader has read', () => {
    const room = makeRoom({ main: [older, root1], receiptTs: 3500 });
    expect(getThreadRootReadAction(client(), room, root1)).toBeUndefined();
    const own = message('$own', 3000, ME);
    expect(getThreadRootReadAction(client(), makeRoom({ main: [older, own] }), own)).toBe(
      undefined
    );
  });

  it('counts the roots opened before as read, so the last one opened sends the receipt', () => {
    const room = makeRoom({ main: [older, root1, root2, root3], receiptTs: 2000 });
    expect(getThreadRootReadAction(client(), room, root3)).toBe('seen');
    rememberSeenThreadRoot(ME, room.roomId, root3, 2000);
    expect(getThreadRootReadAction(client(), room, root2)).toBe('seen');
    rememberSeenThreadRoot(ME, room.roomId, root2, 2000);

    // On this device the opened roots are read: the room and the unread filter skip them.
    expect(isMainTimelineMessageUnread(room, root3, ME)).toBe(false);
    expect(isMainTimelineMessageUnread(room, root1, ME)).toBe(true);
    expect(roomHaveUnread(client(), room)).toBe(true);

    expect(getThreadRootReadAction(client(), room, root1)).toBe('receipt');
  });

  it('sends the receipt over a later notice that no thread list shows', () => {
    const notice = new MatrixEvent({
      content: { body: 'Indexing finished', msgtype: 'm.notice' },
      event_id: '$notice',
      origin_server_ts: 4000,
      room_id: '!room:example.org',
      sender: '@mindroom_reporter:example.org',
      type: 'm.room.message',
    });
    const room = makeRoom({ main: [older, root1, notice], receiptTs: 2000 });
    const withAgent = {
      ...room,
      getMembers: () => [{ userId: notice.getSender(), membership: 'join' }],
    } as unknown as Room;
    expect(getThreadRootReadAction(client(), withAgent, root1)).toBe('receipt');
  });

  it("stops at the reader's own message, since everything before it was read", () => {
    const own = message('$own', 2500, ME);
    const room = makeRoom({ main: [message('$unread', 2000, ALICE), own, root1] });
    expect(getThreadRootReadAction(client(), room, root1)).toBe('receipt');
  });

  describe('when older history is not loaded', () => {
    it('sends the receipt when the server counts nothing but the root and the roots seen', () => {
      const room = makeRoom({ main: [root2, root3], olderHistory: true, mainCount: 2 });
      expect(getThreadRootReadAction(client(), room, root3)).toBe('seen');
      rememberSeenThreadRoot(ME, room.roomId, root2, Number.NEGATIVE_INFINITY);
      expect(getThreadRootReadAction(client(), room, root3)).toBe('receipt');
    });

    it('keeps the receipt back while the server counts more unread messages', () => {
      const room = makeRoom({ main: [root3], olderHistory: true, mainCount: 2 });
      expect(getThreadRootReadAction(client(), room, root3)).toBe('seen');
    });

    it('does not count a root the server does not notify for', () => {
      const room = makeRoom({ main: [root3], olderHistory: true, mainCount: 1 });
      expect(getThreadRootReadAction(client(), room, root3)).toBe('receipt');
      expect(getThreadRootReadAction(client(false), room, root3)).toBe('seen');
    });
  });
});
