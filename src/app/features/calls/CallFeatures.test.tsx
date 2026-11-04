// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { CallFeatures } from './CallFeatures';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from './callStore';

// CallResume waits for a server sync before it reads the reload's call record; this client never
// syncs, so the test stays about the panel and nothing resumes after it ends.
const client = vi.hoisted(() => ({
  getSyncState: () => null,
  on: () => undefined,
  off: () => undefined,
  getSafeUserId: () => '@me:calls.test',
  getUserId: () => '@me:calls.test',
  getDeviceId: () => 'TABDEVICE',
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../pages/client/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: false }),
}));
vi.mock('./IncomingCalls', () => ({ IncomingCalls: () => null }));
vi.mock('./IncomingCalls.css', () => ({ Host: 'incoming-calls' }));
vi.mock('../../mindroom/calls/AgentCallFailureNotice', () => ({
  AgentCallFailureNotice: () => null,
}));
vi.mock('../../mindroom/calls/agentCaller', () => ({ startAgentCall: vi.fn() }));

const RESUME_KEY = 'mindroom.call.resume';

const mount = (store: ReturnType<typeof createStore>) => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <CallFeatures />
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

afterEach(() => sessionStorage.clear());

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

  it('closes the call panel when the account it belongs to goes away', () => {
    const store = createStore();
    const unmount = mount(store);
    store.set(callPanelRoomAtom, '!shared:example.org');

    unmount();

    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });
});
