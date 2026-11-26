// @vitest-environment jsdom
import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, MemoryStore, Room, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { MINDROOM_SERVER_EVENT } from '../../computer/agentServer';
import type { ClientSessions } from '../../computer/clientSessions';
import { computerServicePreferenceAtom } from '../../computer/computerServiceSettings';
import { dictationAvailabilityStorageKey } from '../../preferences/accountStorageKeys';
import { isDictationSupported, useDictationServer } from './useDictationServer';

const VIEWER = '@alice:example.org';
const AGENT = '@mindroom_code:example.org';
const HUMAN = '@bob:example.org';

type ComputersConfig = NonNullable<ClientConfig['mindroom']>['computers'];

const state = vi.hoisted(
  (): {
    readOpenIdBinding: () => Promise<boolean | undefined>;
    send: ReturnType<typeof vi.fn>;
    sessionCache: Map<string, ClientSessions>;
  } => ({
    readOpenIdBinding: () => Promise.resolve(true),
    send: vi.fn(),
    sessionCache: new Map(),
  })
);

vi.mock('../../matrix/openidAudience', () => ({
  readOpenIdBinding: () => state.readOpenIdBinding(),
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

let serial = 0;
const stateEvent = (
  roomId: string,
  type: string,
  stateKey: string,
  content: Record<string, unknown>
) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender: stateKey,
    room_id: roomId,
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

const createTestClient = () =>
  createClient({
    baseUrl: 'https://example.org',
    userId: VIEWER,
    store: new MemoryStore(),
    timelineSupport: true,
  });

const addRoom = async (
  mx: MatrixClient,
  opts: {
    roomId: string;
    members: string[];
    serverOrigins?: Array<{ agentUserId?: string; apiOrigin: string }>;
    membersLoaded?: boolean;
    loadMembersPromise?: Promise<boolean>;
  }
) => {
  const room = new Room(opts.roomId, mx, VIEWER, { timelineSupport: true });
  const events: MatrixEvent[] = [
    ...opts.members.map((userId) =>
      stateEvent(opts.roomId, 'm.room.member', userId, { membership: 'join' })
    ),
    ...(opts.serverOrigins ?? []).map(({ agentUserId = AGENT, apiOrigin }) =>
      stateEvent(opts.roomId, MINDROOM_SERVER_EVENT, agentUserId, {
        api_origin: apiOrigin,
        computer: true,
      })
    ),
  ];
  await room.addLiveEvents(events, { addToState: true });
  room.updateMyMembership('join');
  const loaded = opts.membersLoaded ?? true;
  room.membersLoaded = () => loaded;
  room.loadMembersIfNeeded = () => opts.loadMembersPromise ?? Promise.resolve(true);
  mx.store.storeRoom(room);
  return room;
};

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

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderServerHook = (
  mx: MatrixClient,
  opts: {
    roomId?: string;
    computers?: ComputersConfig;
    store?: ReturnType<typeof createStore>;
  } = {}
) => {
  const store = opts.store ?? createStore();
  const config: ClientConfig = opts.computers ? { mindroom: { computers: opts.computers } } : {};
  return renderHook(() => useDictationServer(opts.roomId), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={config}>{children}</ClientConfigProvider>
        </MatrixClientProvider>
      </Provider>
    ),
  });
};

beforeEach(() => {
  localStorage.clear();
  state.readOpenIdBinding = () => Promise.resolve(true);
  state.send = vi.fn(async () =>
    Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
  );
  state.sessionCache = new Map();
  installMediaCapabilities(true);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const setDocumentVisibility = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('useDictationServer', () => {
  it('hides Dictate and makes zero requests when navigator.mediaDevices is undefined', async () => {
    installMediaCapabilities(false);
    expect(isDictationSupported()).toBe(false);
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });

    const { result } = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();

    expect(result.current.available).toBe(false);
    expect(result.current.apiUrl).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });

  it('uses auto-discovered roomServer.apiUrl when computers.apiUrl is empty and trustedApiUrls is unset (chat.mindroom.chat default)', async () => {
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!agent-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://selfhosted.example' }],
    });
    await addRoom(mx, {
      roomId: '!newer-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://newer.example' }],
    });

    const { result } = renderServerHook(mx, {
      roomId: '!agent-room:example.org',
      computers: { apiUrl: '' },
    });
    await flushEffects();

    expect(result.current.apiUrl).toBe('https://selfhosted.example');
    expect(result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith(
      '/api/dictation/v1/status?room_id=!agent-room%3Aexample.org',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uses auto-discovered computer server in a human DM and Home when preference is null, and respects explicit disable', async () => {
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!agent-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://selfhosted.example' }],
    });
    await addRoom(mx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
    });

    const dmHook = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { apiUrl: '' },
    });
    await flushEffects();
    expect(dmHook.result.current.apiUrl).toBe('https://selfhosted.example');
    expect(dmHook.result.current.available).toBe(true);
    dmHook.unmount();

    const homeHook = renderServerHook(mx, {
      roomId: undefined,
      computers: { apiUrl: '' },
    });
    await flushEffects();
    expect(homeHook.result.current.apiUrl).toBe('https://selfhosted.example');
    expect(homeHook.result.current.available).toBe(true);
    homeHook.unmount();

    state.send.mockClear();
    const disabledStore = createStore();
    disabledStore.set(computerServicePreferenceAtom, '');

    const disabledDmHook = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { apiUrl: '' },
      store: disabledStore,
    });
    await flushEffects();
    expect(disabledDmHook.result.current.apiUrl).toBeUndefined();
    expect(disabledDmHook.result.current.available).toBe(false);
    disabledDmHook.unmount();

    const disabledHomeHook = renderServerHook(mx, {
      roomId: undefined,
      computers: { apiUrl: '' },
      store: disabledStore,
    });
    await flushEffects();
    expect(disabledHomeHook.result.current.apiUrl).toBeUndefined();
    expect(disabledHomeHook.result.current.available).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('waits until useRoomMindroomServer settles before resolving room or fallback servers', async () => {
    let resolveMembers!: (value: boolean) => void;
    const loadMembersPromise = new Promise<boolean>((resolve) => {
      resolveMembers = resolve;
    });
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
      membersLoaded: false,
      loadMembersPromise,
    });

    const { result, unmount } = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { apiUrl: 'https://deploy.example' },
    });
    await flushEffects();
    expect(result.current.apiUrl).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();

    resolveMembers(true);
    await flushEffects();
    expect(result.current.apiUrl).toBe('https://deploy.example');
    expect(result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
    unmount();

    // When roomId is omitted (Home), useMemberListSettled(null) is true, but we still wait for OpenID binding.
    let resolveBinding!: (value: boolean) => void;
    state.readOpenIdBinding = () =>
      new Promise<boolean>((resolve) => {
        resolveBinding = resolve;
      });
    const homeMx = createTestClient();
    await addRoom(homeMx, {
      roomId: '!agent-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://home-discovered.example' }],
    });
    state.send.mockClear();

    const homeHook = renderServerHook(homeMx, {
      roomId: undefined,
      computers: { apiUrl: '' },
    });
    await flushEffects();
    expect(homeHook.result.current.apiUrl).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();

    resolveBinding(true);
    await flushEffects();
    expect(homeHook.result.current.apiUrl).toBe('https://home-discovered.example');
    expect(homeHook.result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it('enforces deployment trustedApiUrls and apiUrl allowlists and supports personal override', async () => {
    // Only untrusted server published while trustedApiUrls is set: rejected in both room and DM.
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!untrusted-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://untrusted.example' }],
    });
    await addRoom(mx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
    });

    const rejectedRoom = renderServerHook(mx, {
      roomId: '!untrusted-room:example.org',
      computers: { trustedApiUrls: ['https://trusted.example'] },
    });
    await flushEffects();
    expect(rejectedRoom.result.current.apiUrl).toBeUndefined();
    expect(rejectedRoom.result.current.available).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
    rejectedRoom.unmount();

    // Even when a newer untrusted room exists alongside a trusted room, fallback in DM picks only the trusted origin.
    await addRoom(mx, {
      roomId: '!trusted-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://trusted.example' }],
    });
    await addRoom(mx, {
      roomId: '!newer-untrusted-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://newer-untrusted.example' }],
    });
    const allowedDm = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { trustedApiUrls: ['https://trusted.example'] },
    });
    await flushEffects();
    expect(allowedDm.result.current.apiUrl).toBe('https://trusted.example');
    expect(allowedDm.result.current.available).toBe(true);
    allowedDm.unmount();

    // When computers.apiUrl is configured without trustedApiUrls, untrusted published origin is rejected.
    const deploymentRoom = renderServerHook(mx, {
      roomId: '!untrusted-room:example.org',
      computers: { apiUrl: 'https://deploy.example' },
    });
    await flushEffects();
    expect(deploymentRoom.result.current.apiUrl).toBe('https://deploy.example');
    expect(deploymentRoom.result.current.available).toBe(true);
    deploymentRoom.unmount();

    // Personal override works in a human DM when no deployment server is configured.
    const personalMx = createTestClient();
    await addRoom(personalMx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
    });
    const store = createStore();
    store.set(computerServicePreferenceAtom, 'https://personal.example');
    const personalDm = renderServerHook(personalMx, {
      roomId: '!dm:example.org',
      store,
    });
    await flushEffects();
    expect(personalDm.result.current.apiUrl).toBe('https://personal.example');
    expect(personalDm.result.current.available).toBe(true);
  });

  it('does not use discovered servers when the homeserver does not bind OpenID tokens', async () => {
    state.readOpenIdBinding = () => Promise.resolve(false);
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!agent-room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://selfhosted.example' }],
    });
    await addRoom(mx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
    });

    const roomHook = renderServerHook(mx, {
      roomId: '!agent-room:example.org',
      computers: { apiUrl: '' },
    });
    await flushEffects();
    expect(roomHook.result.current.apiUrl).toBeUndefined();
    expect(roomHook.result.current.available).toBe(false);
    roomHook.unmount();

    const dmHook = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { apiUrl: '' },
    });
    await flushEffects();
    expect(dmHook.result.current.apiUrl).toBeUndefined();
    expect(dmHook.result.current.available).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('recovers after a transient 503 status failure once the 30 s TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
      );

    const { result } = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(result.current.available).toBe(false);
    expect(state.send).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_005);
    });
    expect(result.current.available).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it('seeds available: true with confirmed: false while pending and probing, then confirms or clears', async () => {
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(
      key,
      JSON.stringify({ '!room:example.org': true, '!denied:example.org': true })
    );
    let resolveMembers!: (value: boolean) => void;
    let resolveStatus!: (response: Response) => void;
    state.send = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        })
    );
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
      membersLoaded: false,
      loadMembersPromise: new Promise<boolean>((resolve) => {
        resolveMembers = resolve;
      }),
    });
    await addRoom(mx, {
      roomId: '!denied:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });

    const okHook = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    // Frame 1: roomServer is still pending; placement is seeded but readiness is unconfirmed.
    expect(okHook.result.current.available).toBe(true);
    expect(okHook.result.current.confirmed).toBe(false);
    expect(okHook.result.current.sessions).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();

    // Room server settles and /status probe is in flight: stays available, still unconfirmed.
    resolveMembers(true);
    await flushEffects();
    expect(okHook.result.current.apiUrl).toBe('https://mr.example');
    expect(okHook.result.current.available).toBe(true);
    expect(okHook.result.current.confirmed).toBe(false);
    expect(state.send).toHaveBeenCalledTimes(1);

    // Status enabled: true flips confirmed to true.
    resolveStatus(
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    await flushEffects();
    expect(okHook.result.current.available).toBe(true);
    expect(okHook.result.current.confirmed).toBe(true);
    okHook.unmount();

    // Permanent 403 settles available and confirmed to false and updates localStorage.
    const deniedHook = renderServerHook(mx, {
      roomId: '!denied:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    expect(deniedHook.result.current.available).toBe(true);
    expect(deniedHook.result.current.confirmed).toBe(false);
    resolveStatus(new Response('forbidden', { status: 403 }));
    await flushEffects();
    expect(deniedHook.result.current.available).toBe(false);
    expect(deniedHook.result.current.confirmed).toBe(false);
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')['!denied:example.org']).toBe(false);
  });

  it('clears persisted true and returns false when server discovery settles with no apiUrl', async () => {
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!dm:example.org': true }));
    let resolveMembers!: (value: boolean) => void;
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!dm:example.org',
      members: [VIEWER, HUMAN],
      membersLoaded: false,
      loadMembersPromise: new Promise<boolean>((resolve) => {
        resolveMembers = resolve;
      }),
    });
    const store = createStore();
    store.set(computerServicePreferenceAtom, '');

    const { result } = renderServerHook(mx, {
      roomId: '!dm:example.org',
      computers: { apiUrl: '' },
      store,
    });
    expect(result.current.available).toBe(true);

    resolveMembers(true);
    await flushEffects();
    expect(result.current.apiUrl).toBeUndefined();
    expect(result.current.available).toBe(false);
    expect(result.current.confirmed).toBe(false);
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')['!dm:example.org']).toBe(false);
  });

  it('keeps persisted room temporarilyUnavailable during a transient 503 while hiding unpersisted rooms', async () => {
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!room:example.org': true }));
    state.send = vi.fn(async () => new Response('restarting', { status: 503 }));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    await addRoom(mx, {
      roomId: '!fresh:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });

    const persistedHook = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    expect(persistedHook.result.current.available).toBe(true);
    expect(persistedHook.result.current.temporarilyUnavailable).toBe(false);

    await flushEffects();
    expect(persistedHook.result.current.available).toBe(true);
    expect(persistedHook.result.current.confirmed).toBe(false);
    expect(persistedHook.result.current.temporarilyUnavailable).toBe(true);
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')['!room:example.org']).toBe(true);
    persistedHook.unmount();

    const freshHook = renderServerHook(mx, {
      roomId: '!fresh:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(freshHook.result.current.available).toBe(false);
    expect(freshHook.result.current.confirmed).toBe(false);
    expect(freshHook.result.current.temporarilyUnavailable).toBe(false);
  });

  it('retries with exponential backoff across an outage longer than 30 s until recovery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!room:example.org': true }));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
      );

    const { result } = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(result.current.available).toBe(true);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.temporarilyUnavailable).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);

    // Retry 1 after 30 s -> 503 (next backoff: 60 s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_005);
    });
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(result.current.temporarilyUnavailable).toBe(true);

    // Not yet retried at +30 s into the 60 s backoff; retries at +60 s -> 503 (next backoff: 120 s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(state.send).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_005);
    });
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(result.current.temporarilyUnavailable).toBe(true);

    // Retry 3 after 120 s -> 200 OK.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_005);
    });
    expect(state.send).toHaveBeenCalledTimes(4);
    expect(result.current.available).toBe(true);
    expect(result.current.confirmed).toBe(true);
    expect(result.current.temporarilyUnavailable).toBe(false);
  });

  it('pauses retry timers while hidden, resumes on visibilitychange, and recovers immediately on online', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
      );

    const { result } = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(1);

    // Hide the tab: advancing past 30 s must not trigger a background probe.
    act(() => {
      setDocumentVisibility('hidden');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(state.send).toHaveBeenCalledTimes(1);

    // Returning to the tab probes immediately because the deadline already passed.
    act(() => {
      setDocumentVisibility('visible');
    });
    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(2);

    // Now in 60 s backoff: firing `online` while hidden defers probing until the tab is visible.
    act(() => {
      setDocumentVisibility('hidden');
      window.dispatchEvent(new Event('online'));
    });
    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(2);

    act(() => {
      setDocumentVisibility('visible');
    });
    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(3);

    // Firing `online` while visible expires the cache and recovers immediately.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(4);
    expect(result.current.available).toBe(true);
    expect(result.current.confirmed).toBe(true);
    expect(result.current.temporarilyUnavailable).toBe(false);
  });

  it('keeps temporarilyUnavailable: true across remount after the 30 s deadline while retry probe is pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!room:example.org': true }));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    let resolveRetry!: (response: Response) => void;
    const retryPromise = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockReturnValueOnce(retryPromise);

    const firstMount = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(firstMount.result.current.temporarilyUnavailable).toBe(true);
    firstMount.unmount();

    // Advance past the 30 s transient TTL, then remount while the retry probe stays in flight.
    vi.setSystemTime(new Date('2026-11-23T12:00:35Z'));
    const reopened = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    expect(reopened.result.current.available).toBe(true);
    expect(reopened.result.current.confirmed).toBe(false);
    expect(reopened.result.current.temporarilyUnavailable).toBe(true);

    await flushEffects();
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(reopened.result.current.available).toBe(true);
    expect(reopened.result.current.confirmed).toBe(false);
    expect(reopened.result.current.temporarilyUnavailable).toBe(true);

    resolveRetry(
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    await flushEffects();
    expect(reopened.result.current.available).toBe(true);
    expect(reopened.result.current.confirmed).toBe(true);
    expect(reopened.result.current.temporarilyUnavailable).toBe(false);
  });

  it('clears persisted true and hides button when a transient 503 transitions to a permanent 403', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!room:example.org': true }));
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });
    state.send
      .mockResolvedValueOnce(new Response('restarting', { status: 503 }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    const { result } = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    expect(result.current.available).toBe(true);
    expect(result.current.temporarilyUnavailable).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_005);
    });
    expect(result.current.available).toBe(false);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.temporarilyUnavailable).toBe(false);
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')['!room:example.org']).toBe(false);
  });

  it('never seeds true when unsupported and caps persisted room entries at 128', async () => {
    const key = dictationAvailabilityStorageKey(VIEWER);
    localStorage.setItem(key, JSON.stringify({ '!room:example.org': true }));
    installMediaCapabilities(false);
    const mx = createTestClient();
    await addRoom(mx, {
      roomId: '!room:example.org',
      members: [VIEWER, AGENT],
      serverOrigins: [{ apiOrigin: 'https://mr.example' }],
    });

    const unsupported = renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    expect(unsupported.result.current.available).toBe(false);
    await flushEffects();
    expect(unsupported.result.current.available).toBe(false);
    unsupported.unmount();

    installMediaCapabilities(true);
    const seeded = Object.fromEntries(
      Array.from({ length: 128 }, (_, i) => [`!r${i}:example.org`, true])
    );
    localStorage.setItem(key, JSON.stringify(seeded));
    renderServerHook(mx, {
      roomId: '!room:example.org',
      computers: { apiUrl: 'https://mr.example' },
    });
    await flushEffects();
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
    expect(Object.keys(stored)).toHaveLength(128);
    expect(stored['!r0:example.org']).toBeUndefined();
    expect(stored['!room:example.org']).toBe(true);
  });
});
