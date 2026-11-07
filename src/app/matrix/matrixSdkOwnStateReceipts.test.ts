import { createClient, MatrixEvent, NotificationCountType, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

// The server reads nothing for a member's own state event, only for the member event of their join
// (mindroom-tuwunel#139). The SDK made up a receipt for every live event of its sender, so the
// reader's own thread tag, the newest event, read the room's messages before it, and the first sync
// zeroed the room's count (live-test finding P2-lane4-F002). Our SDK patch makes up none for such an
// event.

const ROOM = '!room:example.org';
const READER = '@reader:example.org';
const COLLEAGUE = '@colleague:example.org';

let ts = 1_000;
const event = (
  id: string,
  sender: string,
  type: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    type,
    sender,
    origin_server_ts: (ts += 1),
    content,
    ...extra,
  });
const message = (id: string, sender: string) =>
  event(id, sender, 'm.room.message', { msgtype: 'm.text', body: `message ${id}` });
const member = (id: string, membership: string, prevMembership?: string) =>
  event(
    id,
    READER,
    'm.room.member',
    { membership, displayname: 'Reader' },
    {
      state_key: READER,
      unsigned: prevMembership ? { prev_content: { membership: prevMembership } } : {},
    }
  );

const roomWith = async (events: MatrixEvent[]) => {
  const client = createClient({ baseUrl: 'https://example.org', userId: READER });
  const room = new Room(ROOM, client, READER, { timelineSupport: true });
  await room.addLiveEvents(events, { addToState: false });
  return room;
};

describe('SDK receipts for a member’s own state events', () => {
  it('reads nothing for the reader’s own thread tag', async () => {
    const room = await roomWith([
      message('$own', READER),
      message('$unread', COLLEAGUE),
      event(
        '$tag',
        READER,
        'com.mindroom.thread.tags',
        { set_by: READER },
        { state_key: '["$own","x"]' }
      ),
    ]);

    expect(room.getEventReadUpTo(READER)).toBe('$own');
    expect(room.hasUserReadEvent(READER, '$unread')).toBe(false);
  });

  it('keeps the room’s count when the reader’s own state event is the newest', async () => {
    const room = await roomWith([
      message('$unread', COLLEAGUE),
      event('$topic', READER, 'm.room.topic', { topic: 'Release plans' }, { state_key: '' }),
    ]);
    room.setUnreadNotificationCount(NotificationCountType.Total, 1);

    room.fixupNotifications(READER);

    expect(room.getUnreadNotificationCount(NotificationCountType.Total)).toBe(1);
  });

  it('reads nothing for a profile change, but reads the room at the reader’s join', async () => {
    const room = await roomWith([member('$join', 'join', 'invite'), message('$unread', COLLEAGUE)]);
    expect(room.getEventReadUpTo(READER)).toBe('$join');

    await room.addLiveEvents([member('$rename', 'join', 'join')], { addToState: false });

    expect(room.getEventReadUpTo(READER)).toBe('$join');
    expect(room.hasUserReadEvent(READER, '$unread')).toBe(false);
  });

  it('still reads up to the reader’s own message', async () => {
    const room = await roomWith([message('$unread', COLLEAGUE), message('$own', READER)]);

    expect(room.hasUserReadEvent(READER, '$unread')).toBe(true);
  });
});
