import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, RoomEvent, SyncState } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';

const mockPersistRoomChunk = vi.hoisted(() => vi.fn());
vi.mock('../../cache/eventRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cache/eventRepository')>();
  return {
    ...actual,
    persistRoomChunkWithPreferLive: mockPersistRoomChunk,
  };
});

import { createSyncEngine, stopSyncEngineForClient } from '../syncEngine';
import type { EngineWriteThrough } from '../engineWriteThrough';
import type { EngineGapTracker } from '../engineGapTracker';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../cache/cacheProbe';
import { revokeRoomCacheStoreWrites } from '../../cache/db';

/**
 * Compact SDK mock. The engine only calls `on`, `removeListener`,
 * `getSyncState`, `getHomeserverUrl`, and `getSafeUserId` on the
 * client — enough to exercise attach/detach and the liveMode gate
 * without pulling in the full SDK.
 */
type Listener = (...args: unknown[]) => void;
type MockClient = MatrixClient & {
  __listeners: Map<string, Set<Listener>>;
  __syncState: SyncState | null;
  __setSyncState(state: SyncState | null): void;
  __emit(event: string, ...args: unknown[]): void;
};

const createMockClient = (initialSyncState: SyncState | null = null): MockClient => {
  const listeners = new Map<string, Set<Listener>>();
  let syncState: SyncState | null = initialSyncState;

  const on = vi.fn((event: string, handler: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
  });
  const removeListener = vi.fn((event: string, handler: Listener) => {
    listeners.get(event)?.delete(handler);
  });

  const client = {
    on,
    removeListener,
    getSyncState: () => syncState,
    getHomeserverUrl: () => 'https://example.test',
    getSafeUserId: () => '@alice:example.test',
    __listeners: listeners,
    __syncState: syncState,
    __setSyncState(this: MockClient, state: SyncState | null) {
      syncState = state;
      this.__syncState = state;
    },
    __emit(event: string, ...args: unknown[]) {
      const set = listeners.get(event);
      if (!set) return;
      // Snapshot to avoid mutation-during-iteration surprises.
      Array.from(set).forEach((handler) => handler(...args));
    },
  } as unknown as MockClient;

  return client;
};

const makeRoom = (roomId: string): Room =>
  ({
    roomId,
    findEventById: () => undefined,
    getThread: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getUnfilteredTimelineSet: () => undefined,
    getThreads: () => [],
  }) as unknown as Room;

const makeEvent = (): MatrixEvent =>
  ({
    getId: () => '$id',
    getRelation: () => undefined,
    getSender: () => '@alice:example.org',
    getTs: () => 0,
    isRedaction: () => false,
    getAssociatedId: () => undefined,
    threadRootId: undefined,
  }) as unknown as MatrixEvent;

describe('SyncEngine (ISSUE-207 P3.1)', () => {
  beforeEach(() => {
    resetCacheProbe();
    mockPersistRoomChunk.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetCacheProbe();
    vi.restoreAllMocks();
  });

  it('derives sessionId from client baseUrl + safe user id', () => {
    const mx = createMockClient();
    const engine = createSyncEngine({ mx });
    // Matches createSessionId shape: encoded baseUrl + '::' + encoded userId
    expect(engine.sessionId).toContain(encodeURIComponent('https://example.test'));
    expect(engine.sessionId).toContain(encodeURIComponent('@alice:example.test'));
  });

  it('is idempotent: repeated start()/stop() calls attach and detach listeners exactly once', () => {
    const mx = createMockClient();
    const engine = createSyncEngine({ mx });

    engine.start();
    engine.start();
    engine.start();

    // Four SDK listeners: ClientEvent.Sync + 3 RoomEvent.*
    expect(mx.__listeners.get(ClientEvent.Sync)?.size).toBe(1);
    expect(mx.__listeners.get(RoomEvent.Timeline)?.size).toBe(1);
    expect(mx.__listeners.get(RoomEvent.Redaction)?.size).toBe(1);
    expect(mx.__listeners.get(RoomEvent.TimelineReset)?.size).toBe(1);

    engine.stop();
    engine.stop();

    expect(mx.__listeners.get(ClientEvent.Sync)?.size ?? 0).toBe(0);
    expect(mx.__listeners.get(RoomEvent.Timeline)?.size ?? 0).toBe(0);
    expect(mx.__listeners.get(RoomEvent.Redaction)?.size ?? 0).toBe(0);
    expect(mx.__listeners.get(RoomEvent.TimelineReset)?.size ?? 0).toBe(0);
  });

  it('can stop the active engine from a destructive client cleanup path', () => {
    const mx = createMockClient();
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();

    stopSyncEngineForClient(mx);
    stopSyncEngineForClient(mx);

    expect(writeThrough.flush).toHaveBeenCalledTimes(1);
    expect(mx.__listeners.get(ClientEvent.Sync)?.size ?? 0).toBe(0);
  });

  it('finishes structural teardown when the final write flush throws', () => {
    const mx = createMockClient(SyncState.Syncing);
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(() => {
        throw new Error('flush failed');
      }),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();

    expect(() => engine.stop()).toThrow('flush failed');

    expect(engine.isLiveMode()).toBe(false);
    expect(mx.__listeners.get(ClientEvent.Sync)?.size ?? 0).toBe(0);
    expect(mx.__listeners.get(RoomEvent.Timeline)?.size ?? 0).toBe(0);
    expect(() => stopSyncEngineForClient(mx)).not.toThrow();
  });

  it('removes every listener it attached on stop() (full symmetry)', () => {
    const mx = createMockClient();
    const engine = createSyncEngine({ mx });

    engine.start();
    // `on` invocation count === `removeListener` invocation count after stop.
    const attachCount = (mx.on as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    engine.stop();
    const detachCount = (mx.removeListener as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    expect(detachCount).toBe(attachCount);
  });

  it('skips live event dispatch until sync state reaches Prepared/Syncing/Catchup (liveMode gate)', () => {
    const mx = createMockClient();
    // Use a stub write-through so the plumbing test does not exercise
    // the real persist path (which needs richer event stubs).
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();

    // Pre-Prepared: the timeline event should NOT reach write-through.
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(writeThrough.handleLiveEvent).not.toHaveBeenCalled();
    expect(engine.isLiveMode()).toBe(false);

    // Flip live via Sync -> PREPARED
    mx.__emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(engine.isLiveMode()).toBe(true);

    // Now live events should dispatch.
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(1);

    // Simulate a reconnect. liveMode must NOT flip back false — reconnect
    // events are exactly the ones we want to keep persisting.
    mx.__emit(ClientEvent.Sync, SyncState.Reconnecting, SyncState.Syncing);
    expect(engine.isLiveMode()).toBe(true);

    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(2);

    engine.stop();
    // After stop(), liveMode resets so a subsequent start() waits for a
    // fresh Prepared/Syncing signal (account switch semantics).
    expect(engine.isLiveMode()).toBe(false);

    // Probe counter is bumped by the real write-through; this test uses
    // a stub, so the probe stays at zero (verified elsewhere in
    // engineWriteThrough.compaction.test.ts).
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(0);
  });

  it('primes liveMode from getSyncState() on start() for warm clients', () => {
    const mx = createMockClient(SyncState.Syncing);
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();
    expect(engine.isLiveMode()).toBe(true);

    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('ignores non-live events even after liveMode: backfill, removed, non-liveEvent, missing room', () => {
    const mx = createMockClient(SyncState.Syncing);
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();

    // Missing room
    mx.__emit(RoomEvent.Timeline, makeEvent(), undefined, false, false, { liveEvent: true });
    // Backfill (toStartOfTimeline === true)
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), true, false, { liveEvent: true });
    // Removed (pending event teardown)
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, true, { liveEvent: true });
    // IDB replay (liveEvent: false)
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, { liveEvent: false });
    // Missing data
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, undefined);

    expect(writeThrough.handleLiveEvent).not.toHaveBeenCalled();
    engine.stop();
  });

  it('saves a confirmed local echo once, except redactions and events a timeline saved', () => {
    const mx = createMockClient(SyncState.Syncing);
    const writeThrough: EngineWriteThrough = { handleLiveEvent: vi.fn(), flush: vi.fn() };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();
    const room = makeRoom('!r1');
    const confirmed = (overrides: Partial<MatrixEvent> = {}) =>
      ({ ...makeEvent(), status: null, ...overrides }) as unknown as MatrixEvent;

    // Still pending, and an update without a previous status.
    mx.__emit(
      RoomEvent.LocalEchoUpdated,
      { ...makeEvent(), status: 'sent' },
      room,
      '~1',
      'sending'
    );
    mx.__emit(RoomEvent.LocalEchoUpdated, confirmed(), room, '~1', undefined);
    // The Redaction channel saves confirmed redactions.
    mx.__emit(
      RoomEvent.LocalEchoUpdated,
      confirmed({ isRedaction: () => true }),
      room,
      '~2',
      'sent'
    );
    expect(writeThrough.handleLiveEvent).not.toHaveBeenCalled();

    const message = confirmed();
    mx.__emit(RoomEvent.LocalEchoUpdated, message, room, '~3', 'sent');
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(1);
    expect(writeThrough.handleLiveEvent).toHaveBeenLastCalledWith(message, room, {
      kind: 'timeline',
      roomId: '!r1',
      liveEvent: true,
      toStartOfTimeline: false,
    });

    // A thread timeline announced this confirmed reply before its echo update.
    const threadReply = confirmed();
    mx.__emit(RoomEvent.Timeline, threadReply, room, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.LocalEchoUpdated, threadReply, room, '~4', 'sent');
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it('dispatches redactions through the write-through layer once live', async () => {
    const mx = createMockClient(SyncState.Syncing);
    const engine = createSyncEngine({ mx });
    engine.start();

    // Redaction events carry `redacts` but no relation; the real
    // engine routes them through the redaction lifecycle. For this
    // dispatch-plumbing test we swap in a WT double that counts
    // handleLiveEvent calls without exercising the full cleanup plan.
    engine.stop();
    const writeThrough = { handleLiveEvent: vi.fn(), flush: vi.fn() };
    const engine2 = createSyncEngine({ mx, writeThrough });
    engine2.start();

    mx.__emit(RoomEvent.Redaction, makeEvent(), makeRoom('!r1'));
    await vi.waitFor(() => expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(1));
    expect(writeThrough.handleLiveEvent.mock.calls[0]![2].kind).toBe('redaction');

    // Redaction without a room is a no-op.
    mx.__emit(RoomEvent.Redaction, makeEvent(), undefined);
    expect(writeThrough.handleLiveEvent).toHaveBeenCalledTimes(1);

    engine2.stop();
  });

  it('drives the gap tracker on TimelineReset and Sync=PREPARED', () => {
    const mx = createMockClient();
    const gapTracker: EngineGapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const engine = createSyncEngine({ mx, gapTracker });
    engine.start();

    mx.__emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(gapTracker.handleSyncPrepared).toHaveBeenCalledTimes(1);

    mx.__emit(RoomEvent.TimelineReset);
    expect(gapTracker.handleTimelineReset).toHaveBeenCalledTimes(1);

    engine.stop();
    expect(gapTracker.stop).toHaveBeenCalledTimes(1);
  });

  it('contains a rejected sync-prepared task at the event boundary', async () => {
    const mx = createMockClient();
    const gapTracker: EngineGapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockRejectedValue(new Error('blocked cache')),
      stop: vi.fn(),
    };
    const engine = createSyncEngine({ mx, gapTracker });
    engine.start();

    expect(() => mx.__emit(ClientEvent.Sync, SyncState.Prepared, null)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(gapTracker.handleSyncPrepared).toHaveBeenCalledTimes(1);

    engine.stop();
  });

  it('flushes the write-through on stop() (drain-before-teardown contract)', () => {
    const mx = createMockClient();
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createSyncEngine({ mx, writeThrough });
    engine.start();
    engine.stop();
    expect(writeThrough.flush).toHaveBeenCalled();
  });

  it('coalesces same-turn live writes per (room, thread) and drains single-flight', async () => {
    const mx = createMockClient(SyncState.Syncing);
    const gapTracker: EngineGapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const engine = createSyncEngine({ mx, gapTracker });
    engine.start();

    let inFlight = 0;
    let maxInFlight = 0;
    const calls: { roomId: string; threadId?: string; roomTailLoaded?: boolean; ids: string[] }[] =
      [];
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
          mx.__emit(RoomEvent.Timeline, makeLive('$b2'), r2, false, false, { liveEvent: true });
        }
        await Promise.resolve();
        inFlight -= 1;
        return undefined;
      }
    );

    const makeLive = (id: string, opts?: { threadRootId?: string; redacts?: string }) =>
      ({
        ...makeEvent(),
        getId: () => id,
        event: { event_id: id },
        threadRootId: opts?.threadRootId,
        isRedaction: () => !!opts?.redacts,
        getAssociatedId: () => opts?.redacts,
        getContent: () => (opts?.redacts ? { redacts: opts.redacts } : {}),
      }) as unknown as MatrixEvent;

    const targets = new Map<string, MatrixEvent>([
      [
        '$target-1',
        {
          ...makeEvent(),
          getId: () => '$target-1',
          getType: () => 'm.room.message',
        } as unknown as MatrixEvent,
      ],
      [
        '$target-2',
        {
          ...makeEvent(),
          getId: () => '$target-2',
          getType: () => 'm.room.message',
        } as unknown as MatrixEvent,
      ],
    ]);
    const r1 = {
      ...makeRoom('!r1'),
      findEventById: (id: string) => targets.get(id),
      threadsTimelineSets: [],
    } as unknown as Room;
    const r2 = { ...makeRoom('!r2'), threadsTimelineSets: [] } as unknown as Room;
    mx.__emit(RoomEvent.Timeline, makeLive('$a1'), r1, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.Timeline, makeLive('$a2'), r1, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.Timeline, makeLive('$b1'), r2, false, false, { liveEvent: true });
    // Thread $t1 gets redaction (undefined) + live reply (true) + redaction (undefined): true dominates both ways.
    mx.__emit(RoomEvent.Redaction, makeLive('$red-t1', { redacts: '$target-1' }), r1, '$t1');
    mx.__emit(
      RoomEvent.Timeline,
      makeLive('$t1-reply', { threadRootId: '$t1' }),
      r1,
      false,
      false,
      {
        liveEvent: true,
      }
    );
    mx.__emit(RoomEvent.Redaction, makeLive('$red-t1-after', { redacts: '$target-1' }), r1, '$t1');
    // Thread $t2 gets only a redaction: must pass roomTailLoaded=false (no upgrade to true).
    mx.__emit(RoomEvent.Redaction, makeLive('$red-t2', { redacts: '$target-2' }), r1, '$t2');

    // Still coalescing in the current turn before microtask drains.
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

  it('drops pre-clear queued events on lease revocation and awaits pre-gap overlap capture', async () => {
    const mx = createMockClient(SyncState.Syncing);
    let resolveOverlap: (() => void) | undefined;
    const gapTracker: EngineGapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
      whenOverlapCaptured: (roomId) =>
        roomId === '!r-gap'
          ? new Promise<void>((resolve) => {
              resolveOverlap = resolve;
            })
          : undefined,
      stop: vi.fn(),
    };
    const engine = createSyncEngine({ mx, gapTracker });
    engine.start();

    const makeLive = (id: string) =>
      ({ ...makeEvent(), getId: () => id, event: { event_id: id } }) as unknown as MatrixEvent;
    const rClear = { ...makeRoom('!r-clear'), threadsTimelineSets: [] } as unknown as Room;
    const rGap = { ...makeRoom('!r-gap'), threadsTimelineSets: [] } as unknown as Room;

    mx.__emit(RoomEvent.Timeline, makeLive('$stale'), rClear, false, false, { liveEvent: true });
    revokeRoomCacheStoreWrites(engine.sessionId, '!r-clear');
    mx.__emit(RoomEvent.Timeline, makeLive('$fresh'), rClear, false, false, { liveEvent: true });
    mx.__emit(RoomEvent.Timeline, makeLive('$after-reset'), rGap, false, false, {
      liveEvent: true,
    });

    await vi.waitFor(() => expect(mockPersistRoomChunk).toHaveBeenCalledTimes(1));
    expect(
      (mockPersistRoomChunk.mock.calls[0]![0] as { mappedEvents: MatrixEvent[] }).mappedEvents.map(
        (event) => event.getId()
      )
    ).toEqual(['$fresh']);
    // !r-gap must wait for whenOverlapCaptured before persisting.
    expect(resolveOverlap).toBeDefined();
    expect(mockPersistRoomChunk).toHaveBeenCalledTimes(1);

    resolveOverlap?.();
    await vi.waitFor(() => expect(mockPersistRoomChunk).toHaveBeenCalledTimes(2));
    expect(
      (mockPersistRoomChunk.mock.calls[1]![0] as { mappedEvents: MatrixEvent[] }).mappedEvents.map(
        (event) => event.getId()
      )
    ).toEqual(['$after-reset']);
    engine.stop();
  });

  it('drains queued writes immediately on pagehide and clears them on stop()', () => {
    const windowListeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: () => void) => windowListeners.set(type, listener),
      removeEventListener: (type: string) => windowListeners.delete(type),
    });
    const mx = createMockClient(SyncState.Syncing);
    const engine = createSyncEngine({
      mx,
      gapTracker: {
        handleTimelineReset: vi.fn(),
        handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
      },
    });
    engine.start();

    const makeLive = (id: string) =>
      ({ ...makeEvent(), getId: () => id, event: { event_id: id } }) as unknown as MatrixEvent;
    const r1 = { ...makeRoom('!r1'), threadsTimelineSets: [] } as unknown as Room;
    mx.__emit(RoomEvent.Timeline, makeLive('$before-hide'), r1, false, false, { liveEvent: true });
    expect(mockPersistRoomChunk).not.toHaveBeenCalled();

    // pagehide drains synchronously without waiting for the microtask.
    windowListeners.get('pagehide')?.();
    expect(mockPersistRoomChunk).toHaveBeenCalledTimes(1);

    // stop() drops newly queued events before any microtask can drain them.
    mockPersistRoomChunk.mockClear();
    mx.__emit(RoomEvent.Timeline, makeLive('$dropped'), r1, false, false, { liveEvent: true });
    engine.stop();
    vi.unstubAllGlobals();
    return Promise.resolve().then(() => {
      expect(mockPersistRoomChunk).not.toHaveBeenCalled();
    });
  });
});
