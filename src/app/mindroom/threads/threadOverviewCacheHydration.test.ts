import { describe, expect, it } from 'vitest';
import type { IEvent, MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { ThreadRecord } from './types';
import {
  buildCachedOverviewCoverage,
  resolveCachedOverviewUpdate,
} from './threadOverviewCacheHydration';

type RawCachedEvent = {
  event_id: string;
  origin_server_ts: number;
  sender?: string;
  content?: Record<string, unknown>;
  threadRootId?: string;
  relation?: { rel_type?: string; event_id?: string };
};

const makeEvent = (
  eventId: string,
  opts: {
    sender?: string;
    ts?: number;
    type?: string;
    content?: Record<string, unknown>;
    isThreadRoot?: boolean;
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
  } = {}
) =>
  ({
    isThreadRoot: opts.isThreadRoot ?? false,
    threadRootId: opts.threadRootId,
    getContent: () => opts.content ?? { body: eventId, msgtype: 'm.text' },
    getId: () => eventId,
    getRelation: () => opts.relation,
    getSender: () => opts.sender ?? '@alice:example.org',
    getTs: () => opts.ts ?? 0,
    getType: () => opts.type ?? 'm.room.message',
    getUnsigned: () => ({}),
    isRedacted: () => false,
    isRedaction: () => false,
    replacingEvent: () => undefined,
  }) as MatrixEvent;

const makeRoom = (events: MatrixEvent[] = []): Room =>
  ({
    roomId: '!room:example.org',
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    getMember: (userId: string) => ({ rawDisplayName: userId }),
    getThread: () => null,
    getUnfilteredTimelineSet: () => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    }),
  }) as unknown as Room;

const mapRawCachedEvent = (rawEvent: IEvent): MatrixEvent => {
  const raw = rawEvent as RawCachedEvent;

  return makeEvent(raw.event_id, {
    content: raw.content,
    relation: raw.relation,
    sender: raw.sender,
    threadRootId: raw.threadRootId,
    ts: raw.origin_server_ts,
  }) as MatrixEvent;
};

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId: '$thread-root',
  rootEventId: '$thread-root',
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'root preview',
    latestReplyPreviewText: 'live reply',
    lastSenderId: '@live:example.org',
    lastSenderDisplayName: 'Live',
    messageCount: 5,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: 'root preview',
    recentThreadSummaryText: 'root preview',
    ...overrides.presentation,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 5,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: 100,
    tags: [],
    ...overrides.status,
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

describe('resolveCachedOverviewUpdate', () => {
  it('uses the ThreadRecord snapshot to avoid downgrading from older cached reply metadata', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const room = makeRoom([rootEvent]);

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room,
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: [
          {
            event_id: '$cached-reply',
            origin_server_ts: 90,
            sender: '@cached:example.org',
            content: { body: 'older cached reply', msgtype: 'm.text' },
            threadRootId,
            relation: { rel_type: 'm.thread', event_id: threadRootId },
          },
        ],
        hasMoreBefore: false,
      },
      currentRecord: makeRecord(),
      currentRootEvent: rootEvent,
      showCompactRoomView: false,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update).toMatchObject({
      rootId: threadRootId,
      nextCacheCoverage: {
        eventCount: 1,
        oldestTs: 90,
        newestTs: 90,
        hasMoreBackward: false,
        relationSnapshotComplete: false,
        tailLoaded: false,
      },
    });
    expect(update?.nextActivityTs).toBeUndefined();
    expect(update?.nextReplyPreviewText).toBeUndefined();
    expect(update?.nextLastSenderId).toBeUndefined();
    expect(update?.nextMessageCount).toBeUndefined();
  });

  it('derives ThreadRecord cache coverage from cached overview pages', () => {
    expect(
      buildCachedOverviewCoverage({
        events: [
          { event_id: '$a', origin_server_ts: 200 },
          { event_id: '$b', origin_server_ts: 100 },
        ],
        hasMoreBefore: true,
        beforeToken: 'older',
        expectedReplyCount: 7,
        relationSnapshotComplete: true,
        snapshotComplete: false,
        tailLoaded: true,
      })
    ).toMatchObject({
      eventCount: 2,
      oldestTs: 100,
      newestTs: 200,
      backwardToken: 'older',
      hasMoreBackward: true,
      expectedReplyCount: 7,
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    });
  });

  it('does not treat an empty cache miss as record coverage', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const room = makeRoom([rootEvent]);

    expect(
      resolveCachedOverviewUpdate({
        rootId: threadRootId,
        room,
        mapper: mapRawCachedEvent,
        cachedPage: {
          events: [],
          hasMoreBefore: false,
        },
        currentRecord: makeRecord(),
        currentRootEvent: rootEvent,
        showCompactRoomView: false,
        compactCachedThreadRootBodyMap: new Map(),
        compactThreadRootBodyMap: new Map(),
      })
    ).toBeNull();
  });
});
