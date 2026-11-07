// @vitest-environment jsdom
import { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { trustAgentsOfViewer } from '../../matrix/protocol/untrustedContent';
import { putSession, setActiveSession } from '../../matrix/session/sessions';
import {
  buildCompactZeroReplyRootData,
  isZeroReplyStandaloneThreadRootEvent,
} from './compactThreadRootData';

// An agent can start a conversation with a notice, such as a card or a report. Before anyone
// replies, the thread lists show a notice only when its content says
// `io.mindroom.conversation: true` and a MindRoom agent on the homeserver of the active account
// sent it; every other such notice stays out.
const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_reporter:example.org';
const FOREIGN_AGENT = '@mindroom_reporter:elsewhere.example';
const PERSON = '@bob:example.org';
const NOW = 10_000_000;

const signIn = (userId: string, setActive = true) =>
  putSession(
    { baseUrl: 'https://matrix.example', userId, deviceId: 'DEVICE', accessToken: 'token' },
    { setActive }
  );

beforeEach(() => {
  localStorage.clear();
  signIn(VIEWER);
});

const notice = (
  eventId: string,
  sender: string,
  body: string,
  extra: Record<string, unknown> = {}
): MatrixEvent =>
  new MatrixEvent({
    event_id: eventId,
    room_id: '!room:example.org',
    type: 'm.room.message',
    sender,
    origin_server_ts: NOW - 1_000,
    content: { msgtype: 'm.notice', body, ...extra },
  });

const room = {
  getUnfilteredTimelineSet: () =>
    ({ relations: { getChildEventsForEvent: () => undefined } } as never),
};

describe('isZeroReplyStandaloneThreadRootEvent for notices', () => {
  it.each([
    { who: 'an agent of the viewer marks', sender: AGENT, marker: true, lists: true },
    { who: 'an agent of the viewer does not mark', sender: AGENT, marker: undefined, lists: false },
    { who: 'a person marks', sender: PERSON, marker: true, lists: false },
    {
      who: 'an agent of another homeserver marks',
      sender: FOREIGN_AGENT,
      marker: true,
      lists: false,
    },
    { who: 'an agent marks with a string', sender: AGENT, marker: 'true', lists: false },
  ])('a notice that $who lists: $lists', ({ sender, marker, lists }) => {
    const extra = marker === undefined ? {} : { 'io.mindroom.conversation': marker };
    const event = notice('$notice', sender, 'Report', extra);
    expect(isZeroReplyStandaloneThreadRootEvent(event, NOW)).toBe(lists);
  });
});

describe('buildCompactZeroReplyRootData for notices', () => {
  it("lists the agent's marked notice with its preview and leaves out the other notices", () => {
    const data = buildCompactZeroReplyRootData({
      room,
      roomSurfaceEntries: [
        { event: notice('$status', AGENT, 'Indexing done'), absoluteIndex: 0 },
        {
          event: notice('$person-card', PERSON, 'Looks like a card', {
            'io.mindroom.conversation': true,
          }),
          absoluteIndex: 1,
        },
        {
          event: notice('$card', AGENT, 'Weekly report', { 'io.mindroom.conversation': true }),
          absoluteIndex: 2,
        },
      ],
      knownThreadRootIds: [],
      now: NOW,
    });

    expect(data.ids).toEqual(['$card']);
    expect(data.indexMap.get('$card')).toBe(2);
    expect(data.bodyMap.get('$card')).toBe('Weekly report');
  });
});

describe('the active account decides whose agents count', () => {
  const OTHER_ACCOUNT = '@reader:second.example';
  const OTHER_AGENT = '@mindroom_reporter:second.example';
  const marked = (sender: string) =>
    notice('$card', sender, 'Report', { 'io.mindroom.conversation': true });

  it("leaves out the other signed-in account's agents, and follows a switch", () => {
    // Both accounts' clients started on this page, so the content guard trusts both accounts'
    // agents (`initClient`); only the active account's agents start conversations.
    trustAgentsOfViewer(VIEWER);
    trustAgentsOfViewer(OTHER_ACCOUNT);
    const other = signIn(OTHER_ACCOUNT, false);
    expect(isZeroReplyStandaloneThreadRootEvent(marked(AGENT), NOW)).toBe(true);
    expect(isZeroReplyStandaloneThreadRootEvent(marked(OTHER_AGENT), NOW)).toBe(false);

    setActiveSession(other.sessionId);
    expect(isZeroReplyStandaloneThreadRootEvent(marked(OTHER_AGENT), NOW)).toBe(true);
    expect(isZeroReplyStandaloneThreadRootEvent(marked(AGENT), NOW)).toBe(false);
  });

  it('lists no marked notice while no account is active', () => {
    trustAgentsOfViewer(VIEWER);
    localStorage.clear();
    expect(isZeroReplyStandaloneThreadRootEvent(marked(AGENT), NOW)).toBe(false);
  });
});
