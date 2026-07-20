import { ClientEvent, MatrixEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FLIGHT_RECORDER_ABNORMAL_KEY,
  FLIGHT_RECORDER_CURRENT_KEY,
  type FlightRecorderSession,
  installFlightRecorder,
} from './flightRecorder';
import {
  hashFlightRecorderRoomId,
  installMatrixSyncFlightRecorder,
} from './matrixSyncFlightRecorder';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  readonly writes: string[] = [];

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.writes.push(key);
    this.values.set(key, value);
  }
}

type Handler = (...args: unknown[]) => void;
type FakeClient = MatrixClient & {
  emitClient: (event: ClientEvent, ...args: unknown[]) => void;
  listenerCount: (event: ClientEvent) => number;
};

const createClient = (): FakeClient => {
  const listeners = new Map<ClientEvent, Set<Handler>>();
  const client = {
    on: vi.fn((event: ClientEvent, handler: Handler) => {
      const handlers = listeners.get(event) ?? new Set<Handler>();
      handlers.add(handler);
      listeners.set(event, handlers);
      return client;
    }),
    removeListener: vi.fn((event: ClientEvent, handler: Handler) => {
      listeners.get(event)?.delete(handler);
      return client;
    }),
    emitClient: (event: ClientEvent, ...args: unknown[]) => {
      Array.from(listeners.get(event) ?? []).forEach((handler) => handler(...args));
    },
    listenerCount: (event: ClientEvent) => listeners.get(event)?.size ?? 0,
  };
  return client as unknown as FakeClient;
};

const makeEvent = (eventId: string | undefined, roomId: string | undefined, edit = false) =>
  new MatrixEvent({
    content: edit
      ? {
          'm.new_content': { body: 'updated', msgtype: 'm.text' },
          'm.relates_to': { event_id: '$target', rel_type: 'm.replace' },
        }
      : { body: 'message', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1000,
    room_id: roomId,
    sender: '@agent:example.org',
    type: 'm.room.message',
  });

const readCurrent = (storage: MemoryStorage): FlightRecorderSession =>
  JSON.parse(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY) ?? 'null') as FlightRecorderSession;

const makePriorSession = (
  events: FlightRecorderSession['events'],
  overrides: Partial<FlightRecorderSession> = {}
): FlightRecorderSession => ({
  schemaVersion: 1,
  buildVersion: 'prior-build',
  sessionId: '11111111-1111-4111-8111-111111111111',
  startedAt: 900,
  lastBeatAt: 950,
  visibility: 'visible',
  route: 'home',
  hasThreadId: false,
  voiceCapture: 'inactive',
  expectedEndAt: null,
  endReason: null,
  events,
  ...overrides,
});

describe('Matrix sync flight recorder', () => {
  let storage: MemoryStorage;
  let href: string;
  let documentTarget: EventTarget;
  let windowTarget: EventTarget;
  let disposeRecorder: (() => void) | undefined;
  let disposeMatrix: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    storage = new MemoryStorage();
    href = 'https://chat.mindroom.test/home/';
    documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    windowTarget = new EventTarget();
    Object.defineProperties(windowTarget, {
      location: {
        configurable: true,
        get: () => ({ href, origin: 'https://chat.mindroom.test' }),
      },
      setInterval: { configurable: true, value: globalThis.setInterval },
      clearInterval: { configurable: true, value: globalThis.clearInterval },
    });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
  });

  afterEach(() => {
    disposeMatrix?.();
    disposeRecorder?.();
    disposeMatrix = undefined;
    disposeRecorder = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('coalesces deduplicated multi-room arrivals into one write at the first completed batch', () => {
    const roomA = '!private-a:example.org';
    const roomB = '!private-b:example.org';
    disposeRecorder = installFlightRecorder(storage);
    storage.writes.length = 0;
    const client = createClient();
    disposeMatrix = installMatrixSyncFlightRecorder(client);
    const duplicate = makeEvent('$a-message', roomA);

    client.emitClient(ClientEvent.Event, duplicate);
    client.emitClient(ClientEvent.Event, duplicate);
    client.emitClient(ClientEvent.Event, makeEvent('$a-edit', roomA, true));
    client.emitClient(ClientEvent.Event, makeEvent('$b-message', roomB));
    client.emitClient(ClientEvent.Event, makeEvent('$account-data', undefined));
    client.emitClient(ClientEvent.Sync, SyncState.Prepared, null);

    expect(storage.writes).toEqual([]);
    expect(readCurrent(storage).events).toEqual([]);

    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);

    expect(storage.writes).toEqual([FLIGHT_RECORDER_CURRENT_KEY]);
    expect(readCurrent(storage).events).toEqual([
      {
        at: 1000,
        type: 'matrix_sync',
        roomHash: hashFlightRecorderRoomId(roomA),
        eventCount: 2,
        editCount: 1,
        route: 'home',
        hasThreadId: false,
      },
      {
        at: 1000,
        type: 'matrix_sync',
        roomHash: hashFlightRecorderRoomId(roomB),
        eventCount: 1,
        editCount: 0,
        route: 'home',
        hasThreadId: false,
      },
    ]);
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain(roomA);
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain(roomB);

    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    expect(storage.writes).toHaveLength(1);
  });

  it('captures the current route independently for later sync batches', () => {
    const roomId = '!route-room:example.org';
    disposeRecorder = installFlightRecorder(storage);
    storage.writes.length = 0;
    const client = createClient();
    disposeMatrix = installMatrixSyncFlightRecorder(client);

    client.emitClient(ClientEvent.Event, makeEvent('$first', roomId));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    client.emitClient(ClientEvent.Event, makeEvent('$second', roomId, true));
    href = 'https://chat.mindroom.test/%23space:example.org/room?threadId=%24thread';
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);

    expect(storage.writes).toEqual([FLIGHT_RECORDER_CURRENT_KEY, FLIGHT_RECORDER_CURRENT_KEY]);
    expect(readCurrent(storage).events).toMatchObject([
      { type: 'matrix_sync', route: 'home', hasThreadId: false, editCount: 0 },
      { type: 'matrix_sync', route: 'space', hasThreadId: true, editCount: 1 },
    ]);
  });

  it('discards saved-sync cache arrivals before attributing the first live batch', () => {
    const roomId = '!cache-room:example.org';
    disposeRecorder = installFlightRecorder(storage);
    storage.writes.length = 0;
    const client = createClient();
    disposeMatrix = installMatrixSyncFlightRecorder(client);

    client.emitClient(ClientEvent.Event, makeEvent('$cached-edit', roomId, true));
    client.emitClient(ClientEvent.Sync, SyncState.Prepared, null, { fromCache: true });
    client.emitClient(ClientEvent.Event, makeEvent('$live-message', roomId));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared, {
      fromCache: false,
    });

    expect(readCurrent(storage).events).toMatchObject([
      { type: 'matrix_sync', eventCount: 1, editCount: 0 },
    ]);
    expect(storage.writes).toEqual([FLIGHT_RECORDER_CURRENT_KEY]);
  });

  it('stays inert until the native flight recorder runtime is active', () => {
    const client = createClient();
    const inactiveDispose = installMatrixSyncFlightRecorder(client);

    expect(client.listenerCount(ClientEvent.Event)).toBe(0);
    expect(client.listenerCount(ClientEvent.Sync)).toBe(0);
    inactiveDispose();

    disposeRecorder = installFlightRecorder(storage);
    disposeMatrix = installMatrixSyncFlightRecorder(client);
    expect(client.listenerCount(ClientEvent.Event)).toBe(1);
    expect(client.listenerCount(ClientEvent.Sync)).toBe(1);
  });

  it('drops detached batches and can reattach after disposal or client stop', () => {
    disposeRecorder = installFlightRecorder(storage);
    storage.writes.length = 0;
    const client = createClient();
    const firstDispose = installMatrixSyncFlightRecorder(client);
    expect(installMatrixSyncFlightRecorder(client)).toBe(firstDispose);
    firstDispose();

    client.emitClient(ClientEvent.Event, makeEvent('$detached', '!room:example.org', true));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
    expect(storage.writes).toEqual([]);

    disposeMatrix = installMatrixSyncFlightRecorder(client);
    client.emitClient(ClientEvent.Event, makeEvent('$reattached', '!room:example.org', true));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    expect(storage.writes).toEqual([FLIGHT_RECORDER_CURRENT_KEY]);

    client.emitClient(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
    expect(client.listenerCount(ClientEvent.Event)).toBe(0);
    expect(client.listenerCount(ClientEvent.Sync)).toBe(0);
    client.emitClient(ClientEvent.Event, makeEvent('$after-stop', '!room:example.org'));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Stopped);
    expect(storage.writes).toHaveLength(1);

    disposeMatrix = installMatrixSyncFlightRecorder(client);
    client.emitClient(ClientEvent.Event, makeEvent('$after-reattach', '!room:example.org'));
    client.emitClient(ClientEvent.Sync, SyncState.Syncing, SyncState.Stopped);
    expect(storage.writes).toHaveLength(2);
  });

  it('keeps legacy schema-v1 sessions valid after adding matrix sync events', () => {
    const prior = makePriorSession([{ at: 925, type: 'voice', state: 'recording' }]);
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));

    disposeRecorder = installFlightRecorder(storage);

    expect(JSON.parse(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY) ?? 'null')).toMatchObject({
      sessionId: prior.sessionId,
      events: prior.events,
    });
  });

  it('retains matrix sync evidence alongside the optional last action on relaunch', () => {
    const matrixSyncEvent = {
      at: 925,
      type: 'matrix_sync',
      roomHash: '1234abcd',
      eventCount: 2,
      editCount: 1,
      route: 'home',
      hasThreadId: false,
    } as const;
    const lastAction = { at: 940, kind: 'button', surface: 'timeline' } as const;
    const prior = makePriorSession([matrixSyncEvent], {
      sessionId: '22222222-2222-4222-8222-222222222222',
      lastAction,
    });
    storage.values.set(FLIGHT_RECORDER_CURRENT_KEY, JSON.stringify(prior));

    disposeRecorder = installFlightRecorder(storage);

    const abnormal = JSON.parse(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY) ?? 'null');
    expect(Object.keys(abnormal)).toHaveLength(15);
    expect(abnormal).toMatchObject({
      sessionId: prior.sessionId,
      events: [matrixSyncEvent],
      lastAction,
    });
  });

  it.each([
    ['raw room id', { roomHash: '!room:example.org' }],
    ['zero events', { eventCount: 0 }],
    ['too many edits', { eventCount: 1, editCount: 2 }],
    ['fractional count', { eventCount: 1.5 }],
    ['extra key', { extra: 'private' }],
  ])('strictly rejects prior matrix sync events with %s', (_case, override) => {
    const invalidEvent = {
      at: 925,
      type: 'matrix_sync',
      roomHash: '1234abcd',
      eventCount: 2,
      editCount: 1,
      route: 'home',
      hasThreadId: false,
      ...override,
    } as FlightRecorderSession['events'][number];
    storage.values.set(
      FLIGHT_RECORDER_CURRENT_KEY,
      JSON.stringify(makePriorSession([invalidEvent]))
    );

    disposeRecorder = installFlightRecorder(storage);

    expect(storage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
    expect(readCurrent(storage).events).toEqual([]);
    expect(storage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).not.toContain('private');
  });
});
