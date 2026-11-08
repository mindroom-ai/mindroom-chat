// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { ClientBindAtoms } from '../shell/ClientBindAtoms';
import { CallFeatures } from './CallFeatures';
import { activeCallAtom, type ActiveCall } from './callStore';
import { CallTranscription } from './transcription/CallTranscription';
import { startAgentCall } from './agent/agentCaller';

// CallResume waits for a server sync before it reads the reload's call record; this client
// syncs only in the tests that set `syncState`, so the others stay about the page and the panel.
const client = vi.hoisted(() => ({
  syncState: null as string | null,
  clientRunning: true,
  getSyncState(): string | null {
    return this.syncState;
  },
  on: () => undefined,
  off: () => undefined,
  getSafeUserId: () => '@me:calls.test',
  getUserId: () => '@me:calls.test',
  getDeviceId: () => 'TABDEVICE',
  rooms: new Map<string, unknown>(),
  getRoom(roomId: string): unknown {
    return this.rooms.get(roomId);
  },
}));
// Withdrawing leftover memberships finishes when a test says so.
const leftovers = vi.hoisted(() => ({ withdrawn: Promise.resolve() }));
vi.mock('./callResume', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callResume')>()),
  withdrawLeftoverMemberships: vi.fn(() => leftovers.withdrawn),
}));
vi.mock('./RoomCall', () => ({
  RoomCall: class {
    join = async () => undefined;
  },
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: false }),
}));
vi.mock('./IncomingCalls', () => ({ IncomingCalls: () => null }));
vi.mock('./IncomingCalls.css', () => ({ Host: 'incoming-calls' }));
vi.mock('./agent/AgentCallFailureNotice', () => ({
  AgentCallFailureNotice: () => null,
}));
// Transcription has tests of its own; here it only has to be there.
vi.mock('./transcription/CallTranscription', () => ({ CallTranscription: vi.fn(() => null) }));
vi.mock('./agent/agentCaller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agent/agentCaller')>()),
  startAgentCall: vi.fn(),
}));
// The account's screens sit in the real gate; its binders need a client this fake is not.
vi.mock('../shell/useBindAtoms', () => ({ useBindAtoms: vi.fn() }));

const RESUME_KEY = 'mindroom.call.resume';

/** The call features as the signed-in pages hold them, behind the account's gate. */
const mount = (store: ReturnType<typeof createStore>) => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ClientBindAtoms>
          <CallFeatures />
        </ClientBindAtoms>
      </Provider>
    );
  });
  return () => act(() => renderer?.unmount());
};

const runningCall = () => {
  const leave = vi.fn(async () => undefined);
  const active = {
    kind: 'room',
    call: {
      room: { roomId: '!call:calls.test' },
      leave,
      getState: () => ({ phase: 'connected', microphone: true, camera: false, devices: {} }),
    },
  } as unknown as ActiveCall;
  return { active, leave };
};

const pageTransition = (type: 'pagehide' | 'pageshow', persisted: boolean) =>
  act(() => {
    window.dispatchEvent(new PageTransitionEvent(type, { persisted }));
  });

afterEach(() => {
  sessionStorage.clear();
  client.syncState = null;
  client.rooms.clear();
  leftovers.withdrawn = Promise.resolve();
});

describe('CallFeatures', () => {
  it('ends the call for good when the page goes into the back/forward cache', () => {
    const store = createStore();
    const unmount = mount(store);
    const { active, leave } = runningCall();
    store.set(activeCallAtom, active);

    pageTransition('pagehide', true);

    expect(leave).toHaveBeenCalledTimes(1);
    // Back shows the page without a dead call that would answer every new call `busy`.
    expect(store.get(activeCallAtom)).toBeUndefined();
    // And a reload soon after does not take the ended call up again.
    expect(sessionStorage.getItem(RESUME_KEY)).toBeNull();
    unmount();
  });

  it('remembers the call when the page unloads, so a reload takes it up', () => {
    const store = createStore();
    const unmount = mount(store);
    const { active, leave } = runningCall();
    store.set(activeCallAtom, active);

    pageTransition('pagehide', false);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? '{}').roomId).toBe('!call:calls.test');
    unmount();
  });

  it('forgets a remembered call when the page comes back from the back/forward cache', () => {
    const store = createStore();
    const unmount = mount(store);
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ roomId: '!call:calls.test' }));

    pageTransition('pageshow', true);

    expect(sessionStorage.getItem(RESUME_KEY)).toBeNull();
    unmount();
  });

  it('takes up no call for an account that signed out or switched while leftovers went', async () => {
    const roomId = '!call:calls.test';
    const room = {
      roomId,
      getMyMembership: () => 'join',
      loadMembersIfNeeded: vi.fn(async () => undefined),
      getLiveTimeline: () => ({ getEvents: () => [] }),
    };
    client.rooms.set(roomId, room);
    client.syncState = 'SYNCING';
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        userId: '@me:calls.test',
        deviceId: 'TABDEVICE',
        roomId,
        kind: 'room',
        microphone: true,
        camera: false,
        devices: {},
        savedAt: Date.now(),
      })
    );
    let withdrawn!: () => void;
    leftovers.withdrawn = new Promise<void>((resolve) => {
      withdrawn = resolve;
    });
    const store = createStore();
    const unmount = mount(store);
    await vi.waitFor(() => expect(sessionStorage.getItem(RESUME_KEY)).toBeNull());

    unmount();
    withdrawn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(room.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(store.get(activeCallAtom)).toBeUndefined();
  });

  it('takes an agent call up again with the camera it had', async () => {
    const roomId = '!agentcall:calls.test';
    client.rooms.set(roomId, {
      roomId,
      getMyMembership: () => 'join',
      getLiveTimeline: () => ({ getState: () => undefined }),
    });
    client.syncState = 'SYNCING';
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        userId: '@me:calls.test',
        deviceId: 'TABDEVICE',
        roomId,
        kind: 'agent',
        agentUserId: '@mindroom_helper:calls.test',
        origin: { roomId: '!planning:calls.test' },
        microphone: true,
        camera: true,
        devices: {},
        savedAt: Date.now(),
      })
    );
    const unmount = mount(createStore());

    await vi.waitFor(() =>
      expect(startAgentCall).toHaveBeenCalledWith(
        client,
        expect.any(Function),
        expect.objectContaining({ agentUserId: '@mindroom_helper:calls.test', video: true })
      )
    );
    unmount();
  });

  it("transcribes this device's speech in the call", () => {
    const unmount = mount(createStore());
    expect(CallTranscription).toHaveBeenCalled();
    unmount();
  });

  it('leaves the call when the screens of its account go away', () => {
    const store = createStore();
    const unmount = mount(store);
    const { active, leave } = runningCall();
    store.set(activeCallAtom, active);

    unmount();

    expect(leave).toHaveBeenCalledTimes(1);
    expect(store.get(activeCallAtom)).toBeUndefined();
  });
});
