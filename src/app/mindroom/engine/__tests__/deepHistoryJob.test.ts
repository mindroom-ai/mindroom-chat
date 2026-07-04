import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Direction } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { enqueueRoomDeepHistoryJob } from '../deepHistoryJob';
import { StateEvent } from '../../../../types/matrix/room';
import {
  loadCachedRoomEvent,
  resetCacheStoreForTesting,
} from '../../threads/cacheStore';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

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

// CINNY-207 P7.2 audit finding #3: minimal MatrixEvent shape sufficient
// for `serializeRoomCacheEvents` on non-redaction, non-replace events —
// mirrors the identity mapper in the gap-fill test.
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
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
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
