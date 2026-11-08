// @vitest-environment jsdom
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCompactZeroReplyRootData,
  isZeroReplyStandaloneThreadRootEvent,
} from './compactThreadRootData';
import {
  installEventContentGuard,
  trustAgentsOfViewer,
} from '../../matrix/protocol/untrustedContent';
import { putSession } from '../../matrix/session/sessions';

const ROUTER = '@mindroom_router:example.org';
const PERSON = '@person:example.org';
const NOW = 1_800_000_000_000;

const event = (eventId: string, sender: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!room:example.org',
    event_id: eventId,
    sender,
    origin_server_ts: NOW - 1000,
    content,
  } as Partial<IEvent>);

const ROW = {
  msgtype: 'm.notice',
  body: 'Call started',
  'io.mindroom.call': { call_id: 'call-1' },
};

beforeAll(() => {
  installEventContentGuard();
  trustAgentsOfViewer('@reader:example.org');
  // Rows count from the active account's agents.
  putSession(
    {
      baseUrl: 'https://matrix.example',
      userId: '@reader:example.org',
      deviceId: 'DEVICE',
      accessToken: 'token',
    },
    { setActive: true }
  );
});

describe("a call's row in the thread lists", () => {
  it('lists while nobody has replied to it, as people join the call from it', () => {
    const row = event('$row', ROUTER, ROW);
    expect(isZeroReplyStandaloneThreadRootEvent(row, NOW)).toBe(true);

    const data = buildCompactZeroReplyRootData({
      room: { getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }) } as never,
      roomSurfaceEntries: [{ event: row, absoluteIndex: 0 }],
      knownThreadRootIds: [],
      now: NOW,
    });
    expect(data.ids).toEqual(['$row']);
  });

  it('leaves out other notices, and a row a person wrote', () => {
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        event('$notice', ROUTER, { msgtype: 'm.notice', body: 'Voice call error: no audio' }),
        NOW
      )
    ).toBe(false);
    expect(isZeroReplyStandaloneThreadRootEvent(event('$fake', PERSON, ROW), NOW)).toBe(false);
  });
});
