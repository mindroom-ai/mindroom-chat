import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  activeCallAtom,
  callPanelRoomAtom,
  callStartProblemAtom,
  forgetCallState,
  noteCallStart,
  useCallActions,
  useInCall,
  type ActiveCall,
} from './callStore';
import type { CallPhase, CallState } from './RoomCall';
import { requestOwnSfuGrant } from './rtcFocus';
import {
  fakeWebLocks,
  holdLockInOtherTab,
  settleLocks,
  type FakeWebLocks,
} from '../../test/utils/fakeWebLocks';

// Until a test lets it load, the call engine's chunk is missing, as after a deploy replaced it.
const engine = vi.hoisted(() => ({ missing: true, joinBreaks: false }));
vi.mock('./RoomCall', () => {
  if (engine.missing) throw new Error('Failed to fetch dynamically imported module');
  return { RoomCall: FakeRoomCall };
});

const FakeRoomCall = vi.hoisted(
  () =>
    class {
      join = vi.fn(async () => {
        if (engine.joinBreaks) throw new Error('joinRTCSession threw');
      });

      fail = vi.fn();

      room: Room;

      releaseDeviceLock?: () => void;

      grant?: Promise<unknown>;

      constructor({
        room,
        releaseDeviceLock,
        grant,
      }: {
        room: Room;
        releaseDeviceLock?: () => void;
        grant?: Promise<unknown>;
      }) {
        this.room = room;
        this.releaseDeviceLock = releaseDeviceLock;
        this.grant = grant;
      }
    }
);

vi.mock('./rtcFocus', () => ({ requestOwnSfuGrant: vi.fn(async () => undefined) }));

const actionsIn = (
  store: ReturnType<typeof createStore>,
  mx = {} as MatrixClient,
  useActions = useCallActions
) => {
  let actions!: ReturnType<typeof useCallActions>;
  function Probe() {
    actions = useActions(mx);
    return null;
  }
  act(() => {
    create(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
  });
  return actions;
};

describe('useCallActions endCall', () => {
  it('ends the call even when leaving it fails, so the next call can start', async () => {
    const store = createStore();
    const onEnded = vi.fn(async () => undefined);
    const active = {
      kind: 'room',
      call: { leave: vi.fn(async () => Promise.reject(new Error('LiveKit gone'))) },
      onEnded,
    } as unknown as ActiveCall;
    store.set(activeCallAtom, active);

    await expect(actionsIn(store).endCall()).rejects.toThrow('LiveKit gone');

    expect(store.get(activeCallAtom)).toBeUndefined();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  /** A call this device is in, left at once: an agent call from `!planning`, or a room call. */
  const callIn = (kind: 'agent' | 'room') =>
    ({
      kind,
      call: { room: { roomId: '!callroom:calls.test' }, leave: vi.fn(async () => undefined) },
      ...(kind === 'agent' && {
        agentUserId: '@mindroom_helper:calls.test',
        origin: { roomId: '!planning:calls.test' },
      }),
    } as unknown as ActiveCall);

  it("closes the agent call's panel in its conversation, which would show that room's own call", async () => {
    const store = createStore();
    store.set(activeCallAtom, callIn('agent'));
    store.set(callPanelRoomAtom, '!planning:calls.test');

    await actionsIn(store).endCall();

    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });

  it("keeps a room call's panel open on the call to join again", async () => {
    const store = createStore();
    store.set(activeCallAtom, callIn('room'));
    store.set(callPanelRoomAtom, '!callroom:calls.test');

    await actionsIn(store).endCall();

    expect(store.get(callPanelRoomAtom)).toBe('!callroom:calls.test');
  });

  it('leaves the panel of another room open after an agent call', async () => {
    const store = createStore();
    store.set(activeCallAtom, callIn('agent'));
    store.set(callPanelRoomAtom, '!elsewhere:calls.test');

    await actionsIn(store).endCall();

    expect(store.get(callPanelRoomAtom)).toBe('!elsewhere:calls.test');
  });

  it('closes the panel of an agent call dismissed after it failed', () => {
    const store = createStore();
    store.set(activeCallAtom, callIn('agent'));
    store.set(callPanelRoomAtom, '!planning:calls.test');

    actionsIn(store).dismissCall();

    expect(store.get(activeCallAtom)).toBeUndefined();
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });
});

/** A signed-in account's running client, alone in its session (no other tab holds its lock). */
const runningClient = () =>
  ({
    clientRunning: true,
    getSafeUserId: () => '@me:calls.test',
    getDeviceId: () => 'TABDEVICE',
  } as unknown as MatrixClient);

describe('useCallActions startCall', () => {
  // Without a lock manager unless a test brings one (Node has its own since version 24).
  beforeEach(() => {
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // First in this block: a module that failed to load is loaded again on the next import.
  it('answers failed, without an unhandled rejection, and undoes what it prepared, when the call engine cannot load', async () => {
    const store = createStore();
    const room = {
      roomId: '!call:calls.test',
      loadMembersIfNeeded: async () => undefined,
    } as unknown as Room;
    const prepare = vi.fn(async () => undefined);
    const onEnded = vi.fn(async () => undefined);

    await expect(
      actionsIn(store, runningClient()).startCall({ room, kind: 'agent', prepare, onEnded })
    ).resolves.toBe('failed');
    expect(store.get(activeCallAtom)).toBeUndefined();
    // The engine loads while the call is prepared, so what was prepared is undone.
    expect(onEnded).toHaveBeenCalledTimes(1);
    engine.missing = false;
  });

  it("asks for the call service's grant while the call is prepared, and hands it to the call", async () => {
    const store = createStore();
    const mx = runningClient();
    const grant = { serviceUrl: 'https://rtc.calls.test', grant: { url: 'wss://sfu', jwt: 'jwt' } };
    vi.mocked(requestOwnSfuGrant).mockClear();
    vi.mocked(requestOwnSfuGrant).mockResolvedValueOnce(grant);
    let askedBeforePrepared = false;
    const prepare = vi.fn(async () => {
      askedBeforePrepared = vi.mocked(requestOwnSfuGrant).mock.calls.length === 1;
    });
    const room = {
      roomId: '!call:calls.test',
      loadMembersIfNeeded: async () => undefined,
      getLiveTimeline: () => ({ getEvents: () => [] }),
    } as unknown as Room;

    await expect(actionsIn(store, mx).startCall({ room, kind: 'agent', prepare })).resolves.toBe(
      'started'
    );

    expect(askedBeforePrepared).toBe(true);
    expect(requestOwnSfuGrant).toHaveBeenCalledWith(mx, '!call:calls.test');
    const call = store.get(activeCallAtom)?.call as unknown as { grant?: Promise<unknown> };
    await expect(call.grant).resolves.toBe(grant);
  });

  it('starts the call with no early grant when asking for it failed', async () => {
    const store = createStore();
    vi.mocked(requestOwnSfuGrant).mockRejectedValueOnce(new Error('403'));
    const room = {
      roomId: '!call:calls.test',
      loadMembersIfNeeded: async () => undefined,
      getLiveTimeline: () => ({ getEvents: () => [] }),
    } as unknown as Room;

    await expect(actionsIn(store, runningClient()).startCall({ room, kind: 'room' })).resolves.toBe(
      'started'
    );
    const call = store.get(activeCallAtom)?.call as unknown as { grant?: Promise<unknown> };
    await expect(call.grant).resolves.toBeUndefined();
  });

  /** A room whose members load when the test says so. */
  const slowRoom = () => {
    let loaded: (() => void) | undefined;
    const room = {
      roomId: '!call:calls.test',
      loadMembersIfNeeded: () =>
        new Promise<void>((resolve) => {
          loaded = resolve;
        }),
      getLiveTimeline: () => ({ getEvents: () => [] }),
    } as unknown as Room;
    const finishLoading = async (meanwhile?: () => void) => {
      await vi.waitFor(() => expect(loaded).toBeDefined());
      meanwhile?.();
      loaded?.();
    };
    return { room, finishLoading };
  };

  it('starts the call on a running client', async () => {
    const store = createStore();
    const { room, finishLoading } = slowRoom();
    const starting = actionsIn(store, runningClient()).startCall({ room, kind: 'room' });
    await finishLoading();

    await expect(starting).resolves.toBe('started');
    expect(store.get(activeCallAtom)?.call.room).toBe(room);
  });

  describe('with the browser lock manager', () => {
    const LOCK_NAME = 'mindroom-call:@me:calls.test:TABDEVICE';
    let locks: FakeWebLocks;

    const useLocks = () => {
      locks = fakeWebLocks();
      vi.stubGlobal('navigator', { locks });
    };

    afterEach(async () => {
      await settleLocks();
      vi.unstubAllGlobals();
    });

    /** A room whose members are loaded already. */
    const loadedRoom = () =>
      ({
        roomId: '!call:calls.test',
        loadMembersIfNeeded: async () => undefined,
        getLiveTimeline: () => ({ getEvents: () => [] }),
      } as unknown as Room);

    it("answers busy while another tab of this session is in a call, and leaves that tab's call alone", async () => {
      useLocks();
      const otherTab = holdLockInOtherTab(locks, LOCK_NAME);
      await settleLocks();
      const store = createStore();
      const prepare = vi.fn(async () => undefined);

      await expect(
        actionsIn(store, runningClient()).startCall({ room: loadedRoom(), kind: 'agent', prepare })
      ).resolves.toBe('busy');

      expect(store.get(activeCallAtom)).toBeUndefined();
      // Nothing was written for a call that does not start, such as an agent call room's origin.
      expect(prepare).not.toHaveBeenCalled();
      await otherTab.release();
    });

    it('lets only one of two tabs of the session start when both start at the same moment', async () => {
      useLocks();
      // The second tab is a page of its own: its own store, and its own copy of the modules.
      vi.resetModules();
      const secondTab = await import('./callStore');
      const firstStore = createStore();
      const secondStore = createStore();
      const first = actionsIn(firstStore, runningClient());
      const second = actionsIn(secondStore, runningClient(), secondTab.useCallActions);

      const results = await Promise.all([
        first.startCall({ room: loadedRoom(), kind: 'room' }),
        second.startCall({ room: loadedRoom(), kind: 'room' }),
      ]);

      expect([...results].sort()).toEqual(['busy', 'started']);
      const started = firstStore.get(activeCallAtom) ?? secondStore.get(secondTab.activeCallAtom);
      const call = started?.call as unknown as { releaseDeviceLock?: () => void };
      // The call that started holds the lock and lets it go when it ends.
      expect(call.releaseDeviceLock).toBeTypeOf('function');
      call.releaseDeviceLock?.();
    });

    it('lets the lock go and undoes what it prepared when the account went away meanwhile', async () => {
      useLocks();
      const store = createStore();
      const mx = runningClient();
      const onEnded = vi.fn(async () => undefined);
      // The account switched while the agent call room's origin was being written.
      const prepare = vi.fn(async () => {
        mx.clientRunning = false;
      });

      await expect(
        actionsIn(store, mx).startCall({ room: loadedRoom(), kind: 'agent', prepare, onEnded })
      ).resolves.toBe('failed');

      expect(store.get(activeCallAtom)).toBeUndefined();
      expect(onEnded).toHaveBeenCalledTimes(1);
      await settleLocks();
      expect((await locks.query()).held).toEqual([]);
    });

    it('answers failed, and undoes it, when preparing the call fails', async () => {
      useLocks();
      const store = createStore();
      const onEnded = vi.fn(async () => undefined);
      const prepare = vi.fn(async () => Promise.reject(new Error('invite refused')));

      await expect(
        actionsIn(store, runningClient()).startCall({
          room: loadedRoom(),
          kind: 'agent',
          prepare,
          onEnded,
        })
      ).resolves.toBe('failed');

      expect(onEnded).toHaveBeenCalledTimes(1);
      await settleLocks();
      expect((await locks.query()).held).toEqual([]);
    });

    it('answers busy to a second start in the same tab while the first is still starting', async () => {
      useLocks();
      const store = createStore();
      const actions = actionsIn(store, runningClient());
      const { room, finishLoading } = slowRoom();
      const prepare = vi.fn(async () => undefined);

      const starting = actions.startCall({ room, kind: 'room' });
      await expect(actions.startCall({ room: loadedRoom(), kind: 'agent', prepare })).resolves.toBe(
        'busy'
      );
      expect(prepare).not.toHaveBeenCalled();
      await finishLoading();

      await expect(starting).resolves.toBe('started');
      const call = store.get(activeCallAtom)?.call as unknown as { releaseDeviceLock?: () => void };
      call.releaseDeviceLock?.();
    });
  });

  it('fails the call with the service problem when its join breaks, without a rejection', async () => {
    engine.joinBreaks = true;
    const store = createStore();
    const { room, finishLoading } = slowRoom();
    const starting = actionsIn(store, runningClient()).startCall({ room, kind: 'room' });
    await finishLoading();

    try {
      await expect(starting).resolves.toBe('started');
    } finally {
      engine.joinBreaks = false;
    }
    const call = store.get(activeCallAtom)?.call as unknown as { fail: ReturnType<typeof vi.fn> };
    expect(call.fail).toHaveBeenCalledWith('service');
  });

  it("lets a start its account left behind end without ending the next account's start", async () => {
    const store = createStore();
    const alice = runningClient();
    const left = slowRoom();
    const leftStart = actionsIn(store, alice).startCall({ room: left.room, kind: 'room' });
    const bob = actionsIn(store, runningClient());
    const next = slowRoom();
    let nextStart: Promise<string> | undefined;
    // Alice switches to Bob while her call room's members load; Bob starts a call of his own.
    await left.finishLoading(() => {
      alice.clientRunning = false;
      forgetCallState(store);
      nextStart = bob.startCall({ room: next.room, kind: 'room' });
    });
    await expect(leftStart).resolves.toBe('failed');

    // Bob's start is still the one running: a second start of his waits its turn.
    await expect(bob.startCall({ room: next.room, kind: 'room' })).resolves.toBe('busy');
    await next.finishLoading();
    await expect(nextStart).resolves.toBe('started');
  });

  it('leaves the store alone when the account signed out or switched while the call started', async () => {
    const store = createStore();
    const mx = runningClient();
    const { room, finishLoading } = slowRoom();
    const starting = actionsIn(store, mx).startCall({ room, kind: 'room' });
    // The account went away while the room's members loaded: the shell stopped its client and
    // cleared the store.
    await finishLoading(() => {
      mx.clientRunning = false;
    });

    await expect(starting).resolves.toBe('failed');
    expect(store.get(activeCallAtom)).toBeUndefined();
  });
});

describe('noteCallStart', () => {
  const ROOM = '!call:calls.test';

  it("keeps why the room's call did not start until a start that does", () => {
    const store = createStore();
    const mx = runningClient();

    expect(noteCallStart(store, mx, ROOM, 'busy')).toBe(true);
    expect(store.get(callStartProblemAtom)).toEqual({ roomId: ROOM, result: 'busy' });
    expect(noteCallStart(store, mx, ROOM, 'started')).toBe(false);
    expect(store.get(callStartProblemAtom)).toBeUndefined();
  });

  it('notes nothing for a start whose account signed out or switched meanwhile', () => {
    const store = createStore();
    const mx = runningClient();
    mx.clientRunning = false;

    expect(noteCallStart(store, mx, ROOM, 'failed')).toBe(false);
    expect(store.get(callStartProblemAtom)).toBeUndefined();
  });
});

describe('useInCall', () => {
  it('answers whether this device is in a call, rendering again only when that changes', () => {
    let phase: CallPhase = 'connecting';
    const listeners = new Set<() => void>();
    const call = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getState: () => ({ phase } as CallState),
    };
    const store = createStore();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useInCall());
      return null;
    }
    act(() => {
      create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });
    const moveTo = (next: CallPhase) =>
      act(() => {
        phase = next;
        listeners.forEach((listener) => listener());
      });

    expect(seen.at(-1)).toBe(false);
    act(() => store.set(activeCallAtom, { kind: 'room', call } as unknown as ActiveCall));
    expect(seen.at(-1)).toBe(true);
    const renders = seen.length;
    moveTo('connected');
    moveTo('reconnecting');
    expect(seen).toHaveLength(renders);
    // A call that failed waits for its panel to close; it no longer counts.
    moveTo('failed');
    expect(seen.at(-1)).toBe(false);
    act(() => store.set(activeCallAtom, undefined));
    expect(seen.at(-1)).toBe(false);
  });
});
