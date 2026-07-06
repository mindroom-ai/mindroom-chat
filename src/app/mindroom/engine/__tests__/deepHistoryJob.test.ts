import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Direction } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { enqueueRoomDeepHistoryJob } from '../deepHistoryJob';
import { StateEvent } from '../../../../types/matrix/room';
import {
  loadCachedRoomEvent,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
} from '../../threads/cacheStore';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
} from '../../threads/threadOpenSeedCache';

const SESSION_ID = 'session-p43';

// CINNY-207 P7.2 audit finding #3: deep-history now maps each raw
// chunk event through `createPreferLiveEventMapper` before persisting.
// `findEventById` is required on the room stub (returns null → mapper
// stays on the "clone the raw event" branch for these unit fixtures,
// which never simulate a live SDK instance).
const makeRoom = (
  roomId: string,
  createSender: string,
  encrypted = false,
  liveBackToken: string | undefined = undefined
): Room =>
  ({
    roomId,
    findEventById: () => null,
    getThread: () => null,
    hasEncryptionStateEvent: () => encrypted,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return { getSender: () => createSender } as unknown as ReturnType<
            ReturnType<Room['getLiveTimeline']>['getState']
          >['getStateEvents'];
        },
      }),
      getPaginationToken: (dir: Direction) => (dir === Direction.Backward ? liveBackToken : null),
    }),
    getLastActiveTimestamp: () => 0,
  }) as unknown as Room;

type MockClient = MatrixClient & {
  __rooms: Map<string, Room>;
  __calls: Array<{ roomId: string; fromToken: string | null; limit: number | undefined }>;
};

const rawEvent = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:mindroom.chat',
  room_id: '!room:mindroom.chat',
  content: { body: id },
});

const rawThreadReply = (id: string, ts: number, threadRootId: string): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:mindroom.chat',
  room_id: '!room:mindroom.chat',
  content: {
    body: id,
    'm.relates_to': { event_id: threadRootId, rel_type: 'm.thread' },
  },
});

// CINNY-207 P7.2 audit finding #3: minimal MatrixEvent shape sufficient
// for `serializeRoomCacheEvents` on non-redaction, non-replace events —
// mirrors the identity mapper in the gap-fill test.
const identityMapper = (raw: Partial<IEvent>) => {
  const relation = (raw.content as Record<string, unknown> | undefined)?.['m.relates_to'] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  return {
    getId: () => raw.event_id ?? '',
    getType: () => raw.type,
    getTs: () => (raw.origin_server_ts as number) ?? 0,
    isRedaction: () => raw.type === 'm.room.redaction',
    isRedacted: () => Boolean(raw.unsigned?.redacted_because),
    getAssociatedId: () => (raw.content as { redacts?: string } | undefined)?.redacts,
    getRelation: () => relation ?? null,
    getUnsigned: () => raw.unsigned ?? {},
    getStateKey: () => (raw as { state_key?: string }).state_key,
    getSender: () => raw.sender,
    getContent: () => raw.content ?? {},
    getWireContent: () => raw.content ?? {},
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    // Deep-history chunks carry raw thread replies; the thread-scope
    // grouping reads `threadRootId` off the mapped event, which for a
    // raw m.thread relation resolves to the relation target.
    threadRootId: relation?.rel_type === 'm.thread' ? relation.event_id : undefined,
    event: raw,
  } as unknown as import('matrix-js-sdk').MatrixEvent;
};

const createMockClient = (
  responder: (call: number) => { end?: string; chunk: Partial<IEvent>[] }
): MockClient => {
  const rooms = new Map<string, Room>();
  const calls: MockClient['__calls'] = [];
  const client = {
    getDomain: () => 'mindroom.chat',
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    // CINNY-207 P7.2 audit finding #3: preferLive mapper is resolved via
    // this hook inside `persistRoomChunkWithPreferLive`.
    getEventMapper: () => identityMapper,
    createMessagesRequest: vi
      .fn()
      .mockImplementation(
        async (roomId: string, fromToken: string | null, limit: number, _dir: Direction) => {
          calls.push({ roomId, fromToken, limit });
          return responder(calls.length - 1);
        }
      ),
    __rooms: rooms,
    __calls: calls,
  } as unknown as MockClient;
  return client;
};

describe('enqueueRoomDeepHistoryJob (CINNY-207 P4.3)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
    clearThreadOpenSeedSnapshotsForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
    clearThreadOpenSeedSnapshotsForTests();
  });

  it('drives createMessagesRequest backward until the target is reached and persists each chunk', async () => {
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [rawEvent('$a', 1), rawEvent('$b', 2)] };
      if (call === 1) return { end: 'tok-2', chunk: [rawEvent('$c', 3)] };
      return { chunk: [] }; // end undefined → stop
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));

    const scheduler = createBackfillScheduler({ mx });
    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
      targetEventCount: 3,
    });

    // Target reached after chunk 2 (2 + 1 = 3), loop terminates.
    expect(mx.__calls.length).toBeGreaterThanOrEqual(2);
    for (const id of ['$a', '$b', '$c']) {
      // eslint-disable-next-line no-await-in-loop
      const row = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', id);
      expect(row?.event_id).toBe(id);
    }
    expect(getCacheProbeSnapshot().schedulerCompleted).toBe(1);
  });

  it('persists thread replies from swept chunks into their thread cache scopes (2026-07-06 eager-cache fix)', async () => {
    // The cold-start regression: the deep-history sweep downloads all
    // room history — thread replies included — but used to persist ONLY
    // the room scope (serializeRoomCacheEvents filters thread activity),
    // throwing the thread content away. Opening a thread then re-
    // downloaded everything the sweep had already fetched. The sweep
    // must teach the thread caches from the same chunks.
    const root = rawEvent('$root', 10);
    const reply1 = rawThreadReply('$reply-1', 20, '$root');
    const reply2 = rawThreadReply('$reply-2', 30, '$root');
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [reply2, reply1, root] };
      return { chunk: [] };
    });
    const room = makeRoom('!room:mindroom.chat', '@alice:mindroom.chat');
    mx.__rooms.set('!room:mindroom.chat', room);

    const scheduler = createBackfillScheduler({ mx });
    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
      targetEventCount: 3,
    });

    // Thread scope holds the replies, with the tail claim recorded (the
    // sweep descends from the live tail, so every encountered thread's
    // newest replies are covered) and NO completeness over-claim.
    const threadPage = await loadLatestCachedThreadEvents(
      SESSION_ID,
      '!room:mindroom.chat',
      '$root',
      10
    );
    expect(threadPage.events.map((event) => event.event_id)).toEqual(['$reply-1', '$reply-2']);
    expect(threadPage.tailLoaded).toBe(true);
    expect(threadPage.snapshotComplete).toBe(false);
    expect(threadPage.relationSnapshotComplete).toBe(false);

    // Room scope keeps its existing shape: root persisted, thread-only
    // replies still filtered out of the room slice.
    const rootRow = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$root');
    expect(rootRow?.event_id).toBe('$root');
    const replyRow = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$reply-1');
    expect(replyRow).toBeUndefined();

    // The in-memory seed store must NOT pin sweep events (a 10k-event
    // sweep would otherwise leak its whole mapped batch into memory).
    expect(getThreadOpenSeedSnapshot(room, '$root')).toHaveLength(0);
  });

  it('skips encrypted rooms without touching the network', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set(
      '!e2e:mindroom.chat',
      makeRoom('!e2e:mindroom.chat', '@alice:mindroom.chat', true)
    );
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!e2e:mindroom.chat',
    });

    expect(mx.__calls.length).toBe(0);
  });

  it('skips a federated room under the default my-server scope (historical gate)', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
    });

    expect(mx.__calls.length).toBe(0);
  });

  it('sweeps a federated focused room under all-rooms scope (PR #72 greptile: deep history skipped scope)', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
      scope: 'all-rooms',
    });

    // Gate passes -> at least one backward /messages request fires.
    expect(mx.__calls.length).toBeGreaterThan(0);
  });

  it('sweeps a federated focused room under current-room-only scope (deep history always targets the focused room)', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
      scope: 'current-room-only',
    });

    expect(mx.__calls.length).toBeGreaterThan(0);
  });

  it('deduplicates concurrent deep-history requests (AC8)', async () => {
    // Slow-response mock so both enqueues land while the first job is
    // still in-flight.
    const rooms = new Map<string, Room>();
    rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));
    const mx = {
      getDomain: () => 'mindroom.chat',
      getRoom: (roomId: string) => rooms.get(roomId) ?? null,
      createMessagesRequest: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ chunk: [] }), 30);
          })
      ),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const first = enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });
    const second = enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });
    expect(second).toBe(first);
    expect(getCacheProbeSnapshot().schedulerDeduped).toBe(1);

    await first;
  });

  it('starts from the current live-timeline backward token when one is present', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set(
      '!room:mindroom.chat',
      makeRoom('!room:mindroom.chat', '@alice:mindroom.chat', false, 'live-back-token')
    );
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
      targetEventCount: 1,
    });

    expect(mx.__calls[0]?.fromToken).toBe('live-back-token');
  });
});
