/**
 * CINNY-207 P3 gate fix: redaction thread attribution derived from SDK
 * thread sets when planRedactionCacheCleanup could not attribute.
 *
 * The docker gate on the P3.3 tip caught this: after the strip, the
 * engine no longer had a viewer's "open thread" hint. A redacted
 * reaction on a thread reply is pruned before RoomEvent.Redaction
 * fires — so the target has no m.relates_to and often no threadRootId,
 * and planRedactionCacheCleanup returned threadCacheTargetId:undefined.
 * The consequence: the redaction record persisted to the room cache
 * only, and the P1.2 I2 protection (re-application from the cached
 * redaction against stale un-pruned server copies) was silently lost
 * for thread hydration — the stop-emoji spec asserts this.
 *
 * The fix (consolidated at the plan level): planRedactionCacheCleanup
 * itself scans room.getThreads() for a thread whose unfiltered
 * timelineSet contains the redacted event id via
 * `EventTimelineSet.findEventById`. With exactly one hit, that thread
 * is used for BOTH the record deletion and the redaction-record
 * persist. Ambiguous hits (0 or >1) leave attribution unset so we
 * don't guess. Engine handler stays declarative — it just consumes
 * `plan.threadCacheTargetId`.
 *
 * These are the engine-boundary tests: they exercise the wired-up
 * engine handler end to end (dispatch → plan → deletes + persists),
 * complementing the pure-plan unit tests in
 * `redactionCacheLifecycle.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';

const persistThreadEventCacheSnapshot = vi.fn();
const persistRoomEventCacheSnapshot = vi.fn();
const deleteRoomEventsFromCache = vi.fn().mockResolvedValue(undefined);
const deleteThreadEventsFromCache = vi.fn().mockResolvedValue(undefined);
const deleteThreadEventFromCacheByEventId = vi.fn().mockResolvedValue(undefined);

vi.mock('../threads/eventRepository', () => ({
  persistThreadEventCacheSnapshot: (...args: unknown[]) =>
    persistThreadEventCacheSnapshot(...args),
  persistRoomEventCacheSnapshot: (...args: unknown[]) => persistRoomEventCacheSnapshot(...args),
  deleteRoomEventsFromCache: (...args: unknown[]) => deleteRoomEventsFromCache(...args),
  deleteThreadEventsFromCache: (...args: unknown[]) => deleteThreadEventsFromCache(...args),
  deleteThreadEventFromCacheByEventId: (...args: unknown[]) =>
    deleteThreadEventFromCacheByEventId(...args),
  // Real getThreadCacheTargetId shape not needed — the pruned redacted
  // target has neither m.relates_to nor threadRootId, so the plan's
  // hint chain returns undefined. Mock returns undefined for every
  // input to force the SDK-derived attribution path.
  getThreadCacheTargetId: () => undefined,
}));

import { createEngineWriteThrough } from './engineWriteThrough';
import type { EngineLiveEventMeta } from './types';

type FakeEvent = {
  __id: string;
  getId: () => string;
  getType: () => string;
  getRelation: () => undefined;
  getSender: () => string;
  getTs: () => number;
  getAssociatedId: () => string | undefined;
  isRedaction: () => boolean;
  threadRootId?: string;
  isThreadRoot: boolean;
};

const makeEvent = (
  id: string,
  {
    type = 'm.room.message',
    associatedId,
    threadRootId,
    isRedaction = false,
    sender = '@alice:example.org',
  }: {
    type?: string;
    associatedId?: string;
    threadRootId?: string;
    isRedaction?: boolean;
    sender?: string;
  } = {}
): FakeEvent => ({
  __id: id,
  getId: () => id,
  getType: () => type,
  getRelation: () => undefined,
  getSender: () => sender,
  getTs: () => 0,
  getAssociatedId: () => associatedId,
  isRedaction: () => isRedaction,
  threadRootId,
  isThreadRoot: false,
});

const makeThread = (rootId: string, timelineEvents: FakeEvent[]): Thread =>
  ({
    id: rootId,
    getUnfilteredTimelineSet: () => ({
      // planRedactionCacheCleanup uses findEventById (SDK's own event
      // index). Kept `getLiveTimeline().getEvents()` too because the
      // engine's `collectRoomEventIds` also walks it to build the
      // candidateParentIds set for the aggregation scrub.
      findEventById: (eventId: string) =>
        timelineEvents.find((mEvent) => mEvent.getId() === eventId) as
          | MatrixEvent
          | undefined,
      getLiveTimeline: () => ({
        getEvents: () => timelineEvents as unknown as MatrixEvent[],
      }),
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    }),
  } as unknown as Thread);

const makeRoom = ({
  events,
  threads = [],
}: {
  events: Record<string, FakeEvent>;
  threads?: Thread[];
}): Room =>
  ({
    roomId: '!room:example.org',
    findEventById: (id: string) => events[id] as unknown as MatrixEvent | undefined,
    getThread: (id: string) => threads.find((t) => (t as unknown as { id: string }).id === id),
    getThreads: () => threads,
    getLiveTimeline: () => ({ getEvents: () => [] }) as never,
    getUnfilteredTimelineSet: () =>
      ({
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      } as never),
  } as unknown as Room);

const redactionMeta = (): EngineLiveEventMeta => ({
  kind: 'redaction',
  roomId: '!room:example.org',
});

describe('engineWriteThrough redaction thread attribution (CINNY-207 P3 gate)', () => {
  beforeEach(() => {
    persistThreadEventCacheSnapshot.mockReset();
    persistRoomEventCacheSnapshot.mockReset();
    deleteRoomEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventFromCacheByEventId.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists the redaction to thread scope when the pruned reaction lives in exactly one thread timelineSet (stop-emoji case)', () => {
    // Reaction is already pruned: no m.relates_to, no threadRootId, but
    // it's still present in the thread's unfilteredTimelineSet — that
    // is what the SDK-derived attribution scan finds.
    const prunedReaction = makeEvent('$reaction', { type: 'm.reaction' });
    const thread = makeThread('$thread-root', [prunedReaction]);
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });
    const room = makeRoom({
      events: { $reaction: prunedReaction, $redaction: redaction },
      threads: [thread],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());

    // Redaction record persisted to the thread scope (not room-only).
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe('$thread-root');
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([redaction]);
    // SDK-derived attribution is authoritative — no belt-and-braces
    // room persist (that would double-store the redaction).
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
    // Reaction record deleted from the derived thread scope, not the
    // event-id fallback path.
    expect(deleteThreadEventsFromCache).toHaveBeenCalledTimes(1);
    expect(deleteThreadEventsFromCache.mock.calls[0][1]).toBe('!room:example.org');
    expect(deleteThreadEventsFromCache.mock.calls[0][2]).toBe('$thread-root');
    expect(deleteThreadEventsFromCache.mock.calls[0][3]).toEqual(['$reaction']);
    expect(deleteThreadEventFromCacheByEventId).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).toHaveBeenCalledTimes(1);
  });

  it('falls back to the by-event-id delete and room-scope persist when no thread claims the redacted event id (genuine room-level redaction)', () => {
    const prunedTarget = makeEvent('$msg', { type: 'm.room.message' });
    // No thread timelineSet contains $msg.
    const otherThread = makeThread('$other-thread', [
      makeEvent('$unrelated', { type: 'm.room.message' }),
    ]);
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$msg',
    });
    const room = makeRoom({
      events: { $msg: prunedTarget, $redaction: redaction },
      threads: [otherThread],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());

    // Target is a message (not reaction) → deleteRecords is false, so
    // no delete calls. Redaction record persists to room scope only
    // because no thread attribution exists.
    expect(deleteThreadEventsFromCache).not.toHaveBeenCalled();
    expect(deleteThreadEventFromCacheByEventId).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).not.toHaveBeenCalled();
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();
    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].events).toEqual([redaction]);
  });

  it('leaves attribution unset when the redacted event id appears in multiple thread timelineSets (ambiguous — falls back to room scope)', () => {
    // Defensive guard: an aggregated reaction may end up mirrored
    // across multiple thread timelineSets in weird SDK states. We
    // don't want to guess which thread it belongs to; fall back to
    // room scope so hydration at least has something to work with.
    const prunedReaction = makeEvent('$reaction', { type: 'm.reaction' });
    const threadA = makeThread('$thread-a', [prunedReaction]);
    const threadB = makeThread('$thread-b', [prunedReaction]);
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });
    const room = makeRoom({
      events: { $reaction: prunedReaction, $redaction: redaction },
      threads: [threadA, threadB],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());

    // No thread-scoped persist — ambiguous.
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();
    // Fell back to the by-event-id delete for the reaction and to
    // room-scope persist for the redaction record itself.
    expect(deleteThreadEventFromCacheByEventId).toHaveBeenCalledTimes(1);
    expect(deleteThreadEventFromCacheByEventId.mock.calls[0][2]).toBe('$reaction');
    expect(deleteThreadEventsFromCache).not.toHaveBeenCalled();
    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].events).toEqual([redaction]);
  });
});
