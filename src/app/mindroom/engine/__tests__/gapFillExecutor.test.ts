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

// CINNY-207 P7.2 audit finding #3: gap-fill now maps each raw chunk
// event through `createPreferLiveEventMapper` before persisting. Extend
// the room stub with `findEventById` (preferLive checks whether the
// SDK already holds a live instance) — returning null keeps the mapper
// on the "clone the raw event" branch, which is what these tests want.
// `findEventInTimeline` and `getUnfilteredTimelineSet` are unused by
// the gap-fill path so they stay off the stub.
const makeRoomStub = (
  roomId: string,
  createSender: string | undefined,
  encrypted = false
): Room =>
  ({
    roomId,
    findEventById: () => null,
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

// CINNY-207 P7.2 audit finding #3: a minimal MatrixEvent shape sufficient
// for `serializeRoomCacheEvents` (via `hydrateCachedEvents` +
// `collectStateTargetEvents`). Non-redaction, non-replace events skip
// every branch except the identity emit — we only need `getId`,
// `getType`, `getRelation`, `getSender`, and `.event`.
const identityMapper = (raw: Partial<IEvent>) =>
  ({
    getId: () => raw.event_id ?? '',
    getType: () => raw.type,
    getTs: () => (raw.origin_server_ts as number) ?? 0,
    isRedaction: () => raw.type === 'm.room.redaction',
    isRedacted: () => Boolean(raw.unsigned?.redacted_because),
    getAssociatedId: () => (raw.content as { redacts?: string } | undefined)?.redacts,
    getRelation: () => null,
    getUnsigned: () => raw.unsigned ?? {},
    getStateKey: () => (raw as { state_key?: string }).state_key,
    getSender: () => raw.sender,
    getContent: () => raw.content ?? {},
    getWireContent: () => raw.content ?? {},
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    event: raw,
  }) as unknown as import('matrix-js-sdk').MatrixEvent;

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
    // CINNY-207 P7.2 audit finding #3: `persistRoomChunkWithPreferLive`
    // resolves the event mapper up front and wraps it in
    // `createPreferLiveEventMapper` before persisting each chunk.
    getEventMapper: () => identityMapper,
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
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
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

  it('skips federated rooms at runOnce (marker preserved, no network fetch, still counted by the scheduler)', async () => {
    const mx = createMockClient('mindroom.chat', () => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoomStub('!fed:example.org', '@carol:example.org'));
    await markRoomTailDiscontinuity(SESSION_ID, '!fed:example.org', {
      markedAt: Date.now(),
      prevBatch: 'tok-0',
    });

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    // P4 gate fix: the executor's `enqueue` no longer short-circuits
    // on tier. Every tracker enqueue enters the backfill scheduler so
    // `gapFillsEnqueued` and `schedulerEnqueued` stay in lockstep —
    // otherwise a probe snapshot of the AC13 fail path is ambiguous
    // (silent policy skip vs. real execution failure).
    gapFillScheduler.enqueueGapFill({
      roomId: '!fed:example.org',
      reason: 'startup',
      markedAt: Date.now(),
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    await flushMicrotasks();
    await waitForCompleted();

    // Scheduler saw the job and ran it to completion (runOnce returned
    // void via the policy gate) — completion counter bumps.
    expect(getCacheProbeSnapshot().schedulerEnqueued).toBe(1);
    expect(getCacheProbeSnapshot().schedulerCompleted).toBe(1);
    // But no /messages call: the policy gate rejects federated rooms
    // BEFORE any fetch — the whole point of the tier check.
    expect(mx.__messages.length).toBe(0);
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

  it('a startup job for an own-server room with no prevBatch still enters the scheduler and completes (AC13 mechanism)', async () => {
    // This is the AC13 shape: Sync→PREPARED enqueues a `startup` job
    // per joined room, with `prevBatch = getPaginationToken(Backward)`
    // which is often undefined on a cold reload. The executor MUST
    // hand the job to the scheduler and drive runOnce to completion —
    // otherwise the docker probe reads `schedulerCompleted=0` and the
    // gate fails.
    const mx = createMockClient('mindroom.chat', () => ({ chunk: [] })); // end undefined → reached end
    mx.__rooms.set(
      '!own:mindroom.chat',
      makeRoomStub('!own:mindroom.chat', '@alice:mindroom.chat')
    );

    const scheduler = createBackfillScheduler({ mx });
    const gapFillScheduler = createInMemoryGapFillScheduler();
    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);

    // No prevBatch — mirrors handleSyncPrepared's initial state.
    gapFillScheduler.enqueueGapFill({
      roomId: '!own:mindroom.chat',
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

  it('preserves the durable marker when max iterations exhaust without reaching the server-tail end (greptile P1: gap marker clears early)', async () => {
    // Greptile: a limited-sync or startup gap larger than
    // (GAP_FILL_MAX_ITERATIONS × GAP_FILL_BATCH_SIZE) = 4,000 events
    // used to clear the marker after any batch persisted, even when
    // the iteration cap was hit with more history available. That
    // dropped the only durable retry signal for the remaining gap.
    // Fix: the marker must survive until either the server signals
    // no more history (reachedEnd) OR we can otherwise prove the
    // gap is closed. Hitting the iteration cap with more history
    // available proves neither.
    let call = 0;
    const mx = createMockClient('mindroom.chat', () => {
      call += 1;
      // Every response has an `end` token, i.e. more history is
      // available; we never signal reachedEnd. Emit one event per
      // batch to trigger `persistedAnyBatch`.
      return {
        end: `tok-${call}`,
        chunk: [
          { event_id: `$e-${call}`, origin_server_ts: 1000 + call } as Partial<IEvent>,
        ],
      };
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

    // The executor stopped at GAP_FILL_MAX_ITERATIONS (20) because
    // /messages kept returning a next-token. The marker MUST still
    // be present so a later run picks up from where we left off.
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, '!room:mindroom.chat');
    expect(marker).toBeDefined();
    // Sanity: we did hit the cap.
    expect(mx.__messages.length).toBe(20);
    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.schedulerCompleted).toBe(1);
    expect(snapshot.schedulerFailed).toBe(0);
  });

  // CINNY-207 P7.2 audit finding #3 (red-first): the raw chunk MUST be
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
    let liveContent: Record<string, unknown> = preRedactionContent;
    let liveIsRedacted = false;
    const liveRedactedBecause: { present?: Partial<IEvent> } = {};
    const liveEvent = {
      getId: () => '$stale',
      getType: () => 'm.room.message',
      getTs: () => 500,
      isRedaction: () => false,
      isRedacted: () => liveIsRedacted,
      getAssociatedId: () => undefined,
      getRelation: () => null,
      getUnsigned: () => (liveRedactedBecause.present ? { redacted_because: liveRedactedBecause.present } : {}),
      getStateKey: () => undefined,
      getSender: () => '@alice:mindroom.chat',
      getContent: () => liveContent,
      getWireContent: () => liveContent,
      makeRedacted: (redactionMEvent: { event?: Partial<IEvent> }) => {
        // Simulate matrix-js-sdk behavior: prune content, mark redacted,
        // stamp unsigned.redacted_because from the redaction event.
        liveIsRedacted = true;
        liveContent = {};
        liveRedactedBecause.present = redactionMEvent.event;
        // The .event property is the raw form the serializer reads.
        (liveEvent as unknown as { event: Partial<IEvent> }).event = {
          event_id: '$stale',
          type: 'm.room.message',
          origin_server_ts: 500,
          sender: '@alice:mindroom.chat',
          room_id: '!room:mindroom.chat',
          content: {},
          unsigned: { redacted_because: redactionMEvent.event ?? undefined } as never,
        };
      },
      makeReplaced: () => undefined,
      replacingEvent: () => null,
      event: {
        event_id: '$stale',
        type: 'm.room.message',
        origin_server_ts: 500,
        sender: '@alice:mindroom.chat',
        room_id: '!room:mindroom.chat',
        content: preRedactionContent,
      } as Partial<IEvent>,
    };

    const mx = createMockClient('mindroom.chat', (call) => {
      if (call === 0) return { chunk: [staleChunkEvent] };
      return { chunk: [] };
    });
    const room = makeRoomStub('!room:mindroom.chat', '@alice:mindroom.chat');
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
    gapFillScheduler.enqueueGapFill({
      roomId: '!room:mindroom.chat',
      reason: 'limited-sync',
      markedAt: Date.now(),
      prevBatch: 'tok-stale',
    });

    createGapFillExecutor({ mx, sessionId: SESSION_ID, scheduler }, gapFillScheduler);
    await flushMicrotasks();
    await waitForCompleted();

    // The persisted record MUST reflect the redacted tombstone (content
    // pruned, redacted_because stamped). Before the audit fix, gap-fill
    // wrote `staleChunkEvent` verbatim into the events store — content
    // would be `preRedactionContent`, un-redacting the cached row.
    const cached = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$stale');
    expect(cached).toBeDefined();
    expect(cached?.content).toEqual({});
    expect(liveIsRedacted).toBe(true);
    expect(liveRedactedBecause.present?.event_id).toBe('$redaction');
  });
});
