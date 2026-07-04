import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, RoomEvent, SyncState } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createMindroomSyncEngine } from '../mindroomSyncEngine';
import type { EngineWriteThrough } from '../engineWriteThrough';
import type { EngineGapTracker } from '../engineGapTracker';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

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
    __setSyncState(state: SyncState | null) {
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

const makeRoom = (roomId: string): Room => ({ roomId } as unknown as Room);
const makeEvent = (): MatrixEvent => ({} as unknown as MatrixEvent);

describe('MindroomSyncEngine (CINNY-207 P3.1)', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  afterEach(() => {
    resetCacheProbe();
  });

  it('derives sessionId from client baseUrl + safe user id', () => {
    const mx = createMockClient();
    const engine = createMindroomSyncEngine({ mx });
    // Matches createSessionId shape: encoded baseUrl + '::' + encoded userId
    expect(engine.sessionId).toContain(encodeURIComponent('https://example.test'));
    expect(engine.sessionId).toContain(encodeURIComponent('@alice:example.test'));
  });

  it('is idempotent: repeated start()/stop() calls attach and detach listeners exactly once', () => {
    const mx = createMockClient();
    const engine = createMindroomSyncEngine({ mx });

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

  it('removes every listener it attached on stop() (full symmetry)', () => {
    const mx = createMockClient();
    const engine = createMindroomSyncEngine({ mx });

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
    const engine = createMindroomSyncEngine({ mx });
    engine.start();

    // Pre-Prepared: the timeline event should NOT reach write-through.
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(0);
    expect(engine.isLiveMode()).toBe(false);

    // Flip live via Sync -> PREPARED
    mx.__emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(engine.isLiveMode()).toBe(true);

    // Now live events should dispatch and bump the probe.
    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(1);

    // Simulate a reconnect. liveMode must NOT flip back false — reconnect
    // events are exactly the ones we want to keep persisting.
    mx.__emit(ClientEvent.Sync, SyncState.Reconnecting, SyncState.Syncing);
    expect(engine.isLiveMode()).toBe(true);

    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(2);

    engine.stop();
    // After stop(), liveMode resets so a subsequent start() waits for a
    // fresh Prepared/Syncing signal (account switch semantics).
    expect(engine.isLiveMode()).toBe(false);
  });

  it('primes liveMode from getSyncState() on start() for warm clients', () => {
    const mx = createMockClient(SyncState.Syncing);
    const engine = createMindroomSyncEngine({ mx });
    engine.start();
    expect(engine.isLiveMode()).toBe(true);

    mx.__emit(RoomEvent.Timeline, makeEvent(), makeRoom('!r1'), false, false, {
      liveEvent: true,
    });
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(1);
  });

  it('ignores non-live events even after liveMode: backfill, removed, non-liveEvent, missing room', () => {
    const mx = createMockClient(SyncState.Syncing);
    const engine = createMindroomSyncEngine({ mx });
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

    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(0);
  });

  it('dispatches redactions through the write-through layer once live', () => {
    const mx = createMockClient(SyncState.Syncing);
    const engine = createMindroomSyncEngine({ mx });
    engine.start();

    mx.__emit(RoomEvent.Redaction, makeEvent(), makeRoom('!r1'));
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(1);

    // Redaction without a room is a no-op.
    mx.__emit(RoomEvent.Redaction, makeEvent(), undefined);
    expect(getCacheProbeSnapshot().engineLiveWrites).toBe(1);
  });

  it('drives the gap tracker on TimelineReset and Sync=PREPARED', () => {
    const mx = createMockClient();
    const gapTracker: EngineGapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn(),
      stop: vi.fn(),
    };
    const engine = createMindroomSyncEngine({ mx, gapTracker });
    engine.start();

    mx.__emit(ClientEvent.Sync, SyncState.Prepared, null);
    expect(gapTracker.handleSyncPrepared).toHaveBeenCalledTimes(1);

    mx.__emit(RoomEvent.TimelineReset);
    expect(gapTracker.handleTimelineReset).toHaveBeenCalledTimes(1);

    engine.stop();
    expect(gapTracker.stop).toHaveBeenCalledTimes(1);
  });

  it('flushes the write-through on stop() (drain-before-teardown contract)', () => {
    const mx = createMockClient();
    const writeThrough: EngineWriteThrough = {
      handleLiveEvent: vi.fn(),
      flush: vi.fn(),
    };
    const engine = createMindroomSyncEngine({ mx, writeThrough });
    engine.start();
    engine.stop();
    expect(writeThrough.flush).toHaveBeenCalled();
  });
});
