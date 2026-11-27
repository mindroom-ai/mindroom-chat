import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, createClient, MatrixEvent, Room, RoomEvent, SyncState } from 'matrix-js-sdk';
import type { MatrixClient } from 'matrix-js-sdk';

const persistChunkMock = vi.hoisted(() => ({
  fn: vi.fn(),
  real: undefined as
    typeof import('../../cache/eventRepository').persistRoomChunkWithPreferLive | undefined,
}));
const mockPersistRoomChunk = persistChunkMock.fn;
vi.mock('../../cache/eventRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cache/eventRepository')>();
  persistChunkMock.real = actual.persistRoomChunkWithPreferLive;
  return {
    ...actual,
    persistRoomChunkWithPreferLive: persistChunkMock.fn,
  };
});

import { createSessionId } from '../../../matrix/session/sessions';
import { createSyncEngine } from '../syncEngine';
import {
  createEngineGapTracker,
  type EngineGapTracker,
  type GapFillJob,
} from '../engineGapTracker';
import { resetCacheProbe } from '../../cache/cacheProbe';
import {
  getCacheHealth,
  isCacheWritable,
  reportCacheWriteError,
  resetCacheHealthForTesting,
} from '../../cache/cacheHealth';
import {
  CACHE_STORE_DB_VERSION,
  getCacheStoreDbName,
  hasUnsavedRoomCacheGap,
  holdUnsavedRoomCacheGap,
  loadLatestCachedRoomEvents,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
  resetCacheStoreForTesting,
  revokeRoomCacheStoreWrites,
} from '../../cache/db';

type Listener = (...args: unknown[]) => void;

type MockClient = MatrixClient & {
  __emit: (event: string, ...args: unknown[]) => void;
};

const createMockClient = (syncState: SyncState = SyncState.Syncing): MockClient => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: vi.fn((event: string, handler: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(event, set);
    }),
    removeListener: vi.fn((event: string, handler: Listener) => {
      listeners.get(event)?.delete(handler);
    }),
    getSyncState: () => syncState,
    getHomeserverUrl: () => 'https://example.test',
    getSafeUserId: () => '@alice:example.test',
    __emit(event: string, ...args: unknown[]) {
      Array.from(listeners.get(event) ?? []).forEach((handler) => handler(...args));
    },
  } as unknown as MockClient;
};

const makeStubGapTracker = (): EngineGapTracker => ({
  handleTimelineReset: vi.fn(),
  handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
});

const makeMockRoom = (roomId: string, targets?: Map<string, MatrixEvent>): Room =>
  ({
    roomId,
    findEventById: (id: string) => targets?.get(id),
    getThread: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getUnfilteredTimelineSet: () => undefined,
    getThreads: () => [],
    threadsTimelineSets: [],
  }) as unknown as Room;

const makeMockEvent = (id: string, opts?: { threadRootId?: string; redacts?: string }) =>
  ({
    getId: () => id,
    event: { event_id: id },
    getRelation: () => undefined,
    getSender: () => '@alice:example.test',
    getTs: () => 0,
    getType: () => 'm.room.message',
    threadRootId: opts?.threadRootId,
    isRedaction: () => !!opts?.redacts,
    getAssociatedId: () => opts?.redacts,
    getContent: () => (opts?.redacts ? { redacts: opts.redacts } : {}),
  }) as unknown as MatrixEvent;

const makeRealClient = (userId: string) => {
  const mx = createClient({ baseUrl: 'https://example.test', userId });
  vi.spyOn(mx, 'getSyncState').mockReturnValue(SyncState.Syncing);
  return mx;
};

const makeTextEvent = (roomId: string, eventId: string, sender: string, ts: number) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: roomId,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: eventId },
  });

const emitLiveTimeline = (mx: MatrixClient, room: Room, event: MatrixEvent) => {
  mx.emit(RoomEvent.Timeline, event, room, false, false, {
    liveEvent: true,
    timeline: room.getLiveTimeline(),
  });
};

describe('liveWriteQueue & SyncEngine IDB isolation', () => {
  beforeEach(() => {
    resetCacheProbe();
    mockPersistRoomChunk.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCacheProbe();
    resetCacheStoreForTesting();
    resetCacheHealthForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('coalesces same-turn live writes per (room, thread) and drains single-flight', async () => {
    const mx = createMockClient();
    const engine = createSyncEngine({ mx, gapTracker: makeStubGapTracker() });
    engine.start();

    let inFlight = 0;
    let maxInFlight = 0;
    const calls: { roomId: string; threadId?: string; roomTailLoaded?: boolean; ids: string[] }[] =
      [];
    const targets = new Map<string, MatrixEvent>([
      ['$target-1', makeMockEvent('$target-1')],
      ['$target-2', makeMockEvent('$target-2')],
    ]);
    const r1 = makeMockRoom('!r1', targets);
    const r2 = makeMockRoom('!r2');

    mockPersistRoomChunk.mockImplementation(
      async (args: {
        room: Room;
        threadId?: string;
        roomTailLoaded?: boolean;
        mappedEvents?: MatrixEvent[];
      }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push({
          roomId: args.room.roomId,
          threadId: args.threadId,
          roomTailLoaded: args.roomTailLoaded,
          ids: (args.mappedEvents ?? []).map((event) => event.getId() ?? ''),
        });
        // Event arriving for queued !r2 while !r1 is in flight coalesces into !r2's batch.
        if (calls.length === 1) {
          mx.__emit(RoomEvent.Timeline, makeMockEvent('$b2'), r2, false, false, {
            liveEvent: true,
          });
        }
        await Promise.resolve();
        inFlight -= 1;
        return undefined;
      }
    );

    mx.__emit(RoomEvent.Timeline, makeMockEvent('$a1'), r1, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.Timeline, makeMockEvent('$a2'), r1, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.Timeline, makeMockEvent('$b1'), r2, false, false, { liveEvent: true });
    // Thread $t1 gets redaction (undefined) + live reply (true) + redaction (undefined): true dominates both ways.
    mx.__emit(RoomEvent.Redaction, makeMockEvent('$red-t1', { redacts: '$target-1' }), r1, '$t1');
    mx.__emit(
      RoomEvent.Timeline,
      makeMockEvent('$t1-reply', { threadRootId: '$t1' }),
      r1,
      false,
      false,
      { liveEvent: true }
    );
    mx.__emit(
      RoomEvent.Redaction,
      makeMockEvent('$red-t1-after', { redacts: '$target-1' }),
      r1,
      '$t1'
    );
    // Thread $t2 gets only a redaction: must pass roomTailLoaded=false (no upgrade to true).
    mx.__emit(RoomEvent.Redaction, makeMockEvent('$red-t2', { redacts: '$target-2' }), r1, '$t2');

    expect(mockPersistRoomChunk).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual([
      { roomId: '!r1', threadId: undefined, roomTailLoaded: false, ids: ['$a1', '$a2'] },
      { roomId: '!r2', threadId: undefined, roomTailLoaded: false, ids: ['$b1', '$b2'] },
      {
        roomId: '!r1',
        threadId: '$t1',
        roomTailLoaded: true,
        ids: ['$red-t1', '$t1-reply', '$red-t1-after'],
      },
      { roomId: '!r1', threadId: '$t2', roomTailLoaded: false, ids: ['$red-t2'] },
    ]);
    engine.stop();
  });

  it('drops pre-clear events on lease revocation, drains immediately on pagehide, and clears on stop()', async () => {
    const windowListeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: () => void) => windowListeners.set(type, listener),
      removeEventListener: (type: string) => windowListeners.delete(type),
    });
    const mx = createMockClient();
    const engine = createSyncEngine({ mx, gapTracker: makeStubGapTracker() });
    engine.start();

    const r1 = makeMockRoom('!r1');
    mx.__emit(RoomEvent.Timeline, makeMockEvent('$stale'), r1, false, false, { liveEvent: true });
    revokeRoomCacheStoreWrites(engine.sessionId, '!r1');
    mx.__emit(RoomEvent.Timeline, makeMockEvent('$fresh'), r1, false, false, { liveEvent: true });
    expect(mockPersistRoomChunk).not.toHaveBeenCalled();

    // pagehide drains synchronously with only the post-clear event.
    windowListeners.get('pagehide')?.();
    expect(mockPersistRoomChunk).toHaveBeenCalledTimes(1);
    expect(
      (mockPersistRoomChunk.mock.calls[0]![0] as { mappedEvents: MatrixEvent[] }).mappedEvents.map(
        (event) => event.getId()
      )
    ).toEqual(['$fresh']);

    // stop() drops queued events before any microtask can drain them.
    mockPersistRoomChunk.mockClear();
    mx.__emit(RoomEvent.Timeline, makeMockEvent('$dropped'), r1, false, false, { liveEvent: true });
    engine.stop();
    await Promise.resolve();
    expect(mockPersistRoomChunk).not.toHaveBeenCalled();
  });

  it('commits ready rooms to IndexedDB while another room gap marker retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetCacheStoreForTesting();
    resetCacheHealthForTesting();
    mockPersistRoomChunk.mockImplementation(persistChunkMock.real!);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const userId = '@alice:example.test';
    const mx = makeRealClient(userId);
    const roomA = new Room('!roomA:example.test', mx, userId);
    const roomB = new Room('!roomB:example.test', mx, userId);
    mx.store.storeRoom(roomA);
    mx.store.storeRoom(roomB);

    let failRoomAOnce = true;
    const gapTracker = createEngineGapTracker({
      mx,
      sessionId: createSessionId('https://example.test', userId),
      enqueueGapFill: () => undefined,
      markDiscontinuity: async (sessionId, roomId, marker) => {
        if (roomId === roomA.roomId && failRoomAOnce) {
          failRoomAOnce = false;
          throw new Error('transient meta write error');
        }
        return markRoomTailDiscontinuity(sessionId, roomId, marker);
      },
    });
    const engine = createSyncEngine({ mx, gapTracker });
    engine.start();

    try {
      mx.emit(RoomEvent.TimelineReset, roomA, roomA.getUnfilteredTimelineSet(), false);
      emitLiveTimeline(mx, roomA, makeTextEvent(roomA.roomId, '$a1', userId, 100));
      emitLiveTimeline(mx, roomA, makeTextEvent(roomA.roomId, '$a2', userId, 102));
      emitLiveTimeline(mx, roomB, makeTextEvent(roomB.roomId, '$b1', userId, 101));

      // Room A's marker failed onto backoff; Room B must still commit to IDB first.
      await vi.waitFor(async () => {
        const cachedB = await loadLatestCachedRoomEvents(engine.sessionId, roomB.roomId, 10);
        expect(cachedB.events.map((event) => event.event_id)).toEqual(['$b1']);
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(await loadRoomTailDiscontinuity(engine.sessionId, roomA.roomId)).toBeUndefined();
      expect((await loadLatestCachedRoomEvents(engine.sessionId, roomA.roomId, 10)).events).toEqual(
        []
      );

      // Once Room A's retry succeeds, both its marker and its coalesced live messages commit.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(async () => {
        const cachedA = await loadLatestCachedRoomEvents(engine.sessionId, roomA.roomId, 10);
        expect(cachedA.events.map((event) => event.event_id)).toEqual(['$a1', '$a2']);
      });
      expect(await loadRoomTailDiscontinuity(engine.sessionId, roomA.roomId)).toBeDefined();
    } finally {
      engine.stop();
    }
  });

  it('isolates VersionError to the affected account while another account keeps persisting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetCacheStoreForTesting();
    resetCacheHealthForTesting();
    mockPersistRoomChunk.mockImplementation(persistChunkMock.real!);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const aliceId = '@alice:example.test';
    const bobId = '@bob:example.test';
    const mxA = makeRealClient(aliceId);
    const mxB = makeRealClient(bobId);
    const roomA1 = new Room('!roomA1:example.test', mxA, aliceId);
    const roomA2 = new Room('!roomA2:example.test', mxA, aliceId);
    const roomB = new Room('!roomB:example.test', mxB, bobId);
    mxA.store.storeRoom(roomA1);
    mxA.store.storeRoom(roomA2);
    mxB.store.storeRoom(roomB);

    const sessionA = createSessionId('https://example.test', aliceId);
    const dbNameA = getCacheStoreDbName(sessionA);
    // Seed Account A with a newer schema version so only Account A hits VersionError.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbNameA, CACHE_STORE_DB_VERSION + 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const openSpy = vi.spyOn(indexedDB, 'open');
    const engineA = createSyncEngine({ mx: mxA });
    const engineB = createSyncEngine({ mx: mxB });
    engineA.start();
    engineB.start();
    const releaseA2 = holdUnsavedRoomCacheGap(engineA.sessionId, roomA2.roomId);

    try {
      mxA.emit(RoomEvent.TimelineReset, roomA1, roomA1.getUnfilteredTimelineSet(), false);
      emitLiveTimeline(mxA, roomA1, makeTextEvent(roomA1.roomId, '$a1-pre', aliceId, 100));
      emitLiveTimeline(mxA, roomA2, makeTextEvent(roomA2.roomId, '$a2-pre', aliceId, 101));

      await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
      expect(hasUnsavedRoomCacheGap(engineA.sessionId, roomA1.roomId)).toBe(true);
      expect(isCacheWritable()).toBe(true);
      expect(getCacheHealth()).toEqual({ state: 'healthy' });

      // Account A stops retrying VersionError; no 30s timer loop opens its DB again.
      const opensForAAfterError = openSpy.mock.calls.filter(([name]) => name === dbNameA).length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(openSpy.mock.calls.filter(([name]) => name === dbNameA).length).toBe(
        opensForAAfterError
      );

      // Post-error events for Account A are dropped immediately and releasing roomA2 drains nothing.
      emitLiveTimeline(mxA, roomA1, makeTextEvent(roomA1.roomId, '$a1-post', aliceId, 102));
      emitLiveTimeline(mxA, roomA2, makeTextEvent(roomA2.roomId, '$a2-post', aliceId, 103));
      releaseA2();
      await Promise.resolve();
      await Promise.resolve();
      const accountAPersistCalls = mockPersistRoomChunk.mock.calls.filter(
        ([args]) => (args as { sessionId: string }).sessionId === engineA.sessionId
      );
      expect(accountAPersistCalls).toEqual([]);

      // Account B in the same page is unaffected and still persists live messages to IDB.
      emitLiveTimeline(mxB, roomB, makeTextEvent(roomB.roomId, '$b1', bobId, 200));
      await vi.waitFor(async () => {
        const cachedB = await loadLatestCachedRoomEvents(engineB.sessionId, roomB.roomId, 10);
        expect(cachedB.events.map((event) => event.event_id)).toEqual(['$b1']);
      });
    } finally {
      releaseA2();
      engineA.stop();
      engineB.stop();
    }
  });

  it('persists gap markers after attachment quota read-only so startup enqueues gap fill', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetCacheStoreForTesting();
    resetCacheHealthForTesting();
    mockPersistRoomChunk.mockImplementation(persistChunkMock.real!);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const userId = '@alice:example.test';
    const mx = makeRealClient(userId);
    const room = new Room('!roomQ:example.test', mx, userId);
    room.updateMyMembership('join');
    mx.store.storeRoom(room);

    // An attachment quota failure degrades cacheHealth origin-wide to read-only.
    reportCacheWriteError('attachment.save', new DOMException('quota', 'QuotaExceededError'));
    expect(isCacheWritable()).toBe(false);

    const engine = createSyncEngine({ mx });
    engine.start();

    try {
      mx.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), false);
      emitLiveTimeline(mx, room, makeTextEvent(room.roomId, '$dropped-live', userId, 100));

      // The small gap marker still commits to IndexedDB despite read-only mode.
      await vi.waitFor(async () => {
        expect(await loadRoomTailDiscontinuity(engine.sessionId, room.roomId)).toBeDefined();
      });
      expect(hasUnsavedRoomCacheGap(engine.sessionId, room.roomId)).toBe(false);
      // Live event persistence stays skipped while read-only.
      expect((await loadLatestCachedRoomEvents(engine.sessionId, room.roomId, 10)).events).toEqual(
        []
      );
    } finally {
      engine.stop();
    }

    // Subsequent startup reads the durable gap marker and enqueues the gap fill.
    resetCacheHealthForTesting();
    const startupJobs: GapFillJob[] = [];
    const startupTracker = createEngineGapTracker({
      mx,
      sessionId: engine.sessionId,
      enqueueGapFill: (job) => startupJobs.push(job),
    });
    const startupEngine = createSyncEngine({ mx, gapTracker: startupTracker });
    startupEngine.start();
    try {
      mx.emit(ClientEvent.Sync, SyncState.Prepared, null, {});
      await vi.waitFor(() =>
        expect(startupJobs).toEqual([
          expect.objectContaining({
            roomId: room.roomId,
            reason: 'startup',
          }),
        ])
      );
    } finally {
      startupEngine.stop();
    }
  });
});
