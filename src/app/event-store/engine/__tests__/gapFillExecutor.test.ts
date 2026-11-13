import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { Direction, MatrixEvent } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { STARTUP_SYNC_TIMELINE_LIMIT } from '../../../matrix/client/clientSyncPolicy';
import { createBackfillScheduler } from '../backfillScheduler';
import { createGapFillExecutor as createExecutor } from '../gapFillExecutor';
import {
  createInMemoryGapFillScheduler,
  GAP_FILL_OVERLAP_TAIL_LIMIT,
  type GapFillScheduler,
} from '../engineGapTracker';
import {
  clearRoomTailDiscontinuity,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
  loadCachedRoomEvent,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
} from '../../cache/db';
import { revokeRoomCacheStoreWrites } from '../../cache/db/cacheStoreDb';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../cache/cacheProbe';
import { persistRoomChunkWithPreferLive } from '../../cache/eventRepository';

const SESSION_ID = 'session-p42';
type ExecutorOptions = Parameters<typeof createExecutor>[0];
type ControllerCallbacks = 'pageAllowance' | 'reservePage' | 'canSavePage';

/**
 * The sync engine passes its offline controller's callbacks. This stand-in grants `events` more
 * history events, at most a page of 200 at a time, and always has space to save them.
 */
const allowance = (events = Number.POSITIVE_INFINITY) => {
  let left = events;
  const settled: number[] = [];
  return {
    settled,
    grant: (more: number) => {
      left += more;
    },
    callbacks: {
      pageAllowance: () => Math.min(200, left),
      reservePage: () => {
        const limit = Math.min(200, left);
        if (!limit) return undefined;
        return {
          limit,
          settle: (committed: number) => {
            settled.push(committed);
            left -= committed;
          },
        };
      },
      canSavePage: async () => true,
    } satisfies Pick<ExecutorOptions, ControllerCallbacks>,
  };
};

const createGapFillExecutor = (
  options: Omit<ExecutorOptions, ControllerCallbacks> &
    Partial<Pick<ExecutorOptions, ControllerCallbacks>>,
  queue: GapFillScheduler
) => createExecutor({ ...allowance().callbacks, ...options }, queue);

// `findEventById` returns null so the prefer-live mapper clones each raw chunk event.
const makeRoomStub = (roomId: string, encrypted = false): Room =>
  ({
    roomId,
    findEventById: () => null,
    getThread: () => null,
    hasEncryptionStateEvent: () => encrypted,
    getLastActiveTimestamp: () => 0,
  } as unknown as Room);

type MockClient = MatrixClient & {
  __rooms: Map<string, Room>;
  __messages: Array<{
    roomId: string;
    fromToken: string | null;
    limit: number | undefined;
    dir: Direction;
  }>;
};

const createMockClient = (
  responder: (call: number) => { end?: string; chunk: Partial<IEvent>[] }
): MockClient => {
  const rooms = new Map<string, Room>();
  const messagesCalls: MockClient['__messages'] = [];
  const client = {
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    // ISSUE-207 P7.2 audit finding #3: `persistRoomChunkWithPreferLive`
    // resolves the event mapper up front and wraps it in
    // `createPreferLiveEventMapper` before persisting each chunk.
    getEventMapper: () => (raw: Partial<IEvent>) => new MatrixEvent(raw),
    createMessagesRequest: vi
      .fn()
      .mockImplementation(
        async (roomId: string, fromToken: string | null, limit: number, dir: Direction) => {
          messagesCalls.push({ roomId, fromToken, limit, dir });
          return responder(messagesCalls.length - 1);
        }
      ),
    __rooms: rooms,
    __messages: messagesCalls,
  } as unknown as MockClient;
  return client;
};

const rawEvent = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:mindroom.chat',
  room_id: '!room:mindroom.chat',
  content: { body: id },
});

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

// Both helpers poll until their condition holds, and only the test timeout bounds them. They used
// to give up after 30 polls of 5 ms; on a busy machine that ran out before twenty gap pages were
// saved, and the test read the marker halfway through.
const waitForCompleted = async (minimum = 1): Promise<void> => {
  // Loop-await on a probe read until the executor's last batch settles.
  while (getCacheProbeSnapshot().schedulerCompleted < minimum) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  while (!condition()) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};

describe('gapFillExecutor (ISSUE-207 P4.2)', () => {
  it('retains the gap and stops a multi-token cycle', async () => {
    const roomId = '!room:mindroom.chat';
    const mx = createMockClient((call) => {
      if (call >= 3) throw new Error('test cycle limit');
      return { end: call % 2 === 0 ? 'b' : 'a', chunk: [] };
    });
    mx.__rooms.set(roomId, makeRoomStub(roomId));
    await markRoomTailDiscontinuity(SESSION_ID, roomId, {
      markedAt: 1,
      prevBatch: 'a',
      overlapEventIds: [],
    });
    const scheduler = createBackfillScheduler({ mx });
    const queue = createInMemoryGapFillScheduler();
    const executor = createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, queue);
    queue.enqueueGapFill({ roomId, markedAt: 1, prevBatch: 'a', reason: 'limited-sync' });
    await waitForCompleted(3);
    expect(mx.__messages).toHaveLength(2);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeDefined();
    executor.stop();
    scheduler.abortAll();
  });

  it.each(['transport', 'commit', 'same-token'])(
    'retries a %s failure only after recheck',
    async (failure) => {
      // eslint-disable-next-line no-console
      const originalWarn = console.warn;
      const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        if (
          failure !== 'commit' ||
          !String(args[0]).startsWith('[mindroom-cache:roomEventCache.save]')
        )
          originalWarn(...args);
      });
      const roomId = '!room:mindroom.chat';
      const mx = createMockClient((call) => {
        if (!call && failure === 'transport') throw new Error('offline');
        return {
          chunk: [rawEvent('$retry', 10)],
          ...(!call && failure === 'same-token' ? { end: 'before' } : {}),
        };
      });
      mx.__rooms.set(roomId, makeRoomStub(roomId));
      await markRoomTailDiscontinuity(SESSION_ID, roomId, {
        markedAt: 1,
        prevBatch: 'before',
        overlapEventIds: [],
      });
      const transaction = IDBDatabase.prototype.transaction;
      let aborted = false;
      const fault = vi
        .spyOn(IDBDatabase.prototype, 'transaction')
        .mockImplementation(function abortFirstWrite(...args) {
          const result = transaction.apply(this, args);
          if (
            failure === 'commit' &&
            !aborted &&
            args[1] === 'readwrite' &&
            result.objectStoreNames.contains('events')
          ) {
            aborted = true;
            queueMicrotask(() => result.abort());
          }
          return result;
        });
      const scheduler = createBackfillScheduler({ mx });
      const queue = createInMemoryGapFillScheduler();
      const executor = createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, queue);
      queue.enqueueGapFill({ roomId, markedAt: 1, prevBatch: 'before', reason: 'limited-sync' });
      await waitForCompleted(1);
      expect(mx.__messages).toHaveLength(1);
      expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeDefined();
      executor.recheckDeferred(roomId);
      await vi.waitFor(() => expect(mx.__messages).toHaveLength(2));
      await waitForCompleted(2);
      expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeUndefined();
      expect(aborted).toBe(failure === 'commit');
      if (failure === 'commit')
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('[mindroom-cache:roomEventCache.save]'),
          expect.anything()
        );
      else expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      fault.mockRestore();
      executor.stop();
      scheduler.abortAll();
    }
  );

  it('keeps enough cached-tail ids to cover ten configured sync windows', () => {
    expect(GAP_FILL_OVERLAP_TAIL_LIMIT).toBeGreaterThanOrEqual(STARTUP_SYNC_TIMELINE_LIMIT * 10);
  });

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    await clearRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    await clearRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat');
    await clearRoomTailDiscontinuity(SESSION_ID, '!other:mindroom.chat');
    resetCacheStoreForTesting();
    resetCacheProbe();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    await clearRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat');
    await clearRoomTailDiscontinuity(SESSION_ID, '!other:mindroom.chat');
    resetCacheStoreForTesting();
    resetCacheProbe();
  });

  it('drains a queued limited-sync job: persists events and clears the durable marker', async () => {
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [rawEvent('$e1', 10)] };
      return { chunk: [] }; // end === undefined -> reached end
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));

    // Pre-write a discontinuity marker so we can prove the executor
    // clears it on success.
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    await flushMicrotasks();
    await waitForCompleted();

    expect(mx.__messages.length).toBeGreaterThanOrEqual(1);
    expect(mx.__messages[0].fromToken).toBe('tok-0');
    expect(mx.__messages[0].dir).toBe(Direction.Backward);

    const cached = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$e1');
    expect(cached?.event_id).toBe('$e1');

    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    expect(marker).toBeUndefined();
  });

  it('persists thread replies from catchup chunks into their thread cache scopes (2026-07-06 eager-cache fix)', async () => {
    // Same contract as the deep-history sweep: a limited-sync catchup
    // chunk contains thread replies (they are room DAG events); the
    // executor must teach the thread caches instead of filtering the
    // replies out of the room scope and dropping them.
    const mx = createMockClient((call) => {
      if (call === 0) {
        return {
          end: 'tok-1',
          chunk: [
            {
              ...rawEvent('$gap-reply', 20),
              content: {
                body: '$gap-reply',
                'm.relates_to': { event_id: '$gap-root', rel_type: 'm.thread' },
              },
            },
            rawEvent('$gap-root', 10),
          ],
        };
      }
      return { chunk: [] };
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });
    await flushMicrotasks();
    await waitForCompleted();

    const threadPage = await loadLatestCachedThreadEvents(
      SESSION_ID,
      '!room:mindroom.chat',
      '$gap-root',
      10
    );
    expect(threadPage.events.map((event) => event.event_id)).toEqual(['$gap-reply']);
    expect(threadPage.tailLoaded).toBe(true);
  });

  it('fetches encrypted room history before clearing an exhausted gap', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!e2e:mindroom.chat', makeRoomStub('!e2e:mindroom.chat', true));
    await markRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    // Encrypted pages decrypt through the SDK, so the executor fetches them
    // like any other room's.
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!e2e:mindroom.chat',
      reason: 'startup',
      markedAt: Date.now(),
    });

    await flushMicrotasks();
    await waitForCompleted();

    expect(mx.__messages.length).toBe(1);
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat');
    expect(marker).toBeUndefined();
  });

  it('subscribes to future enqueues so a limited-sync reset dispatches immediately', async () => {
    let call = 0;
    const mx = createMockClient(() => {
      call += 1;
      if (call === 1) return { chunk: [rawEvent('$e2', 20)] }; // end undefined
      return { chunk: [] };
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);

    // Enqueue AFTER the executor is wired — subscription must fire.
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });
    await flushMicrotasks();
    await waitForCompleted();

    expect(mx.__messages.length).toBe(1);

    const cached = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$e2');
    expect(cached?.event_id).toBe('$e2');
  });

  it('runs one latest successor when a newer reset arrives during an active fill', async () => {
    let resolveFirst!: (response: { end?: string; chunk: Partial<IEvent>[] }) => void;
    const requestedTokens: Array<string | null> = [];
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    mx.createMessagesRequest = vi.fn(async (_roomId, fromToken: string | null) => {
      requestedTokens.push(fromToken);
      if (requestedTokens.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      if (requestedTokens.length === 2) {
        return { end: 'new-next', chunk: [rawEvent('$recovered-prefix', 20)] };
      }
      return { chunk: [rawEvent('$original-tail', 10)] };
    }) as never;

    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: 1000,
      prevBatch: 'old-token',
      generation: 'old-generation',
      nextToken: 'old-token',
      overlapEventIds: ['$original-tail'],
    });
    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: 1000,
      prevBatch: 'old-token',
      generation: 'old-generation',
    });
    await flushMicrotasks();
    await waitForCondition(() => typeof resolveFirst === 'function');

    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: 2000,
      prevBatch: 'new-token',
      generation: 'new-generation',
      nextToken: 'new-token',
    });
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: 2000,
      prevBatch: 'new-token',
      generation: 'new-generation',
    });

    resolveFirst({ end: 'old-next', chunk: [rawEvent('$recovered-prefix', 20)] });
    // The superseded request and both successor pages each release a scheduler slot.
    await waitForCompleted(3);

    expect(requestedTokens).toEqual(['old-token', 'new-token', 'new-next']);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toBeUndefined();
  });

  it('a startup job for a room with no prevBatch still enters the scheduler and completes (AC13 mechanism)', async () => {
    // This is the AC13 shape: Sync→PREPARED enqueues a `startup` job
    // per joined room, with `prevBatch = getPaginationToken(Backward)`
    // which is often undefined on a cold reload. The executor MUST
    // hand the job to the scheduler and drive runOnce to completion —
    // otherwise the docker probe reads `schedulerCompleted=0` and the
    // gate fails.
    const mx = createMockClient(() => ({ chunk: [] })); // end undefined → reached end
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);

    // No prevBatch — mirrors handleSyncPrepared's initial state.
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'startup',
      markedAt: Date.now(),
      // prevBatch intentionally omitted
    });
    await flushMicrotasks();
    await waitForCompleted();

    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.schedulerEnqueued).toBe(1);
    expect(snapshot.schedulerCompleted).toBe(1);
    expect(snapshot.schedulerFailed).toBe(0);
    // /messages was called with fromToken=null (no from param → SDK
    // starts from live tip backward, per the spec-legal default).
    expect(mx.__messages.length).toBe(1);
    expect(mx.__messages[0].fromToken).toBeNull();
  });

  it('leaves the durable marker in place when the network request fails', async () => {
    const mx = createMockClient(() => {
      throw new Error('network down');
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    await flushMicrotasks();
    // The executor's runOnce catches the createMessagesRequest reject
    // internally (marker preserved, void return), so the job resolves
    // gracefully — schedulerCompleted bumps, schedulerFailed stays 0.
    // The point of the executor's catch is to keep the scheduler slot
    // recyclable, so this shape is intentional.
    await waitForCompleted();

    // Marker still present — next boot will retry.
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    expect(marker).toBeDefined();
    // Job resolved (executor caught the reject) — not schedulerFailed.
    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.schedulerFailed).toBe(0);
    expect(snapshot.schedulerCompleted).toBe(1);
  });

  it.each(['boundary-read', 'empty-response'] as const)(
    'keeps a revoked gap task from mutating metadata after %s',
    async (stage) => {
      const roomId = '!room:mindroom.chat';
      const marker = {
        markedAt: 1000,
        prevBatch: 'tok-0',
        generation: 'revoked',
        ...(stage === 'empty-response' ? { overlapEventIds: ['$boundary'] } : {}),
      };
      await markRoomTailDiscontinuity(SESSION_ID, roomId, marker);
      const mx = createMockClient(() => {
        if (stage === 'empty-response') revokeRoomCacheStoreWrites(SESSION_ID, roomId);
        return { chunk: [] };
      });
      mx.__rooms.set(roomId, makeRoomStub(roomId));
      const scheduler = createBackfillScheduler({ mx });
      const queue = createInMemoryGapFillScheduler();
      createGapFillExecutor(
        {
          mx,
          sessionId: SESSION_ID,
          scheduler,
          loadCachedTail: async () => {
            revokeRoomCacheStoreWrites(SESSION_ID, roomId);
            return { events: [rawEvent('$boundary', 1)], hasMore: false, beforeToken: null };
          },
        },
        queue
      );
      queue.enqueueGapFill({ roomId, reason: 'limited-sync', ...marker });
      await waitForCompleted();
      expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toEqual(marker);
      expect(mx.__messages).toHaveLength(stage === 'empty-response' ? 1 : 0);
    }
  );

  it('defers without fetching or clearing when the durable marker read fails', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'read-failure',
      nextToken: 'tok-20',
      overlapEventIds: ['$original-boundary'],
    });
    const loadDiscontinuity = vi
      .fn<typeof loadRoomTailDiscontinuity>()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockImplementation(loadRoomTailDiscontinuity);
    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    const executor = createGapFillExecutor(
      { mx, sessionId: SESSION_ID, scheduler, loadDiscontinuity },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'read-failure',
    });

    await waitForCompleted();

    expect(mx.__messages).toHaveLength(0);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toMatchObject({
      generation: 'read-failure',
      nextToken: 'tok-20',
      overlapEventIds: ['$original-boundary'],
    });

    executor.recheckDeferred('!room:mindroom.chat');
    await waitForCompleted(2);

    expect(mx.__messages[0]?.fromToken).toBe('tok-20');
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toBeUndefined();
  });

  it('publishes a committed page even when cancellation races its completion', async () => {
    const roomId = '!room:mindroom.chat';
    const mx = createMockClient(() => ({ chunk: [rawEvent('$committed', 1)] }));
    mx.__rooms.set(roomId, makeRoomStub(roomId));
    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    const onRoomRecovered = vi.fn();
    createGapFillExecutor(
      {
        mx,
        sessionId: SESSION_ID,
        scheduler,
        onRoomRecovered,
        persistChunk: async (args) => {
          const committed = await persistRoomChunkWithPreferLive(args);
          scheduler.abortAll();
          return committed;
        },
      },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId,
      reason: 'limited-sync',
      markedAt: 1,
      prevBatch: 'gap',
    });
    await waitForCondition(() => getCacheProbeSnapshot().schedulerAborted === 1);
    expect(await loadCachedRoomEvent(SESSION_ID, roomId, '$committed')).toMatchObject({
      event_id: '$committed',
    });
    expect(onRoomRecovered).toHaveBeenCalledTimes(1);
    expect(onRoomRecovered).toHaveBeenCalledWith(roomId);
  });

  it('does not advance or clear the durable cursor when a cache write fails', async () => {
    const onRoomRecovered = vi.fn();
    const mx = createMockClient(() => ({
      end: 'tok-1',
      chunk: [rawEvent('$uncommitted', 1)],
    }));
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'write-failure',
      nextToken: 'tok-0',
    });
    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor(
      {
        mx,
        sessionId: SESSION_ID,
        scheduler,
        persistChunk: vi.fn().mockRejectedValue(new Error('quota')),
        onRoomRecovered,
      },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'write-failure',
    });

    await flushMicrotasks();
    await waitForCompleted();

    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toMatchObject({
      generation: 'write-failure',
      nextToken: 'tok-0',
    });
    expect(onRoomRecovered).not.toHaveBeenCalled();
  });

  it('stops at a committed overlap with the pre-gap cached tail instead of crawling to room genesis', async () => {
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [rawEvent('$missing', 20)] };
      if (call === 1) return { end: 'tok-2', chunk: [rawEvent('$cached-tail', 10)] };
      throw new Error('gap-fill crawled past the cached boundary');
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'overlap-generation',
      nextToken: 'tok-0',
    });

    let persistCalls = 0;
    let commitOverlap!: () => void;
    const persistChunk = vi.fn(() => {
      persistCalls += 1;
      if (persistCalls !== 2) return Promise.resolve(undefined);
      return new Promise<void>((resolve) => {
        commitOverlap = resolve;
      });
    });
    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor(
      {
        mx,
        sessionId: SESSION_ID,
        scheduler,
        persistChunk: persistChunk as never,
        loadCachedTail: vi.fn().mockResolvedValue({
          events: [rawEvent('$cached-tail', 10)],
          hasMoreBefore: false,
        }) as never,
      },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: 1000,
      prevBatch: 'tok-0',
      generation: 'overlap-generation',
    });

    await waitForCondition(() => persistCalls === 2);
    expect(mx.__messages).toHaveLength(2);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toMatchObject({
      nextToken: 'tok-1',
      overlapEventIds: ['$cached-tail'],
    });

    // The first page's turn has already completed; wait for the overlap page's.
    commitOverlap();
    await waitForCompleted(2);

    expect(mx.__messages).toHaveLength(2);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toBeUndefined();
  });

  it('resumes a gap its allowance paused from its durable checkpoint in the same runtime', async () => {
    // The marker must survive until the server signals no more history
    // or a page overlaps the cached tail. Running out of allowance with
    // more history available proves neither.
    let call = 0;
    const mx = createMockClient(() => {
      call += 1;
      if (call === 21) {
        return {
          end: 'tok-21',
          chunk: [rawEvent('$pre-gap-tail', 1)],
        };
      }
      // The first run always has another token and uses up its allowance.
      return {
        end: `tok-${call}`,
        chunk: [{ event_id: `$e-${call}`, origin_server_ts: 1000 + call } as Partial<IEvent>],
      };
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    const budget = allowance(20);
    const executor = createGapFillExecutor(
      {
        mx,
        sessionId: SESSION_ID,
        scheduler,
        ...budget.callbacks,
        loadCachedTail: vi.fn().mockResolvedValue({
          events: [rawEvent('$pre-gap-tail', 1)],
          hasMoreBefore: false,
        }) as never,
      },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    await waitForCompleted(20);
    // Twenty one-event pages used up the allowance while /messages kept
    // returning a next-token. The marker MUST still be present so a
    // later run picks up from where we left off.
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    expect(marker).toMatchObject({
      nextToken: 'tok-20',
      overlapEventIds: ['$pre-gap-tail'],
    });
    // Sanity: the allowance stopped the run, and it took no extra turn.
    expect(mx.__messages.length).toBe(20);
    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.schedulerCompleted).toBe(20);
    expect(snapshot.schedulerFailed).toBe(0);

    // A focus recheck in the same runtime resumes the retained job from the
    // durable cursor instead of waiting for reload or another TimelineReset.
    budget.grant(200);
    executor.recheckDeferred('!room:mindroom.chat');
    await waitForCompleted(21);
    expect(mx.__messages[20].fromToken).toBe('tok-20');
    expect(mx.__messages).toHaveLength(21);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat')).toBeUndefined();
  });

  // ISSUE-207 P7.2 audit finding #3 (red-first): the raw chunk MUST be
  // funnelled through `createPreferLiveEventMapper` before persisting.
  // Simulate the Tuwunel stale-copy scenario: the SDK's live instance is
  // already redacted (client observed the redaction earlier), but the
  // homeserver still serves the un-pruned copy on /messages within its
  // ~10s window. The gap-fill must consult the live instance and heal
  // via `makeRedacted`; without the mapper the fetched pre-redaction
  // plaintext lands in cache last-writer-wins and un-redacts the
  // tombstone at rest (invariant I2).
  it('funnels /messages chunks through preferLive so a stale un-pruned copy heals the live redacted instance instead of overwriting the cached tombstone', async () => {
    const preRedactionContent = { body: 'this was said before the redaction' };
    const staleChunkEvent: Partial<IEvent> = {
      event_id: '$stale',
      origin_server_ts: 500,
      type: 'm.room.message',
      sender: '@alice:mindroom.chat',
      room_id: '!room:mindroom.chat',
      // Server-side proof of redaction is attached but the top-level
      // content is still the pre-redaction plaintext — Tuwunel's stale
      // shape. `preferLive` must apply `makeRedacted` on the live copy
      // so the persisted record is the tombstone shape, not this.
      content: preRedactionContent,
      unsigned: {
        redacted_because: {
          event_id: '$redaction',
          type: 'm.room.redaction',
          sender: '@alice:mindroom.chat',
          origin_server_ts: 600,
          content: { redacts: '$stale' } as never,
        } as never,
      } as never,
    };

    // A trackable live instance that is currently NOT redacted; when
    // preferLive fires, it must call makeRedacted on THIS object and
    // return it (so `.event` serializes to the healed shape).
    const liveEvent = new MatrixEvent({
      event_id: '$stale',
      type: 'm.room.message',
      origin_server_ts: 500,
      sender: '@alice:mindroom.chat',
      room_id: '!room:mindroom.chat',
      content: preRedactionContent,
    });

    const mx = createMockClient((call) => {
      if (call === 0) return { chunk: [staleChunkEvent] };
      return { chunk: [] };
    });
    const room = makeRoomStub('!room:mindroom.chat');
    // Override findEventById on this specific room stub to return the
    // trackable live instance for $stale (preferLive's live-instance
    // branch); other lookups return null.
    (room as unknown as { findEventById: (id: string) => unknown }).findEventById = (id: string) =>
      id === '$stale' ? liveEvent : null;
    mx.__rooms.set('!room:mindroom.chat', room);

    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-stale',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-stale',
    });

    await flushMicrotasks();
    await waitForCompleted();

    // The persisted record MUST reflect the redacted tombstone (content
    // pruned, redacted_because stamped). Before the audit fix, gap-fill
    // wrote `staleChunkEvent` verbatim into the events store — content
    // would be `preRedactionContent`, un-redacting the cached row.
    const cached = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$stale');
    expect(cached).toBeDefined();
    expect(cached?.content).toEqual({});
    expect(liveEvent.isRedacted()).toBe(true);
    expect(liveEvent.getUnsigned().redacted_because?.event_id).toBe('$redaction');
  });

  it('defers a room its controller grants no allowance: no fetch, marker kept, job still counted', async () => {
    const roomId = '!other:mindroom.chat';
    const mx = createMockClient(() => ({
      chunk: [rawEvent('$should-not-persist', 1)],
    }));
    mx.__rooms.set(roomId, makeRoomStub(roomId));
    await markRoomTailDiscontinuity(SESSION_ID, roomId, {
      markedAt: Date.now(),
      prevBatch: 'tok-other',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    const canSavePage = vi.fn(async () => true);
    createGapFillExecutor(
      { mx, sessionId: SESSION_ID, scheduler, ...allowance(0).callbacks, canSavePage },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId,
      reason: 'startup',
      markedAt: Date.now(),
      prevBatch: 'tok-other',
    });

    await flushMicrotasks();
    await waitForCompleted();

    // Every tracker enqueue enters the backfill scheduler, so the probe tells a deferred room
    // from a failed one.
    expect(getCacheProbeSnapshot().schedulerEnqueued).toBe(1);
    expect(getCacheProbeSnapshot().schedulerCompleted).toBe(1);
    expect(mx.__messages).toHaveLength(0);
    // A room that gets no page does not make the cache evict for it.
    expect(canSavePage).not.toHaveBeenCalled();
    expect(await loadCachedRoomEvent(SESSION_ID, roomId, '$should-not-persist')).toBeUndefined();
    expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeDefined();
  });

  it('retries a deferred room once its controller grants allowance', async () => {
    const roomId = '!other:mindroom.chat';
    const mx = createMockClient(() => ({
      end: 'older-token',
      chunk: [rawEvent('$original-tail', 1)],
    }));
    mx.__rooms.set(roomId, makeRoomStub(roomId));
    await markRoomTailDiscontinuity(SESSION_ID, roomId, {
      markedAt: Date.now(),
      prevBatch: 'tok-other',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    const loadCachedTail = vi
      .fn()
      .mockResolvedValueOnce({ events: [rawEvent('$original-tail', 1)], hasMoreBefore: false })
      .mockResolvedValueOnce({ events: [rawEvent('$late-tail', 2)], hasMoreBefore: false });
    const budget = allowance(0);
    const executor = createGapFillExecutor(
      { mx, sessionId: SESSION_ID, scheduler, ...budget.callbacks, loadCachedTail },
      gapFillScheduler
    );
    gapFillScheduler.enqueueGapFill({
      roomId,
      reason: 'startup',
      markedAt: Date.now(),
      prevBatch: 'tok-other',
    });

    await waitForCompleted(1);
    expect(mx.__messages).toHaveLength(0);
    // The deferred job already checkpointed its overlap boundary.
    expect(loadCachedTail).toHaveBeenCalledTimes(1);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toMatchObject({
      overlapEventIds: ['$original-tail'],
    });

    // A prefetch scope change rechecks every deferred room.
    budget.grant(50);
    executor.recheckDeferred();
    await waitForCompleted(2);

    expect(mx.__messages).toHaveLength(1);
    // The page asks for no more events than the reservation holds.
    expect(mx.__messages[0].limit).toBe(50);
    expect(budget.settled).toEqual([1]);
    expect(loadCachedTail).toHaveBeenCalledTimes(1);
    expect(await loadCachedRoomEvent(SESSION_ID, roomId, '$original-tail')).toBeDefined();
    expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeUndefined();
  });

  it.each(['no space to save', 'no page to reserve'] as const)(
    'defers without fetching while the controller has %s',
    async (shortage) => {
      const roomId = '!room:mindroom.chat';
      const mx = createMockClient(() => ({ chunk: [rawEvent('$later', 1)] }));
      mx.__rooms.set(roomId, makeRoomStub(roomId));
      await markRoomTailDiscontinuity(SESSION_ID, roomId, { markedAt: 1, prevBatch: 'tok-0' });
      let short = true;
      const { reservePage } = allowance().callbacks;
      const scheduler = createBackfillScheduler({ mx });
      const gapFillScheduler = createInMemoryGapFillScheduler();
      const executor = createGapFillExecutor(
        {
          mx,
          sessionId: SESSION_ID,
          scheduler,
          // The allowance can run out while the controller makes space for the page.
          canSavePage: async () => !(short && shortage === 'no space to save'),
          reservePage: () =>
            short && shortage === 'no page to reserve' ? undefined : reservePage(),
        },
        gapFillScheduler
      );
      gapFillScheduler.enqueueGapFill({
        roomId,
        reason: 'limited-sync',
        markedAt: 1,
        prevBatch: 'tok-0',
      });

      await waitForCompleted(1);
      expect(mx.__messages).toHaveLength(0);
      expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeDefined();

      short = false;
      executor.recheckDeferred(roomId);
      await waitForCompleted(2);

      expect(mx.__messages).toHaveLength(1);
      expect(await loadCachedRoomEvent(SESSION_ID, roomId, '$later')).toBeDefined();
      expect(await loadRoomTailDiscontinuity(SESSION_ID, roomId)).toBeUndefined();
    }
  );
});
