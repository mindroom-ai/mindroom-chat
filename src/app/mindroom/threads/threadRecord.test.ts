import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadOverviewMetadata } from '../../features/room/roomThreadOverviewModel';
import { buildThreadRecord } from './threadRecord';

const makeEvent = ({
  eventId,
  threadRootId,
  sender = '@sender:server',
  body,
  ts = 1000,
}: {
  eventId: string;
  threadRootId?: string;
  sender?: string;
  body?: string;
  ts?: number;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    threadRootId,
    getSender: () => sender,
    getContent: () => (body ? { body, msgtype: 'm.text' } : {}),
    getType: () => 'm.room.message',
    getRelation: () => (threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!threadRootId && relType === 'm.thread',
    getTs: () => ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const makeRoom = ({
  rootEvent,
  thread,
}: {
  rootEvent?: MatrixEvent;
  thread?: ReturnType<Room['getThread']>;
} = {}): Room =>
  ({
    roomId: '!room:server',
    getThread: vi.fn(() => thread),
    findEventById: vi.fn(() => rootEvent),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    })),
    getMember: vi.fn(() => undefined),
  } as unknown as Room);

const makeMetadata = (overrides: Partial<ThreadOverviewMetadata> = {}): ThreadOverviewMetadata => ({
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  lastActivityTs: 1000,
  absoluteIndex: 7,
  lastSenderId: undefined,
  lastSenderDisplayName: undefined,
  latestReplyPreviewText: undefined,
  participantDisplayName: undefined,
  summaryText: undefined,
  rootPreviewText: undefined,
  messageCount: 0,
  tags: [],
  ...overrides,
});

describe('buildThreadRecord', () => {
  it('merges canonical presentation and status data before surfaces render it', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const firstReply = makeEvent({
      eventId: '$reply-a',
      threadRootId: '$root',
      sender: '@agent-a:server',
      body: 'First reply',
      ts: 2000,
    });
    const latestReply = makeEvent({
      eventId: '$reply-b',
      threadRootId: '$root',
      sender: '@agent-b:server',
      body: 'Latest reply',
      ts: 3000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [firstReply, latestReply],
        timeline: [firstReply, latestReply],
        length: 99,
        lastReply: () => latestReply,
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, firstReply, latestReply],
            getNeighbouringTimeline: () => undefined,
          }),
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });

    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      metadata: makeMetadata({
        isUnread: true,
        isStreaming: true,
        scheduledTaskCount: 2,
        latestReplyPreviewText: 'stale cached reply',
        messageCount: 4,
        rootPreviewText: 'Cached root preview',
        summaryText: 'Metadata summary',
        tags: ['resolved', 'triage'],
      }),
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 8,
        generatedTs: 2000,
      },
      threadResolution: {
        isResolved: true,
        tags: {
          resolved: {},
          followup: {},
        },
      },
      fallbackParticipantIds: ['@fallback:server'],
      absoluteIndex: 11,
    });

    expect(record).toMatchObject({
      roomId: '!room:server',
      threadRootId: '$root',
      rootEventId: '$root',
      absoluteIndex: 11,
      presentation: {
        summaryText: 'Live AI summary',
        rootPreviewText: 'Cached root preview',
        latestReplyPreviewText: 'Latest reply',
        lastSenderId: '@agent-b:server',
        messageCount: 8,
        participantIds: ['@agent-b:server', '@agent-a:server', '@me:server'],
      },
      status: {
        isResolved: true,
        isUnread: true,
        isStreaming: true,
        scheduledTaskCount: 2,
        tags: ['followup'],
      },
    });
  });
});
