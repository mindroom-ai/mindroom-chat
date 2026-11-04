import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClientEvent, SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { CallState, RoomCall } from './RoomCall';
import type { ActiveCall } from './callStore';
import {
  RESUME_WINDOW_MS,
  holdDeviceCallLock,
  rememberCallForResume,
  takeCallResume,
  whenServerSynced,
  withdrawLeftoverMemberships,
} from './callResume';

const ME = '@me:calls.test';
const DEVICE = 'TABDEVICE';
const CALL_MEMBER = 'org.matrix.msc3401.call.member';

/** A Storage stand-in, as session storage of one tab. */
const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

/** The Web Locks API, enough to hold locks and list them. */
const fakeLocks = () => {
  const held = new Map<string, number>();
  return {
    request: (name: string, callback: () => Promise<void>) => {
      held.set(name, (held.get(name) ?? 0) + 1);
      return callback().finally(() => {
        const count = (held.get(name) ?? 1) - 1;
        if (count === 0) held.delete(name);
        else held.set(name, count);
      });
    },
    query: async () => ({ held: [...held.keys()].map((name) => ({ name })), pending: [] }),
  };
};

type StateEventStub = { sender: string; stateKey: string; content: Record<string, unknown> };

const roomWithCallState = (roomId: string, events: StateEventStub[], membership = 'join'): Room =>
  ({
    roomId,
    getMyMembership: () => membership,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string) =>
          type === CALL_MEMBER
            ? events.map((event) => ({
                getSender: () => event.sender,
                getStateKey: () => event.stateKey,
                getContent: () => event.content,
              }))
            : [],
      }),
    }),
  } as unknown as Room);

const clientWith = (rooms: Room[] = [], deviceId = DEVICE) => {
  const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$left' });
  const mx = {
    getUserId: () => ME,
    getSafeUserId: () => ME,
    getDeviceId: () => deviceId,
    getRooms: () => rooms,
    sendStateEvent,
  } as unknown as MatrixClient;
  return { mx, sendStateEvent };
};

const activeCall = (state: Partial<CallState>, meta: Partial<ActiveCall> = {}): ActiveCall => ({
  kind: 'room',
  ...meta,
  call: {
    room: { roomId: '!call:calls.test' },
    getState: () => ({
      phase: 'connected',
      microphone: true,
      camera: false,
      sound: true,
      audioBlocked: false,
      devices: {},
      participants: [],
      ...state,
    }),
  } as unknown as RoomCall,
});

describe('resuming a call after a reload', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes up the call the previous page was in, once', () => {
    const { mx } = clientWith();
    rememberCallForResume(
      mx,
      activeCall(
        { microphone: false, camera: true, devices: { audioinput: 'mic-2' } },
        { kind: 'agent', agentUserId: '@mindroom_helper:calls.test', origin: { roomId: '!o' } }
      ),
      1_000
    );
    expect(takeCallResume(mx, 1_500)).toEqual({
      userId: ME,
      deviceId: DEVICE,
      roomId: '!call:calls.test',
      kind: 'agent',
      agentUserId: '@mindroom_helper:calls.test',
      origin: { roomId: '!o' },
      microphone: false,
      camera: true,
      devices: { audioinput: 'mic-2' },
      savedAt: 1_000,
    });
    expect(takeCallResume(mx, 1_500)).toBeUndefined();
  });

  it('starts without the call when the page comes back late or for another session', () => {
    const { mx } = clientWith();
    rememberCallForResume(mx, activeCall({}), 1_000);
    expect(takeCallResume(mx, 1_000 + RESUME_WINDOW_MS + 1)).toBeUndefined();

    rememberCallForResume(mx, activeCall({}), 1_000);
    expect(takeCallResume(clientWith([], 'OTHERDEVICE').mx, 1_000)).toBeUndefined();
  });

  it('remembers nothing for a call that already ended or failed', () => {
    const { mx } = clientWith();
    rememberCallForResume(mx, activeCall({ phase: 'ended' }), 1_000);
    rememberCallForResume(mx, activeCall({ phase: 'failed' }), 1_000);
    expect(takeCallResume(mx, 1_000)).toBeUndefined();
  });

  it('ignores a record it cannot read', () => {
    sessionStorage.setItem('mindroom.call.resume', '{not json');
    expect(takeCallResume(clientWith().mx, 1_000)).toBeUndefined();
    sessionStorage.setItem('mindroom.call.resume', JSON.stringify({ roomId: '!r' }));
    expect(takeCallResume(clientWith().mx, 1_000)).toBeUndefined();
  });
});

describe('withdrawLeftoverMemberships', () => {
  const mine = { sender: ME, stateKey: `_${ME}_${DEVICE}_m.call`, content: { device_id: DEVICE } };
  const otherDevice = {
    sender: ME,
    stateKey: `_${ME}_PHONE_m.call`,
    content: { device_id: 'PHONE' },
  };
  const someoneElse = {
    sender: '@maya:calls.test',
    stateKey: '_@maya:calls.test_LAPTOP_m.call',
    content: { device_id: 'LAPTOP' },
  };

  beforeEach(() => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("withdraws only this device's memberships, in joined rooms other than the resumed one", async () => {
    const { mx, sendStateEvent } = clientWith([
      roomWithCallState('!a', [mine, otherDevice, someoneElse]),
      roomWithCallState('!resumed', [mine]),
      roomWithCallState('!left', [mine], 'leave'),
    ]);
    await withdrawLeftoverMemberships(mx, '!resumed');
    expect(sendStateEvent.mock.calls).toEqual([['!a', CALL_MEMBER, {}, mine.stateKey]]);
  });

  it('leaves them while another tab of this device is in a call', async () => {
    const { mx, sendStateEvent } = clientWith([roomWithCallState('!a', [mine])]);
    const release = holdDeviceCallLock(mx);
    await withdrawLeftoverMemberships(mx);
    expect(sendStateEvent).not.toHaveBeenCalled();

    release();
    await Promise.resolve();
    await withdrawLeftoverMemberships(mx);
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });
});

describe('whenServerSynced', () => {
  const syncingClient = (state: SyncState | null) => {
    const emitter = new EventEmitter();
    const mx = {
      getSyncState: () => state,
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    } as unknown as MatrixClient;
    return { mx, emitter };
  };

  it('waits past a start from the cache for a sync from the server', async () => {
    const { mx, emitter } = syncingClient(SyncState.Prepared);
    let synced = false;
    void whenServerSynced(mx).then(() => {
      synced = true;
    });
    emitter.emit(ClientEvent.Sync, SyncState.Prepared);
    await Promise.resolve();
    expect(synced).toBe(false);
    emitter.emit(ClientEvent.Sync, SyncState.Syncing);
    await Promise.resolve();
    expect(synced).toBe(true);
    expect(emitter.listenerCount(ClientEvent.Sync)).toBe(0);
  });

  it('answers at once when the client already synced with the server', async () => {
    await expect(whenServerSynced(syncingClient(SyncState.Syncing).mx)).resolves.toBeUndefined();
  });
});
