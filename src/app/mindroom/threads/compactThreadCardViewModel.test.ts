import { EventStatus, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import { buildCompactThreadCardViewModelFromRecord } from './compactThreadCardViewModel';
import { buildThreadRecord } from './threadRecord';

const makeEvent = ({
  eventId,
  threadRootId,
  sender,
  body,
  content,
  status,
  ts = 1000,
}: {
  eventId: string;
  threadRootId?: string;
  sender?: string;
  body?: string;
  content?: Record<string, unknown>;
  status?: EventStatus;
  ts?: number;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    threadRootId,
    getSender: () => sender,
    getContent: () => content ?? (body ? { body, msgtype: 'm.text' } : {}),
    getType: () => 'm.room.message',
    getRelation: () => (threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!threadRootId && relType === 'm.thread',
    getTs: () => ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
    status,
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
  overrides: Partial<Parameters<typeof buildThreadRecord>[0]> = {}
) => {
  const record = buildThreadRecord({
    room,
    threadRootId: '$root',
    currentUserId: '@me:server',
    ...overrides,
  });

  return buildCompactThreadCardViewModelFromRecord({
    record,
    room,
    currentUserId: '@me:server',
    mx: makeMx(),
    useAuthentication: false,
  });
};

describe('buildCompactThreadCardViewModelFromRecord', () => {
  it('builds one compact model from summary, tags, scheduled state, and visible replies', () => {
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
        relations: {
          getChildEventsForEvent: () => undefined,
        },
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
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 9,
      },
      readUpToTs: null,
      scheduledStatus: {
        scheduledTaskCount: 2,
      },
      threadResolution: {
        isResolved: true,
        tags: {
          resolved: {},
          agent: {},
        },
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

  it('uses cached root preview as the zero-reply title and recent-thread summary', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Original root body',
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      rootPreviewText: 'Edited root preview',
      fallbackMessageCount: 0,
    });

    expect(model.titleText).toBe('Edited root preview');
    expect(model.previewText).toBe('Edited root preview');
    expect(model.messageCount).toBe(0);
    expect(model.messageCountLabel).toBe('0 replies');
    expect(model.recentThreadSummaryText).toBe('Edited root preview');
  });

  it('uses voice message previews for zero-reply compact card models', () => {
    const filename = 'voice-message-2026-04-24T12-03-00.m4a';
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      content: {
        body: filename,
        filename,
        msgtype: 'm.audio',
        'm.voice': {},
        'm.audio': {
          duration: 1000,
        },
      },
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
    });

    expect(model.titleText).toBe('Voice message');
    expect(model.displayTitleText).toBe('Voice message');
    expect(model.previewText).toBe('Voice message');
    expect(model.primarySummaryText).toBe('Voice message');
    expect(model.recentThreadSummaryText).toBe('Voice message');
    expect(model.messageCount).toBe(0);
    expect(model.messageCountLabel).toBe('0 replies');
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
      threadResolution: {
        tags: {
          resolved: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
          triage: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
        },
        isResolved: true,
      },
    });

    expect(model.isResolved).toBe(true);
    expect(model.tags).toEqual(['triage']);
    expect(model.attentionState).toBe('resolved');
  });

  it('marks compact models pending while a zero-reply root local echo is sending', () => {
    const rootEvent = makeEvent({
      eventId: '~root',
      sender: '@me:server',
      body: 'Pending root body',
      status: EventStatus.SENDING,
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootId: '~root',
      threadRootEvent: rootEvent,
      fallbackMessageCount: 0,
    });

    expect((model as { hasPendingSend?: boolean }).hasPendingSend).toBe(true);
  });

  it('marks compact models pending while the latest visible reply local echo is sending', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '~reply',
      threadRootId: '$root',
      sender: '@me:server',
      body: 'Pending reply body',
      status: EventStatus.SENDING,
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
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const room = makeRoom({
      rootEvent,
      thread,
      memberNames: {
        '@me:server': 'Me',
      },
    });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
    });

    expect(model.previewText).toBe('Me: Pending reply body');
    expect((model as { hasPendingSend?: boolean }).hasPendingSend).toBe(true);
  });
});
