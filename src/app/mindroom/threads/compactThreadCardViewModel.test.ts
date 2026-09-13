import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadOverviewMetadata } from '../../features/room/roomThreadOverviewModel';
import { buildCompactThreadCardViewModel } from './compactThreadCardViewModel';

const makeMetadata = (overrides: Partial<ThreadOverviewMetadata> = {}): ThreadOverviewMetadata => ({
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  lastActivityTs: 1000,
  absoluteIndex: 0,
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

const makeEvent = ({
  eventId,
  threadRootId,
  sender,
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
  memberNames = {},
}: {
  rootEvent?: MatrixEvent;
  thread?: ReturnType<Room['getThread']>;
  memberNames?: Record<string, string>;
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
    getMember: vi.fn((userId: string) => {
      const name = memberNames[userId];
      return name
        ? {
            name,
            rawDisplayName: name,
            getMxcAvatarUrl: () => undefined,
          }
        : undefined;
    }),
  } as unknown as Room);

const makeMx = (): MatrixClient =>
  ({
    getUserId: () => '@me:server',
  } as unknown as MatrixClient);

const buildModel = (
  room: Room,
  overrides: Partial<Parameters<typeof buildCompactThreadCardViewModel>[0]> = {}
) =>
  buildCompactThreadCardViewModel({
    room,
    threadRootId: '$root',
    mx: makeMx(),
    useAuthentication: false,
    scheduledTaskEvents: [],
    scheduledTaskCounts: new Map(),
    threadResolutionMap: new Map(),
    ...overrides,
  });

describe('buildCompactThreadCardViewModel', () => {
  it('builds one compact model from summary, metadata, tags, and visible replies', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Latest reply body',
      ts: 2000,
    });
    const thread = {
      id: '$root',
      rootEvent,
      events: [reply],
      timeline: [reply],
      lastReply: () => reply,
      replyToEvent: undefined,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({
          getEvents: () => [rootEvent, reply],
          getNeighbouringTimeline: () => undefined,
        }),
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const room = makeRoom({
      rootEvent,
      thread,
      memberNames: {
        '@agent:server': 'Agent',
      },
    });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      metadata: makeMetadata({
        isResolved: true,
        isUnread: true,
        scheduledTaskCount: 2,
        tags: ['resolved', 'agent'],
      }),
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 9,
      },
    });

    expect(model.titleText).toBe('Live AI summary');
    expect(model.previewText).toBe('Agent: Latest reply body');
    expect(model.messageCount).toBe(9);
    expect(model.messageCountLabel).toBe('9 msgs');
    expect(model.tags).toEqual(['agent']);
    expect(model.isResolved).toBe(true);
    expect(model.isUnread).toBe(true);
    expect(model.scheduledTaskLabel).toBe('2 pending scheduled tasks');
    expect(model.scheduledDisplayText).toBe('2 scheduled tasks');
    expect(model.participants).toEqual([
      {
        userId: '@agent:server',
        displayName: 'Agent',
        avatarUrl: undefined,
      },
      {
        userId: '@me:server',
        displayName: 'me',
        avatarUrl: undefined,
      },
    ]);
  });

  it('uses metadata root preview as the zero-reply title and recent-thread summary', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Original root body',
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      metadata: makeMetadata({
        rootPreviewText: 'Edited root preview',
        messageCount: 0,
      }),
    });

    expect(model.titleText).toBe('Edited root preview');
    expect(model.previewText).toBe('Edited root preview');
    expect(model.messageCount).toBe(0);
    expect(model.messageCountLabel).toBe('0 replies');
    expect(model.recentThreadSummaryText).toBe('Edited root preview');
  });

  it('falls back to room-level resolution data when overview metadata is absent', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@agent:server',
      body: 'Root body',
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      threadResolutionMap: new Map([
        [
          '$root',
          {
            tags: {
              resolved: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
              triage: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
            },
            isResolved: true,
            isPending: false,
          },
        ],
      ]),
    });

    expect(model.isResolved).toBe(true);
    expect(model.tags).toEqual(['triage']);
    expect(model.attentionState).toBe('resolved');
  });
});
