import { readFileSync } from 'node:fs';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import { buildThreadRecord, buildThreadRecordMap } from './threadRecord';

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

describe('buildThreadRecord', () => {
  it('does not depend on legacy overview metadata compatibility inputs', () => {
    const source = readFileSync(new URL('./threadRecord.ts', import.meta.url), 'utf8');
    const legacyTypeName = ['Thread', 'Overview', 'Metadata'].join('');
    const legacyMapName = ['metadata', 'Map'].join('');
    const legacyOptionName = ['metadata', '?:'].join('');

    expect(source).not.toContain(legacyTypeName);
    expect(source).not.toContain(legacyMapName);
    expect(source).not.toContain(legacyOptionName);
  });

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
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 8,
        generatedTs: 2000,
      },
      rootPreviewText: 'Cached root preview',
      fallbackLatestReplyPreviewText: 'stale cached reply',
      fallbackMessageCount: 4,
      scheduledStatus: {
        scheduledTaskCount: 2,
      },
      currentUserId: '@me:server',
      readUpToTs: null,
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
        scheduledTaskCount: 2,
        tags: ['followup'],
      },
      cache: {
        eventCount: 2,
        oldestTs: 2000,
        newestTs: 3000,
        relationSnapshotComplete: false,
        tailLoaded: false,
        expectedReplyCount: 2,
      },
    });
  });

  it('uses the thread-scoped receipt to clear unread status when the room read marker is older', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const latestReply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Reply body',
      ts: 3000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [latestReply],
        timeline: [latestReply],
        length: 1,
        lastReply: () => latestReply,
        getEventReadUpTo: vi.fn(() => latestReply.getId()),
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, latestReply],
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
      threadRootEvent: rootEvent,
      currentUserId: '@me:server',
      readUpToTs: rootEvent.getTs(),
    });

    expect(record.status.isUnread).toBe(false);
  });

  it('builds a per-room record map from direct source maps', () => {
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
      body: 'Reply body',
      ts: 2000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [reply],
        timeline: [reply],
        length: 1,
        lastReply: () => reply,
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, reply],
            getNeighbouringTimeline: () => undefined,
          }),
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });

    const records = buildThreadRecordMap({
      room,
      threadRootIds: ['$root'],
      summaryMap: new Map([
        [
          '$root',
          {
            summaryText: 'Cached summary',
            messageCount: 2,
            generatedTs: 2000,
          },
        ],
      ]),
      fallbackReplyCountMap: new Map([['$root', 1]]),
      rootPreviewTextMap: new Map([['$root', 'Cached root']]),
      fallbackMessageCountMap: new Map([['$root', 1]]),
      fallbackParticipantMap: new Map([['$root', ['@fallback:server']]]),
      threadResolutionMap: new Map([
        [
          '$root',
          {
            isResolved: true,
            tags: {
              resolved: {},
              canonical: {},
            },
          },
        ],
      ]),
      absoluteIndexMap: new Map([['$root', 42]]),
    });

    expect(records.get('$root')).toMatchObject({
      threadRootId: '$root',
      absoluteIndex: 42,
      presentation: {
        summaryText: 'Cached summary',
        latestReplyPreviewText: 'Reply body',
        replyParticipantIds: ['@agent:server'],
      },
      status: {
        replyCount: 1,
        isResolved: true,
        tags: ['canonical'],
      },
      cache: {
        eventCount: 1,
        oldestTs: 2000,
        newestTs: 2000,
        relationSnapshotComplete: false,
        tailLoaded: false,
        expectedReplyCount: 1,
      },
    });
  });

  it('builds a per-room record map directly from overview fallback maps', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const room = makeRoom({ rootEvent });

    const records = buildThreadRecordMap({
      room,
      threadRootIds: ['$root'],
      threadRootEventMap: new Map([['$root', rootEvent]]),
      rootPreviewTextMap: new Map([['$root', 'Cached root preview']]),
      fallbackLatestReplyPreviewMap: new Map([['$root', 'Cached latest reply']]),
      fallbackLastSenderIdMap: new Map([['$root', '@cached:server']]),
      fallbackMessageCountMap: new Map([['$root', 3]]),
      fallbackLastActivityTsMap: new Map([['$root', 9000]]),
      cacheCoverageMap: new Map([
        [
          '$root',
          {
            eventCount: 3,
            oldestTs: 1000,
            newestTs: 9000,
            backwardToken: null,
            relationSnapshotComplete: true,
            tailLoaded: true,
            expectedReplyCount: 3,
          },
        ],
      ]),
      threadResolutionMap: new Map([
        [
          '$root',
          {
            isResolved: true,
            tags: {
              resolved: {},
              direct: {},
            },
          },
        ],
      ]),
      scheduledStatusMap: new Map([['$root', { scheduledTaskCount: 2 }]]),
      absoluteIndexMap: new Map([['$root', 5]]),
    });

    expect(records.get('$root')).toMatchObject({
      threadRootId: '$root',
      absoluteIndex: 5,
      presentation: {
        rootPreviewText: 'Cached root preview',
        latestReplyPreviewText: 'Cached latest reply',
        lastSenderId: '@cached:server',
        messageCount: 3,
      },
      status: {
        replyCount: 3,
        isResolved: true,
        scheduledTaskCount: 2,
        lastActivityTs: 9000,
        tags: ['direct'],
      },
      cache: {
        eventCount: 3,
        oldestTs: 1000,
        newestTs: 9000,
        backwardToken: null,
        relationSnapshotComplete: true,
        tailLoaded: true,
        expectedReplyCount: 3,
      },
    });
  });
});
