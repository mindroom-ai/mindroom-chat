// @vitest-environment jsdom
import { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { putSession } from '../session/sessions';
import { trustAgentsOfViewer } from '../protocol/untrustedContent';
import { getRoomUnreadAction } from './roomToUnread';

// A room with a MindRoom agent shows its thread lists, and is unread only for what they show. A
// notice in the main timeline shows there once its thread has replies, or before that when a
// MindRoom agent on the active account's homeserver marked it as a conversation
// (`io.mindroom.conversation: true`); any other notice leaves such a room read. A room without an
// agent shows its whole conversation, so every notice there counts.
const ROOM_ID = '!room:example.org';
const READER = '@reader:example.org';
const AGENT = '@mindroom_reporter:example.org';
const FOREIGN_AGENT = '@mindroom_reporter:elsewhere.example';
const PERSON = '@bob:example.org';

beforeEach(() => {
  localStorage.clear();
  putSession(
    { baseUrl: 'https://matrix.example', userId: READER, deviceId: 'DEVICE', accessToken: 'token' },
    { setActive: true }
  );
});

const message = ({
  sender,
  msgtype = 'm.notice',
  marked = false,
  replies = false,
}: {
  sender: string;
  msgtype?: string;
  marked?: boolean;
  /** The server bundles the thread's summary with a root whose thread has replies. */
  replies?: boolean;
}): MatrixEvent =>
  new MatrixEvent({
    content: {
      msgtype,
      body: 'Indexing finished',
      ...(marked ? { 'io.mindroom.conversation': true } : {}),
    },
    event_id: '$message',
    origin_server_ts: 1000,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    ...(replies
      ? {
          unsigned: {
            'm.relations': {
              'm.thread': {
                latest_event: { event_id: '$reply', sender, type: 'm.room.message', content: {} },
                count: 1,
                current_user_participated: false,
              },
            },
          },
        }
      : {}),
  });

/**
 * Whether a room the reader last read before `event`, where `members` are joined, is unread. With
 * `notified`, the push rules notify for `event` and the server counts it.
 */
const isUnread = (
  event: MatrixEvent,
  { notified = false, members = [READER, AGENT] }: { notified?: boolean; members?: string[] } = {}
): boolean => {
  const count = notified ? 1 : 0;
  const room = {
    roomId: ROOM_ID,
    getMembers: () => members.map((userId) => ({ userId, membership: 'join' })),
    getEventReadUpTo: () => null,
    getLiveTimeline: () => ({ getEvents: () => [event] }),
    getMyMembership: () => 'join',
    getUnreadNotificationCount: () => count,
    getRoomUnreadNotificationCount: () => count,
    isSpaceRoom: () => false,
  };
  const client = {
    getPushActionsForEvent: () => ({ notify: notified, tweaks: {} }),
    getUserId: () => READER,
  };
  return getRoomUnreadAction(client as never, room as never).type === 'PUT';
};

describe('getRoomUnreadAction for notices', () => {
  it.each([
    { what: "an agent's unmarked notice", event: { sender: AGENT }, unread: false },
    { what: "an agent's marked notice", event: { sender: AGENT, marked: true }, unread: true },
    {
      what: "an agent's unmarked notice whose thread has replies",
      event: { sender: AGENT, replies: true },
      unread: true,
    },
    { what: "a person's marked notice", event: { sender: PERSON, marked: true }, unread: false },
    {
      what: "a marked notice of another homeserver's agent",
      event: { sender: FOREIGN_AGENT, marked: true },
      unread: false,
    },
    { what: "an agent's message", event: { sender: AGENT, msgtype: 'm.text' }, unread: true },
  ])('$what makes the room unread: $unread', ({ event, unread }) => {
    expect(isUnread(message(event))).toBe(unread);
  });

  it("counts an agent's call row, which the thread lists show before anyone replies", () => {
    trustAgentsOfViewer(READER);
    const row = (sender: string) =>
      new MatrixEvent({
        ...message({ sender }).event,
        content: {
          msgtype: 'm.notice',
          body: 'Call started',
          'io.mindroom.call': { call_id: 'c1' },
        },
      });
    expect(isUnread(row(AGENT))).toBe(true);
    expect(isUnread(row(PERSON))).toBe(false);
  });

  it('counts every notice in a room without a MindRoom agent', () => {
    expect(isUnread(message({ sender: PERSON }), { members: [READER, PERSON] })).toBe(true);
  });

  it('leaves the room read when the push rules notify for a notice no thread list shows', () => {
    expect(isUnread(message({ sender: AGENT }), { notified: true })).toBe(false);
    expect(isUnread(message({ sender: AGENT, marked: true }), { notified: true })).toBe(true);
  });
});
