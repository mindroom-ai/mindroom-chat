import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import { buildCompactThreadCardViewModelFromRecord } from './compactThreadCardViewModel';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';

const READER = '@reader:server';
const AGENT = '@mindroom_helper:server';

const event = (fields: {
  id: string;
  sender: string;
  content: Record<string, unknown>;
  ts: number;
  threadRootId?: string;
}): MatrixEvent =>
  ({
    getId: () => fields.id,
    threadRootId: fields.threadRootId,
    getSender: () => fields.sender,
    getContent: () => fields.content,
    getType: () => 'm.room.message',
    getRelation: () => (fields.threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!fields.threadRootId && relType === 'm.thread',
    getTs: () => fields.ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
    status: null,
  } as unknown as MatrixEvent);

// A thread nobody has loaded since a reload knows its reply only from the root's summary, and when
// the agent titled the thread last, that summary's newest event is the title notice, which is no
// reply. The card then previews the root; it must name the root's sender, not the agent's.
describe('a compact card without a known reply', () => {
  it('names the root sender beside the root text it previews', () => {
    const root = event({
      id: '$root',
      sender: READER,
      content: { msgtype: 'm.text', body: 'Which fixes go into the release notes?' },
      ts: 1000,
    });
    const title = event({
      id: '$title',
      sender: AGENT,
      threadRootId: '$root',
      content: {
        msgtype: 'm.notice',
        body: 'Release notes review',
        'io.mindroom.thread_summary': { version: 1, summary: 'Release notes review' },
      },
      ts: 3000,
    });
    const thread = {
      id: '$root',
      rootEvent: root,
      events: [],
      timeline: [],
      length: 2,
      lastReply: () => null,
      replyToEvent: title,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({ getEvents: () => [], getNeighbouringTimeline: () => undefined }),
        relations: { getChildEventsForEvent: () => undefined },
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const names: Record<string, string> = { [READER]: 'Reader', [AGENT]: 'Helper' };
    const room = {
      roomId: '!room:server',
      getThread: vi.fn(() => thread),
      findEventById: vi.fn(() => root),
      getUnfilteredTimelineSet: vi.fn(() => ({
        relations: { getChildEventsForEvent: () => undefined },
      })),
      getMember: vi.fn((userId: string) =>
        names[userId]
          ? { name: names[userId], rawDisplayName: names[userId], getMxcAvatarUrl: () => undefined }
          : undefined
      ),
    } as unknown as Room;
    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      threadRootEvent: root,
      currentUserId: READER,
      fallbackParticipantIds: [AGENT, READER],
    });

    const model = buildCompactThreadCardViewModelFromRecord({
      record,
      room,
      currentUserId: READER,
      mx: { getUserId: () => READER } as unknown as MatrixClient,
      useAuthentication: false,
    });

    expect(model.previewText).not.toMatch(/^Helper: /);
    expect(model.previewText).toBe('Reader: Which fixes go into the release notes?');
  });
});
