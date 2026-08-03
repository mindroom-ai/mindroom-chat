import { describe, expect, it } from 'vitest';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { ThreadRecord } from './types';
import { buildThreadRecord } from './threadRecord';
import {
  buildCachedOverviewCoverage,
  resolveFetchedRelationOverviewUpdate,
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
  } as MatrixEvent);

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
  } as unknown as Room);

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
  const cachedEditedRootPage = {
    rootEvent: {
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    },
    events: [
      {
        event_id: '$root-edit-v2',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: {
          body: '* cached v2',
          msgtype: 'm.text',
          'm.new_content': { body: 'cached v2', msgtype: 'm.text' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$thread-root' },
        },
      },
    ],
    hasMoreBefore: false,
  };

  it('uses a newer cached root edit over healthy-looking stale SDK text', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    });

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage: cachedEditedRootPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'live v1']]),
    });

    expect(update).toMatchObject({
      nextPreview: 'cached v2',
      nextPreviewSourceTs: 200,
    });
  });

  it('does not replace a newer live root edit with stale cache text', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    });
    liveRoot.makeReplaced(
      new MatrixEvent({
        event_id: '$root-edit-v3',
        origin_server_ts: 300,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: {
          body: '* live v3',
          msgtype: 'm.text',
          'm.new_content': { body: 'live v3', msgtype: 'm.text' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$thread-root' },
        },
      })
    );

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage: cachedEditedRootPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'live v3']]),
    });

    expect(update?.nextPreview).toBeUndefined();
    expect(update?.nextPreviewSourceTs).toBeUndefined();
  });

  it('uses complete cached text when newer live text is still a streaming placeholder', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 300,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'Thinking...  ⋯', msgtype: 'm.text' },
    });
    const cachedPage = {
      rootEvent: {
        event_id: '$thread-root',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: { body: 'cached complete', msgtype: 'm.text' },
      },
      events: [],
      hasMoreBefore: false,
    };

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'Thinking...  ⋯']]),
    });

    expect(update).toMatchObject({
      nextPreview: 'cached complete',
      nextPreviewSourceTs: 200,
    });
  });

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
        oldestVisibleReplyEventId: '$cached-reply',
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
        expectedReplyCountSnapshotTs: 175,
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
      expectedReplyCountSnapshotTs: 175,
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    });
  });

  it('uses the durable reply total instead of capping the count at the cached tail slice', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const room = makeRoom([rootEvent]);
    const cachedTail = Array.from({ length: 32 }, (_, index) => ({
      event_id: `$cached-reply-${index}`,
      origin_server_ts: 100 + index,
      sender: '@cached:example.org',
      content: { body: `Cached reply ${index}`, msgtype: 'm.text' },
      threadRootId,
      relation: { rel_type: 'm.thread', event_id: threadRootId },
    }));

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room,
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: cachedTail,
        hasMoreBefore: true,
        beforeToken: 'older',
        expectedReplyCount: 282,
      },
      currentRecord: makeRecord({
        presentation: { messageCount: 13 },
        status: { replyCount: 13 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update).toMatchObject({
      nextMessageCount: 282,
      nextCacheCoverage: {
        eventCount: 32,
        expectedReplyCount: 282,
        hasMoreBackward: true,
        oldestVisibleReplyEventId: '$cached-reply-0',
      },
    });
  });

  it('adds a cached reply absent from complete-snapshot identity evidence', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const cachedTail = Array.from({ length: 33 }, (_, index) => ({
      event_id: `$cached-reply-${index}`,
      origin_server_ts: 100 + index,
      sender: '@cached:example.org',
      content: { body: `Cached reply ${index}`, msgtype: 'm.text' },
      threadRootId,
      relation: { rel_type: 'm.thread', event_id: threadRootId },
    }));
    const snapshotEventIds = cachedTail.slice(0, 32).map((event) => event.event_id);

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent]),
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: cachedTail,
        hasMoreBefore: true,
        expectedReplyCount: 282,
        expectedReplyCountEvidence: {
          knownEventIds: snapshotEventIds,
          visibleEventIds: snapshotEventIds,
        },
        relationSnapshotComplete: true,
      },
      currentRecord: makeRecord({
        presentation: { messageCount: 282 },
        status: { replyCount: 282 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update).toMatchObject({
      nextMessageCount: 283,
      nextCacheCoverage: {
        expectedReplyCount: 283,
        expectedReplyCountEvidence: {
          knownEventIds: cachedTail.map((event) => event.event_id),
          visibleEventIds: cachedTail.map((event) => event.event_id),
        },
      },
    });
    const rebuiltRecord = buildThreadRecord({
      room: makeRoom([rootEvent]),
      threadRootId,
      threadRootEvent: rootEvent,
      fallbackMessageCount: update?.nextMessageCount,
      cacheCoverage: update?.nextCacheCoverage,
    });
    expect(rebuiltRecord.presentation.messageCount).toBe(283);
  });

  it('does not let a stale lower durable count replace newer live state', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent]),
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: [],
        hasMoreBefore: false,
        expectedReplyCount: 24,
        snapshotComplete: true,
        tailLoaded: true,
      },
      currentRecord: makeRecord({
        presentation: { messageCount: 25 },
        status: { replyCount: 25 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update?.nextMessageCount).toBeUndefined();
  });

  it('does not let a stale lower durable total hide a larger concrete cached tail', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const cachedTail = Array.from({ length: 32 }, (_, index) => ({
      event_id: `$cached-reply-${index}`,
      origin_server_ts: 100 + index,
      sender: '@cached:example.org',
      content: { body: `Cached reply ${index}`, msgtype: 'm.text' },
      threadRootId,
      relation: { rel_type: 'm.thread', event_id: threadRootId },
    }));

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent]),
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: cachedTail,
        hasMoreBefore: true,
        expectedReplyCount: 24,
      },
      currentRecord: makeRecord({
        presentation: { messageCount: 13 },
        status: { replyCount: 13 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update?.nextMessageCount).toBe(32);
  });

  it('deduplicates overlapping cached page events when no durable total exists', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const cachedReply = {
      event_id: '$cached-reply',
      origin_server_ts: 100,
      sender: '@cached:example.org',
      content: { body: 'Cached reply', msgtype: 'm.text' },
      threadRootId,
      relation: { rel_type: 'm.thread', event_id: threadRootId },
    };

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent]),
      mapper: mapRawCachedEvent,
      cachedPage: { events: [cachedReply, cachedReply], hasMoreBefore: true },
      currentRecord: makeRecord({
        presentation: { messageCount: 0 },
        status: { replyCount: 0 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update?.nextMessageCount).toBe(1);
  });

  it('restores an authoritative redaction decrease from complete durable cache', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const cachedReplies = Array.from({ length: 23 }, (_, index) => ({
      event_id: `$cached-reply-${index}`,
      origin_server_ts: 100 + index,
      sender: '@cached:example.org',
      content: { body: `Cached reply ${index}`, msgtype: 'm.text' },
      threadRootId,
      relation: { rel_type: 'm.thread', event_id: threadRootId },
    }));

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent]),
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: cachedReplies,
        hasMoreBefore: false,
        expectedReplyCount: 23,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      },
      currentRecord: makeRecord({
        presentation: { messageCount: 24 },
        status: { lastActivityTs: 122, replyCount: 24 },
      }),
      currentRootEvent: rootEvent,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update?.nextMessageCount).toBe(23);
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

  it('projects freshly fetched relation events directly into overview metadata', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const replyEvent = makeEvent('$fetched-reply', {
      content: { body: 'fresh fetched reply', msgtype: 'm.text' },
      relation: { rel_type: 'm.thread', event_id: threadRootId },
      sender: '@fetched:example.org',
      threadRootId,
      ts: 120,
    });
    const room = makeRoom([rootEvent, replyEvent]);

    const update = resolveFetchedRelationOverviewUpdate({
      rootId: threadRootId,
      room,
      events: [replyEvent],
      rootEvent,
      currentRecord: makeRecord({
        presentation: {
          latestReplyPreviewText: undefined,
          messageCount: 0,
        },
        status: {
          lastActivityTs: 10,
          replyCount: 0,
        },
      }),
      beforeToken: null,
      expectedReplyCount: 1,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(update).toMatchObject({
      rootId: threadRootId,
      nextActivityTs: 120,
      nextReplyPreviewText: 'fresh fetched reply',
      nextLastSenderId: '@fetched:example.org',
      nextMessageCount: 1,
      nextCacheCoverage: {
        eventCount: 1,
        oldestTs: 120,
        oldestVisibleReplyEventId: '$fetched-reply',
        newestTs: 120,
        backwardToken: null,
        hasMoreBackward: false,
        expectedReplyCount: 1,
        expectedReplyCountSnapshotTs: expect.any(Number),
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      },
    });
  });

  it('adds a partial fetched reply absent from retained snapshot identity evidence', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const replies = ['$reply-a', '$reply-b', '$reply-new'].map((eventId, index) =>
      makeEvent(eventId, {
        relation: { rel_type: 'm.thread', event_id: threadRootId },
        threadRootId,
        ts: 100 + index,
      })
    );
    const snapshotEventIds = ['$reply-a', '$reply-b'];

    const update = resolveFetchedRelationOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent, ...replies]),
      events: replies,
      rootEvent,
      currentRecord: makeRecord({
        cache: {
          eventCount: 2,
          expectedReplyCount: 282,
          expectedReplyCountEvidence: {
            knownEventIds: snapshotEventIds,
            visibleEventIds: snapshotEventIds,
          },
          relationSnapshotComplete: true,
          tailLoaded: true,
        },
        presentation: { messageCount: 282 },
        status: { replyCount: 282 },
      }),
      expectedReplyCount: 282,
      relationSnapshotComplete: false,
      tailLoaded: true,
    });

    expect(update).toMatchObject({
      nextMessageCount: 283,
      nextCacheCoverage: {
        expectedReplyCount: 283,
        expectedReplyCountEvidence: {
          knownEventIds: replies.map((event) => event.getId()),
          visibleEventIds: replies.map((event) => event.getId()),
        },
      },
    });
    const rebuiltRecord = buildThreadRecord({
      room: makeRoom([rootEvent]),
      threadRootId,
      threadRootEvent: rootEvent,
      fallbackMessageCount: update?.nextMessageCount,
      cacheCoverage: update?.nextCacheCoverage,
    });
    expect(rebuiltRecord.presentation.messageCount).toBe(283);
  });

  it('lets an exhausted relation refresh replace a stale higher count after redaction', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const replies = Array.from({ length: 23 }, (_, index) =>
      makeEvent(`$reply-${index}`, {
        content: { body: `Reply ${index}`, msgtype: 'm.text' },
        relation: { rel_type: 'm.thread', event_id: threadRootId },
        threadRootId,
        ts: index + 20,
      })
    );

    const update = resolveFetchedRelationOverviewUpdate({
      rootId: threadRootId,
      room: makeRoom([rootEvent, ...replies]),
      events: [...replies, replies[0]],
      rootEvent,
      currentRecord: makeRecord({
        presentation: { messageCount: 24 },
        status: { replyCount: 24 },
      }),
      beforeToken: null,
      expectedReplyCount: 24,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(update).toMatchObject({
      nextMessageCount: 23,
      nextCacheCoverage: {
        eventCount: 24,
        expectedReplyCount: 23,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
      },
    });
  });
});
