import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import { buildThreadRecord } from './threadRecord';

// A thread the server's thread list brought in: the root, the bundled newest reply, and none of
// the replies in between. Its other writers come from read replies (`fallbackParticipantIds`).
const ROOT_SENDER = '@root:server';
const NEWEST = '@newest:server';
const MIDDLE = '@middle:server';
const ME = '@me:server';

const fakeEvent = (
  id: string,
  sender: string,
  { rootId, unsigned }: { rootId?: string; unsigned?: Record<string, unknown> } = {}
) =>
  ({
    getId: () => id,
    threadRootId: rootId,
    getSender: () => sender,
    getType: () => 'm.room.message',
    getContent: () => ({ msgtype: 'm.text', body: `${id} body` }),
    getRelation: () => (rootId ? { rel_type: 'm.thread', event_id: rootId } : undefined),
    isRelation: (type: string) => !!rootId && type === 'm.thread',
    getTs: () => 1_000,
    getUnsigned: () => unsigned,
    replacingEvent: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const listedThread = ({ participated }: { participated: boolean }) => {
  const root = fakeEvent('$root', ROOT_SENDER, {
    unsigned: {
      'm.relations': {
        'm.thread': { count: 6, current_user_participated: participated },
      },
    },
  });
  const newest = fakeEvent('$newest', NEWEST, { rootId: '$root' });
  const thread = {
    id: '$root',
    rootEvent: root,
    replyToEvent: newest,
    length: 6,
    events: [root],
    timeline: [root],
    lastReply: () => newest,
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => ({
        getEvents: () => [root],
        getNeighbouringTimeline: () => undefined,
      }),
      relations: { getChildEventsForEvent: () => undefined },
    }),
  };
  const room = {
    roomId: '!room:server',
    getThread: vi.fn(() => thread),
    findEventById: vi.fn(() => root),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: { getChildEventsForEvent: () => undefined },
    })),
    getMember: vi.fn(() => undefined),
  } as unknown as Room;
  return { room, root };
};

describe('buildThreadRecord people', () => {
  it('shows the newest replier, the other known writers, then the root sender', () => {
    const { room } = listedThread({ participated: false });
    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      currentUserId: ME,
      fallbackParticipantIds: [NEWEST, MIDDLE],
    });
    expect(record.presentation.participantIds).toEqual([NEWEST, MIDDLE, ROOT_SENDER]);
    expect([...(record.presentation.peopleIds ?? [])].sort()).toEqual(
      [ROOT_SENDER, NEWEST, MIDDLE].sort()
    );
  });

  it('without read replies still shows the newest replier beside the root sender', () => {
    const { room } = listedThread({ participated: false });
    const record = buildThreadRecord({ room, threadRootId: '$root', currentUserId: ME });
    expect(record.presentation.participantIds).toEqual([NEWEST, ROOT_SENDER]);
  });

  it('counts the current user when the server says they wrote in the thread', () => {
    const { room } = listedThread({ participated: true });
    const record = buildThreadRecord({ room, threadRootId: '$root', currentUserId: ME });
    expect(record.presentation.peopleIds).toContain(ME);
    const other = buildThreadRecord({
      room: listedThread({ participated: false }).room,
      threadRootId: '$root',
      currentUserId: ME,
    });
    expect(other.presentation.peopleIds).not.toContain(ME);
  });
});
