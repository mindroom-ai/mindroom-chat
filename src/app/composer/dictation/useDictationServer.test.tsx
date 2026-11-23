// @vitest-environment jsdom
import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import { computerServicePreferenceAtom } from '../../computer/computerServiceSettings';
import { isDictationSupported, useDictationServer } from './useDictationServer';

const state = vi.hoisted(
  (): {
    roomServer: { apiUrl: string | undefined; pending: boolean };
    computers: { apiUrl?: string; trustedApiUrls?: string[] } | undefined;
    discoveredUrls: string[];
    send: ReturnType<typeof vi.fn>;
    sessionCache: Map<string, ClientSessions>;
  } => ({
    roomServer: { apiUrl: undefined, pending: false },
    computers: undefined,
    discoveredUrls: [],
    send: vi.fn(),
    sessionCache: new Map(),
  })
);

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({
    mindroom: state.computers ? { computers: state.computers } : undefined,
  }),
}));

vi.mock('../../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => state.roomServer,
}));

vi.mock('../../computer/useAgentServers', () => ({
  useAgentServerUrls: () => state.discoveredUrls,
}));

vi.mock('../../computer/clientSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../computer/clientSessions')>()),
  clientSessions: (_mx: unknown, apiUrl: string) => {
    let sessions = state.sessionCache.get(apiUrl);
    if (!sessions) {
      sessions = { send: state.send } as unknown as ClientSessions;
      state.sessionCache.set(apiUrl, sessions);
    }
    return sessions;
  },
}));

const installMediaCapabilities = (enabled: boolean) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: enabled ? { getUserMedia: vi.fn() } : undefined,
  });
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: enabled ? vi.fn() : undefined,
  });
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    configurable: true,
    value: enabled ? vi.fn() : undefined,
  });
};

const renderServerHook = (roomId?: string, store = createStore()) =>
  renderHook(() => useDictationServer(roomId), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });

beforeEach(() => {
  state.roomServer = { apiUrl: undefined, pending: false };
  state.computers = undefined;
  state.discoveredUrls = [];
  state.send = vi.fn(async () =>
    Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
  );
  state.sessionCache = new Map();
  installMediaCapabilities(true);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('useDictationServer', () => {
  it('hides Dictate and makes zero requests when navigator.mediaDevices is undefined (Mac Catalyst)', async () => {
    installMediaCapabilities(false);
    state.roomServer = { apiUrl: 'https://mr.example', pending: false };
    expect(isDictationSupported()).toBe(false);

    const { result } = renderServerHook('!room:example.org');
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.available).toBe(false);
    expect(result.current.apiUrl).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });

  it('never falls back to an unchecked third-room advertised server in a human DM', async () => {
    state.roomServer = { apiUrl: undefined, pending: false };
    state.computers = undefined;
    state.discoveredUrls = ['https://evil-third-room.example'];

    const { result } = renderServerHook('!dm:example.org');
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.apiUrl).toBeUndefined();
    expect(result.current.available).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('waits until useRoomMindroomServer settles before falling back to an explicitly configured server', async () => {
    state.roomServer = { apiUrl: undefined, pending: true };
    state.computers = { apiUrl: 'https://deploy.example' };

    const { result, rerender } = renderServerHook('!dm:example.org');
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.apiUrl).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();

    state.roomServer = { apiUrl: undefined, pending: false };
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.apiUrl).toBe('https://deploy.example');
    expect(result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it('allows an explicitly allowlisted trustedApiUrls origin or personal override in a human DM', async () => {
    state.computers = { trustedApiUrls: ['https://trusted.example'] };
    state.discoveredUrls = ['https://untrusted.example', 'https://trusted.example'];

    const { result, unmount } = renderServerHook('!dm:example.org');
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.apiUrl).toBe('https://trusted.example');
    expect(result.current.available).toBe(true);
    unmount();

    state.computers = undefined;
    state.discoveredUrls = [];
    const store = createStore();
    store.set(computerServicePreferenceAtom, 'https://personal.example');
    const hook2 = renderServerHook('!dm:example.org', store);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook2.result.current.apiUrl).toBe('https://personal.example');
    expect(hook2.result.current.available).toBe(true);
  });

  it('recovers after a transient 503 status failure once the 30 s TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    state.roomServer = { apiUrl: 'https://mr.example', pending: false };
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
      );

    const { result } = renderServerHook('!room:example.org');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.available).toBe(false);
    expect(state.send).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_005);
    });
    expect(result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(2);
  });
});
