import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { activeCallAtom, useCallActions, type ActiveCall } from './callStore';

vi.mock('./RoomCall', () => ({
  RoomCall: class {
    join = vi.fn(async () => undefined);

    room: Room;

    constructor({ room }: { room: Room }) {
      this.room = room;
    }
  },
}));

const actionsIn = (store: ReturnType<typeof createStore>, mx = {} as MatrixClient) => {
  let actions!: ReturnType<typeof useCallActions>;
  function Probe() {
    actions = useCallActions(mx);
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
});

/** A signed-in account's running client, alone in its session (no other tab holds its lock). */
const runningClient = () =>
  ({
    clientRunning: true,
    getSafeUserId: () => '@me:calls.test',
    getDeviceId: () => 'TABDEVICE',
  } as unknown as MatrixClient);

describe('useCallActions startCall', () => {
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
    const finishLoading = async () => {
      await vi.waitFor(() => expect(loaded).toBeDefined());
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

  it("answers busy while another tab of this session is in a call, and leaves that tab's call alone", async () => {
    const lockName = 'mindroom-call:@me:calls.test:TABDEVICE';
    vi.stubGlobal('navigator', {
      locks: { query: async () => ({ held: [{ name: lockName }], pending: [] }) },
    });
    const store = createStore();
    const mx = runningClient();
    const { room } = slowRoom();

    try {
      await expect(actionsIn(store, mx).startCall({ room, kind: 'room' })).resolves.toBe('busy');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(store.get(activeCallAtom)).toBeUndefined();
  });

  it('leaves the store alone when the account signed out or switched while the call started', async () => {
    const store = createStore();
    const mx = runningClient();
    const { room, finishLoading } = slowRoom();
    const starting = actionsIn(store, mx).startCall({ room, kind: 'room' });
    // The account went away: the shell stopped its client and cleared the store.
    mx.clientRunning = false;
    await finishLoading();

    await expect(starting).resolves.toBe('failed');
    expect(store.get(activeCallAtom)).toBeUndefined();
  });
});
