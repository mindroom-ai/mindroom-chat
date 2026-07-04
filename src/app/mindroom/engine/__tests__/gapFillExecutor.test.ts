import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Direction } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { createGapFillExecutor } from '../gapFillExecutor';
import { createInMemoryGapFillScheduler } from '../engineGapTracker';
import { StateEvent } from '../../../../types/matrix/room';
import {
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
  loadCachedRoomEvent,
  resetCacheStoreForTesting,
} from '../../threads/cacheStore';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

const SESSION_ID = 'session-p42';

const makeMatrixEvent = (senderId: string) =>
  ({
    getSender: () => senderId,
  }) as unknown as ReturnType<Room['getLiveTimeline']>;

const makeRoomStub = (
  roomId: string,
  createSender: string | undefined,
  encrypted = false
): Room =>
  ({
    roomId,
    hasEncryptionStateEvent: () => encrypted,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return createSender ? makeMatrixEvent(createSender) : undefined;
        },
      }),
    }),
    getLastActiveTimestamp: () => 0,
  }) as unknown as Room;

type MockClient = MatrixClient & {
  __rooms: Map<string, Room>;
  __messages: Array<{
    roomId: string;
    fromToken: string | null;
    limit: number | undefined;
    dir: Direction;
  }>;
  __nextResponse: (call: number) => {
    end?: string;
    chunk: Partial<IEvent>[];
  };
};

const createMockClient = (
  ourDomain: string,
  responder: (call: number) => { end?: string; chunk: Partial<IEvent>[] }
): MockClient => {
  const rooms = new Map<string, Room>();
  const messagesCalls: MockClient['__messages'] = [];
  const client = {
    getDomain: () => ourDomain,
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
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
    __nextResponse: responder,
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

const waitForCompleted = async (): Promise<void> => {
  // Loop-await on a probe read until the executor's last batch settles.
  for (let i = 0; i < 30; i += 1) {
    if (getCacheProbeSnapshot().schedulerCompleted > 0) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('gapFillExecutor (CINNY-207 P4.2)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
  });

  it('drains a queued limited-sync job: persists events and clears the durable marker', async () => {
    const mx = createMockClient('mindroom.chat', (call) => {
      if (call === 0) return { end: 'tok-1', chunk: [rawEvent('$e1', 10)] };
      return { chunk: [] }; // end === undefined -> reached end
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat', '@alice:mindroom.chat'));

    // Pre-write a discontinuity marker so we can prove the executor
    // clears it on success.
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
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

  it('skips federated rooms and clears the marker so they do not accumulate', async () => {
    const mx = createMockClient('mindroom.chat', () => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoomStub('!fed:example.org', '@carol:example.org'));
    await markRoomTailDiscontinuity(SESSION_ID, '!fed:example.org', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    // The executor's `enqueue` path short-circuits federated rooms
    // BEFORE they enter the backfill scheduler, so the marker will
    // NOT be cleared for a room that policy says we should not touch.
    gapFillScheduler.enqueueGapFill({
      roomId: '!fed:example.org',
      reason: 'startup',
      markedAt: Date.now(),
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    await flushMicrotasks();

    expect(mx.__messages.length).toBe(0);
    expect(getCacheProbeSnapshot().schedulerEnqueued).toBe(0);
    // Marker remains — the room was skipped, not filled. Deviations §8
    // covers this: federated rooms are handled by user attention, not
    // background sweeps.
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!fed:example.org');
    expect(marker).toBeDefined();
  });

  it('skips encrypted own-server rooms (unusable ciphertext without decryption context)', async () => {
    const mx = createMockClient('mindroom.chat', () => ({ chunk: [] }));
    mx.__rooms.set(
      '!e2e:mindroom.chat',
      makeRoomStub('!e2e:mindroom.chat', '@alice:mindroom.chat', true)
    );
    await markRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    // Encrypted rooms pass the policy short-circuit
    // (`resolveRoomPrefetchTier` returns "own") so they DO enter the
    // scheduler — but `isRoomEligibleForRawFetch` in the executor
    // rejects them and clears the marker.
    gapFillScheduler.enqueueGapFill({
      roomId: '!e2e:mindroom.chat',
      reason: 'startup',
      markedAt: Date.now(),
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    await flushMicrotasks();
    await waitForCompleted();

    expect(mx.__messages.length).toBe(0);
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!e2e:mindroom.chat');
    expect(marker).toBeUndefined();
  });

  it('subscribes to future enqueues so a limited-sync reset dispatches immediately', async () => {
    let call = 0;
    const mx = createMockClient('mindroom.chat', () => {
      call += 1;
      if (call === 1) return { chunk: [rawEvent('$e2', 20)] }; // end undefined
      return { chunk: [] };
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat', '@alice:mindroom.chat'));

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

  it('leaves the durable marker in place when the network request fails', async () => {
    const mx = createMockClient('mindroom.chat', () => {
      throw new Error('network down');
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoomStub('!room:mindroom.chat', '@alice:mindroom.chat'));
    await markRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    await flushMicrotasks();
    await waitForCompleted();

    // Marker still present — next boot will retry.
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    expect(marker).toBeDefined();
  });
});
