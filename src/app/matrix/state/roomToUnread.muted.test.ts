import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getRoomUnreadAction } from './roomToUnread';

const ROOM = '!muted:example.org';

const news = new MatrixEvent({
  type: 'm.room.message',
  room_id: ROOM,
  sender: '@writer:example.org',
  event_id: '$news',
  origin_server_ts: 10,
  content: { msgtype: 'm.text', body: 'Lunch order is in' },
});

/** A joined room whose newest message nobody read, with `total` notifications counted. */
const roomWithNews = (total: number) => ({
  roomId: ROOM,
  getMyMembership: () => 'join',
  isSpaceRoom: () => false,
  getUnreadNotificationCount: (type: string) => (type === 'total' ? total : 0),
  getEventReadUpTo: () => null,
  getLiveTimeline: () => ({ getEvents: () => [news] }),
  findEventById: () => undefined,
});

/** A client whose push rules mute the room, or not. */
const clientMuting = (muted: boolean) => ({
  getUserId: () => '@reader:example.org',
  pushRules: {
    global: {
      override: muted
        ? [
            {
              rule_id: ROOM,
              default: false,
              enabled: true,
              actions: [],
              conditions: [{ kind: 'event_match', key: 'room_id', pattern: ROOM }],
            },
          ]
        : [],
    },
  },
});

describe('getRoomUnreadAction for a muted room', () => {
  it('shows no unread mark for messages the mute kept from counting', () => {
    expect(getRoomUnreadAction(clientMuting(false) as never, roomWithNews(0) as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM, highlight: 0, total: 0 },
    });
    expect(getRoomUnreadAction(clientMuting(true) as never, roomWithNews(0) as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM,
    });
  });

  it('keeps the counts a muted room still has from before', () => {
    expect(getRoomUnreadAction(clientMuting(true) as never, roomWithNews(2) as never)).toEqual({
      type: 'PUT',
      unreadInfo: { roomId: ROOM, highlight: 0, total: 2 },
    });
  });
});
