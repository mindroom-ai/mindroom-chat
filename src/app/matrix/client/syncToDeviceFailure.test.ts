import {
  ClientEvent,
  createClient,
  EventType,
  MemoryStore,
  type IToDeviceEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import type { SyncCryptoChanges } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_URL = 'https://matrix.example';
const USER_ID = '@alice:example';
const ROOM_ID = '!room:example';

const message = (eventId: string, body: string) => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: '@agent:example',
  origin_server_ts: 1,
  type: EventType.RoomMessage,
  content: { msgtype: 'm.text', body },
});

const toDevice = (ping: number): IToDeviceEvent => ({
  type: 'org.mindroom.test.ping',
  sender: '@agent:example',
  content: { ping },
});

const joinedRoom = (events: ReturnType<typeof message>[]) => ({
  join: { [ROOM_ID]: { timeline: { events, limited: false } } },
});

const initialRoom = {
  join: {
    [ROOM_ID]: {
      state: {
        events: [
          {
            ...message('$member', ''),
            type: EventType.RoomMember,
            sender: USER_ID,
            state_key: USER_ID,
            content: { membership: 'join' },
          },
        ],
      },
      timeline: { events: [message('$root', 'Root')], limited: false },
    },
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type SyncBody = Record<string, unknown> & { next_batch: string };

/**
 * A server that answers each `since` token with a fixed response. Like Synapse
 * and Tuwunel, it keeps a response's to-device messages queued until a later
 * `/sync` acknowledges its `next_batch`, so a repeated token gets them again.
 */
const createServer = (responses: Record<string, SyncBody>) => {
  const sinceTokens: Array<string | null> = [];
  const fetchFn = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/versions')) return json({ versions: ['v1.11'] });
    if (url.pathname.includes('/pushrules')) return json({ global: {} });
    if (url.pathname.endsWith('/filter')) return json({ filter_id: 'filter' });
    if (!url.pathname.endsWith('/sync')) return json({});
    const since = url.searchParams.get('since');
    sinceTokens.push(since);
    const response = responses[since ?? 'initial-request'];
    if (response) return json(response);
    return new Promise<Response>(() => {
      // Long poll with nothing new.
    });
  });
  return { fetchFn, sinceTokens };
};

// The default scenario: an initial sync, then a thread reply sharing its
// response with a to-device message.
const replyAfterInitial = {
  'initial-request': { next_batch: 'initial', rooms: initialRoom },
  initial: {
    next_batch: 'after-reply',
    to_device: { events: [toDevice(1)] },
    rooms: joinedRoom([message('$reply', 'Reply')]),
  },
} satisfies Record<string, SyncBody>;

describe('Matrix sync when the crypto store cannot take to-device messages', () => {
  const clients: MatrixClient[] = [];

  afterEach(() => {
    clients.splice(0).forEach((client) => client.stopClient());
    vi.useRealTimers();
  });

  const startClient = async ({
    failures,
    responses = replyAfterInitial,
    withoutMessagesFails = false,
  }: {
    failures: number | ((call: number) => boolean);
    responses?: Record<string, SyncBody>;
    /** The crypto layer also fails for changes that bring no to-device messages. */
    withoutMessagesFails?: boolean;
  }) => {
    const server = createServer(responses);
    const client = createClient({
      baseUrl: BASE_URL,
      userId: USER_ID,
      deviceId: 'DEVICE',
      accessToken: 'token',
      store: new MemoryStore(),
      fetchFn: server.fetchFn,
    });
    clients.push(client);
    let calls = 0;
    // The SDK hands a response's to-device messages, device list changes and key counts to the
    // crypto layer in one call (matrix-js-sdk #5503), also for a response without messages.
    const processSyncChanges = vi.fn(async ({ toDeviceEvents: events }: SyncCryptoChanges) => {
      if (events.length === 0) {
        if (withoutMessagesFails) throw new DOMException('Connection lost.', 'UnknownError');
        return [];
      }
      calls += 1;
      const fail = typeof failures === 'number' ? calls <= failures : failures(calls);
      if (fail) {
        // What the Rust crypto store reports once its IndexedDB connection is gone.
        throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
      }
      return events.map((event) => ({ message: event, encryptionInfo: null }));
    });
    // Only the sync callbacks of the crypto backend matter here.
    (client as unknown as { cryptoBackend: unknown }).cryptoBackend = {
      processSyncChanges,
      onCryptoEvent: vi.fn(async () => undefined),
      onSyncCompleted: vi.fn(),
      stop: vi.fn(),
    };
    const toDeviceEvents: unknown[] = [];
    client.on(ClientEvent.ToDeviceEvent, (event) => toDeviceEvents.push(event.getContent()));
    const accountData: unknown[] = [];
    client.on(ClientEvent.AccountData, (event) => accountData.push(event.getType()));
    await client.startClient({ initialSyncLimit: 10 });
    const eventIds = () =>
      client
        .getRoom(ROOM_ID)
        ?.getLiveTimeline()
        .getEvents()
        .map((event) => event.getId()) ?? [];
    return { ...server, client, processSyncChanges, toDeviceEvents, accountData, eventIds };
  };

  // `vi.waitFor` advances fake timers itself, so poll with real `setImmediate`
  // turns instead and move the retry timers explicitly.
  const settle = async (condition: () => boolean) => {
    for (let turn = 0; turn < 500; turn += 1) {
      if (condition()) return;
      // eslint-disable-next-line no-await-in-loop -- lets fetch and sync processing run.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    throw new Error('Condition not reached');
  };
  // The calls that brought to-device messages.
  const attempts = (sync: Awaited<ReturnType<typeof startClient>>) =>
    sync.processSyncChanges.mock.calls.filter(([changes]) => changes.toDeviceEvents.length > 0)
      .length;
  const retryAfter = async (
    sync: Awaited<ReturnType<typeof startClient>>,
    delayMs: number,
    expected: number
  ) => {
    await vi.advanceTimersByTimeAsync(delayMs);
    await settle(() => attempts(sync) >= expected);
    expect(attempts(sync)).toBe(expected);
  };

  // The six retries wait 1, 2, 4, 8, 16 and 32 s; this runs up to the last wait.
  const retryUntilLastWait = async (sync: Awaited<ReturnType<typeof startClient>>) => {
    await settle(() => attempts(sync) === 1);
    for (const [index, delayMs] of [1_000, 2_000, 4_000, 8_000, 16_000].entries()) {
      // eslint-disable-next-line no-await-in-loop -- each retry waits for the previous one.
      await retryAfter(sync, delayMs, index + 2);
    }
  };

  it('retries a response whose to-device messages failed, without losing its room events', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({ failures: 1 });

    await settle(() => attempts(sync) === 1);
    await retryAfter(sync, 1_000, 2);
    await settle(() => sync.eventIds().includes('$reply'));

    // The failed response is not acknowledged: the next request repeats its token.
    expect(sync.sinceTokens.slice(0, 3)).toEqual([null, 'initial', 'initial']);
    expect(sync.toDeviceEvents).toEqual([{ ping: 1 }]);
    expect(sync.eventIds().filter((id) => id === '$reply')).toHaveLength(1);
  });

  it('applies nothing of a failed response before retrying it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      failures: 1,
      responses: {
        ...replyAfterInitial,
        initial: {
          ...replyAfterInitial.initial,
          account_data: { events: [{ type: 'org.mindroom.test.settings', content: { a: 1 } }] },
        },
      },
    });

    await settle(() => attempts(sync) === 1);
    expect(sync.accountData).toEqual([]);
    await retryAfter(sync, 1_000, 2);
    await settle(() => sync.eventIds().includes('$reply'));

    expect(sync.accountData).toEqual(['org.mindroom.test.settings']);
  });

  it('retries a failed initial sync from no token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      failures: 1,
      responses: {
        'initial-request': {
          next_batch: 'initial',
          to_device: { events: [toDevice(1)] },
          rooms: initialRoom,
        },
      },
    });

    await settle(() => attempts(sync) === 1);
    await retryAfter(sync, 1_000, 2);
    await settle(() => sync.eventIds().includes('$root'));

    expect(sync.sinceTokens.slice(0, 2)).toEqual([null, null]);
    expect(sync.eventIds()).toContain('$root');
    expect(sync.toDeviceEvents).toEqual([{ ping: 1 }]);
  });

  it('keeps room events flowing when the crypto store stays broken', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({ failures: Number.POSITIVE_INFINITY });

    await retryUntilLastWait(sync);
    // Nothing is acknowledged within the minute an app has to restore the crypto store.
    expect(sync.sinceTokens).not.toContain('after-reply');
    await vi.advanceTimersByTimeAsync(32_000);
    await settle(() => sync.eventIds().includes('$reply'));

    // Six retries, then the response is applied without its to-device messages.
    expect(attempts(sync)).toBe(7);
    expect(sync.sinceTokens.slice(0, 9)).toEqual([
      null,
      ...Array(7).fill('initial'),
      'after-reply',
    ]);
    expect(sync.toDeviceEvents).toEqual([]);
  });

  it('still tells the crypto layer whose devices changed when it gives the messages up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      failures: Number.POSITIVE_INFINITY,
      responses: {
        ...replyAfterInitial,
        initial: {
          ...replyAfterInitial.initial,
          device_lists: { changed: ['@bob:example.org'], left: [] },
          device_one_time_keys_count: { signed_curve25519: 12 },
          device_unused_fallback_key_types: ['signed_curve25519'],
        },
      },
    });

    await retryUntilLastWait(sync);
    await vi.advanceTimersByTimeAsync(32_000);
    await settle(() => sync.eventIds().includes('$reply'));

    // The server reports a device list change once: acknowledging the response without it would
    // leave Bob's devices stale. It and the key counts go in again, without the messages.
    expect(sync.processSyncChanges.mock.calls.map(([changes]) => changes).slice(-2)).toEqual([
      expect.objectContaining({ toDeviceEvents: [expect.anything()] }),
      {
        toDeviceEvents: [],
        deviceLists: { changed: ['@bob:example.org'], left: [] },
        oneTimeKeysCounts: { signed_curve25519: 12 },
        unusedFallbackKeys: ['signed_curve25519'],
      },
    ]);
  });

  it('keeps room events flowing when the crypto layer does not take the changes without the messages either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      failures: Number.POSITIVE_INFINITY,
      withoutMessagesFails: true,
    });

    await retryUntilLastWait(sync);
    await vi.advanceTimersByTimeAsync(32_000);
    await settle(() => sync.eventIds().includes('$reply'));

    expect(sync.sinceTokens.slice(0, 9)).toEqual([
      null,
      ...Array(7).fill('initial'),
      'after-reply',
    ]);
  });

  it('skips the retries while the crypto store stays broken, until it works again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      // Broken for the first response's seven attempts and the next response; working after.
      failures: (call) => call <= 8,
      responses: {
        ...replyAfterInitial,
        'after-reply': {
          next_batch: 'second',
          to_device: { events: [toDevice(2)] },
          rooms: joinedRoom([message('$second', 'Second')]),
        },
        second: {
          next_batch: 'third',
          to_device: { events: [toDevice(3)] },
          rooms: joinedRoom([message('$third', 'Third')]),
        },
      },
    });

    await retryUntilLastWait(sync);
    await vi.advanceTimersByTimeAsync(32_000);
    // The second response fails too and is applied at once, without waiting.
    await settle(() => sync.eventIds().includes('$third'));

    expect(sync.sinceTokens.slice(0, 11)).toEqual([
      null,
      ...Array(7).fill('initial'),
      'after-reply',
      'second',
      'third',
    ]);
    expect(sync.toDeviceEvents).toEqual([{ ping: 3 }]);
  });

  it('retries again after the crypto layer has recovered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = await startClient({
      // Broken for the first response, working for the second, broken once for the third.
      failures: (call) => call <= 7 || call === 9,
      responses: {
        ...replyAfterInitial,
        'after-reply': {
          next_batch: 'second',
          to_device: { events: [toDevice(2)] },
          rooms: joinedRoom([message('$second', 'Second')]),
        },
        second: {
          next_batch: 'third',
          to_device: { events: [toDevice(3)] },
          rooms: joinedRoom([message('$third', 'Third')]),
        },
      },
    });

    await retryUntilLastWait(sync);
    await vi.advanceTimersByTimeAsync(32_000);
    await settle(() => attempts(sync) === 9);
    // The success reset the streak, so the third response is retried again.
    expect(sync.eventIds()).not.toContain('$third');
    await retryAfter(sync, 1_000, 10);
    await settle(() => sync.eventIds().includes('$third'));

    expect(sync.toDeviceEvents).toEqual([{ ping: 2 }, { ping: 3 }]);
  });
});
