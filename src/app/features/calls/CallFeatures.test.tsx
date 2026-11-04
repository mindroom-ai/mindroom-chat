// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { CallFeatures } from './CallFeatures';
import { callPanelRoomAtom } from './callStore';

// CallResume waits for a server sync before it reads the reload's call record; this client never
// syncs, so the test stays about the panel and nothing resumes after it ends.
const client = vi.hoisted(() => ({
  getSyncState: () => null,
  on: () => undefined,
  off: () => undefined,
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

describe('CallFeatures', () => {
  it('closes the call panel when the account it belongs to goes away', () => {
    const store = createStore();
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <CallFeatures />
        </Provider>
      );
    });
    store.set(callPanelRoomAtom, '!shared:example.org');

    act(() => renderer?.unmount());

    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });
});
