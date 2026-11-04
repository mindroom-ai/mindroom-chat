import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClientEvent, SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { CallState, RoomCall } from './RoomCall';
import type { ActiveCall } from './callStore';
import {
  RESUME_WINDOW_MS,
  deviceInCallElsewhere,
  rememberCallForResume,
  takeDeviceCallLock,
  takeCallResume,
  whenServerSynced,
  withdrawLeftoverMemberships,
} from './callResume';
import {
  fakeWebLocks,
  holdLockInOtherTab,
  settleLocks,
  type FakeWebLocks,
} from '../../test-utils/fakeWebLocks';

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

const LOCK_NAME = `mindroom-call:${ME}:${DEVICE}`;

/** Another tab of the same session in a call: it holds the device's lock from its own page. */
const otherTabHolds = (locks: FakeWebLocks) => holdLockInOtherTab(locks, LOCK_NAME);

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
    vi.stubGlobal('navigator', { locks: fakeWebLocks() });
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
    const locks = fakeWebLocks();
    vi.stubGlobal('navigator', { locks });
    const { mx, sendStateEvent } = clientWith([roomWithCallState('!a', [mine])]);
    const otherTab = otherTabHolds(locks);
    await settleLocks();
    await withdrawLeftoverMemberships(mx);
    expect(sendStateEvent).not.toHaveBeenCalled();

    await otherTab.release();
    await withdrawLeftoverMemberships(mx);
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });
});

describe('the device call lock', () => {
  let locks: FakeWebLocks;

  beforeEach(() => {
    locks = fakeWebLocks();
    vi.stubGlobal('navigator', { locks });
  });

  afterEach(async () => {
    await settleLocks();
    vi.unstubAllGlobals();
  });

  const lockNames = async () => {
    const { held, pending } = await locks.query();
    return { held: held.map(({ name }) => name), pending: pending.map(({ name }) => name) };
  };

  it('is taken when no other tab holds it, and let go once the call releases it', async () => {
    const { mx } = clientWith();
    const release = await takeDeviceCallLock(mx);
    expect(release).toBeTypeOf('function');
    expect(await lockNames()).toEqual({ held: [LOCK_NAME], pending: [] });

    release?.();
    await settleLocks();
    expect(await lockNames()).toEqual({ held: [], pending: [] });
  });

  it('answers busy at once while another tab holds it, without queueing behind that tab', async () => {
    const { mx } = clientWith();
    const otherTab = otherTabHolds(locks);
    await settleLocks();

    await expect(takeDeviceCallLock(mx)).resolves.toBeUndefined();
    expect(await lockNames()).toEqual({ held: [LOCK_NAME], pending: [] });
    await otherTab.release();
  });

  it('lets only one of two tabs through when both start a call at the same moment', async () => {
    const { mx } = clientWith();
    // Each tab is a page of its own, with its own copy of the module and what it counts.
    vi.resetModules();
    const secondTab = await import('./callResume');

    const [first, second] = await Promise.all([
      takeDeviceCallLock(mx),
      secondTab.takeDeviceCallLock(mx),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await lockNames()).toEqual({ held: [LOCK_NAME], pending: [] });
    first?.();
    second?.();
  });

  it("queues a new call behind this tab's own call that is still ending", async () => {
    const { mx } = clientWith();
    const ending = await takeDeviceCallLock(mx);
    // The call ended, but the browser has not let its lock go yet when the next one starts.
    ending?.();
    const next = await takeDeviceCallLock(mx);

    expect(next).toBeTypeOf('function');
    await settleLocks();
    expect(await lockNames()).toEqual({ held: [LOCK_NAME], pending: [] });
    next?.();
  });

  it("tells another tab's call from this tab's own", async () => {
    const { mx } = clientWith();
    expect(await deviceInCallElsewhere(mx)).toBe(false);

    // This tab's call, also while its lock is still on the way out after the call ended.
    const release = await takeDeviceCallLock(mx);
    expect(await deviceInCallElsewhere(mx)).toBe(false);
    release?.();
    expect(await deviceInCallElsewhere(mx)).toBe(false);
    await settleLocks();

    const otherTab = otherTabHolds(locks);
    await settleLocks();
    expect(await deviceInCallElsewhere(mx)).toBe(true);
    // This tab tried to start a call meanwhile and was told busy: that counts as nothing here.
    expect(await takeDeviceCallLock(mx)).toBeUndefined();
    expect(await deviceInCallElsewhere(mx)).toBe(true);
    await otherTab.release();
    expect(await deviceInCallElsewhere(mx)).toBe(false);
  });

  it('lets a call go on when the lock manager refuses requests', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: () => Promise.reject(new DOMException('No locks here', 'SecurityError')) },
    });
    await expect(takeDeviceCallLock(clientWith().mx)).resolves.toBeTypeOf('function');
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
