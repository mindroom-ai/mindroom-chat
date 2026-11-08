import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOptimisticReceiptUnreadInfo, getRoomUnreadAction } from './roomToUnread';

// Thread roots opened on this device (`isSeenThreadRoot`), by event ID.
const seenRoots = new Set<string>();
vi.mock('../seenThreadRoots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../seenThreadRoots')>()),
  isSeenThreadRoot: (_userId: string, _roomId: string, eventId: string | undefined) =>
    !!eventId && seenRoots.has(eventId),
}));

afterEach(() => seenRoots.clear());

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const USER_ID = '@alice:example.org';

const makeMessageEvent = (eventId: string, sender = '@bob:example.org') =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (eventId: string) =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: THREAD_ID,
        'm.in_reply_to': {
          event_id: THREAD_ID,
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
  });

const makeRoom = ({
  answeredRoots = [],
  events,
  highlight = 0,
  membership = 'join',
  roomHighlight = highlight,
  readUpToEventId = null,
  threadHighlight = 0,
  total = 0,
  roomTotal = total,
  threadTotal = 0,
}: {
  /** Roots the user replied to in their threads. */
  answeredRoots?: string[];
  events: MatrixEvent[];
  highlight?: number;
  membership?: string;
  roomHighlight?: number;
  readUpToEventId?: string | null;
  threadHighlight?: number;
  total?: number;
  roomTotal?: number;
  threadTotal?: number;
}) =>
  ({
    findEventById: vi.fn(() => undefined),
    roomId: ROOM_ID,
    getEventReadUpTo: vi.fn(() => readUpToEventId),
    getLiveTimeline: vi.fn(() => ({
      getEvents: () => events,
    })),
    getMyMembership: vi.fn(() => membership),
    getThread: vi.fn((rootId: string) =>
      answeredRoots.includes(rootId) ? { hasCurrentUserParticipated: true } : null
    ),
    getUnreadNotificationCount: vi.fn((type: string) => {
      if (type === 'highlight') return highlight;
      return total;
    }),
    getRoomUnreadNotificationCount: vi.fn((type: string) => {
      if (type === 'highlight') return roomHighlight;
      return roomTotal;
    }),
    getThreadUnreadNotificationCount: vi.fn((threadId: string, type: string) => {
      if (threadId !== THREAD_ID) return 0;
      if (type === 'highlight') return threadHighlight;
      return threadTotal;
    }),
    isSpaceRoom: vi.fn(() => false),
  }) as const;

const makeClient = () =>
  ({
    getAccountData: vi.fn(() => undefined),
    getPushActionsForEvent: vi.fn(() => ({ notify: true })),
    getRoomPushRule: vi.fn(() => undefined),
    getUserId: vi.fn(() => USER_ID),
  }) as const;

describe('getRoomUnreadAction', () => {
  it('keeps a room unread entry when aggregate unread counts remain', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      readUpToEventId: '$main',
      total: 2,
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: {
        roomId: ROOM_ID,
        highlight: 0,
        total: 2,
      },
    });
  });

  it('deletes a room unread entry once the room is fully read', () => {
    const latestEvent = makeMessageEvent('$main');
    const room = makeRoom({
      events: [latestEvent],
      readUpToEventId: latestEvent.getId(),
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM_ID,
    });
  });

  it('preserves non-notifying unread markers when counts are still zero', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: {
        roomId: ROOM_ID,
        highlight: 0,
        total: 0,
      },
    });
  });

  it('drops zero-count thread-only activity after a thread receipt clears that thread', () => {
    const room = makeRoom({
      events: [makeThreadReplyEvent('$thread-reply')],
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM_ID,
    });
  });
});

// A thread receipt reads only its thread on the server, so a root opened on this device stays in
// the main-timeline count, though the client counts it as read (seen thread roots).
describe('getRoomUnreadAction for roots opened on this device', () => {
  const seen = (...eventIds: string[]) => eventIds.forEach((eventId) => seenRoots.add(eventId));

  it('leaves the room read when the main count is a root opened on this device', () => {
    seen('$root');
    const room = makeRoom({ events: [makeMessageEvent('$root')], total: 1 });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM_ID,
    });
  });

  it('keeps the thread counts when the main count is a root opened on this device', () => {
    seen('$root');
    const room = makeRoom({
      events: [makeMessageEvent('$root')],
      highlight: 1,
      roomHighlight: 1,
      roomTotal: 1,
      total: 3,
      threadTotal: 2,
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM_ID, highlight: 0, total: 2 },
    });
  });

  it('keeps a main count larger than the opened roots it has loaded', () => {
    seen('$root');
    const room = makeRoom({ events: [makeMessageEvent('$root')], total: 2 });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM_ID, highlight: 0, total: 2 },
    });
  });

  it('keeps the main count when an unopened root is newer than the opened one', () => {
    seen('$opened');
    const room = makeRoom({
      events: [makeMessageEvent('$opened'), makeMessageEvent('$new')],
      total: 1,
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM_ID, highlight: 0, total: 1 },
    });
  });

  // A reply of the user's reads only its thread on the server (mindroom-tuwunel #139), which keeps
  // counting the root, and so does the room list.
  it('keeps the main count for a root the user answered in its thread', () => {
    const room = makeRoom({
      answeredRoots: ['$root'],
      events: [makeMessageEvent('$root')],
      total: 1,
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM_ID, highlight: 0, total: 1 },
    });
  });
});

describe('getOptimisticReceiptUnreadInfo', () => {
  it('clears all unread counts for an explicit unthreaded receipt', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      total: 5,
      highlight: 1,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          unthreaded: true,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 0,
    });
  });

  it('subtracts only the main-timeline counts for a threaded main receipt', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      highlight: 1,
      roomHighlight: 1,
      roomTotal: 3,
      total: 5,
      threadTotal: 2,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          threadId: MAIN_ROOM_TIMELINE,
          unthreaded: false,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 2,
    });
  });

  it('subtracts only the acknowledged thread counts for a thread receipt', () => {
    const room = makeRoom({
      events: [makeThreadReplyEvent('$thread-reply')],
      threadHighlight: 1,
      threadTotal: 4,
      total: 6,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          threadId: THREAD_ID,
          unthreaded: false,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 2,
    });
  });
});
