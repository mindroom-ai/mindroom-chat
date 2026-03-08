import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_STORE_KEY,
  clearSessionStore,
  createSessionId,
  getActiveSession,
  getSessionStore,
  getSessionStoreName,
  getSessionScopedStorageKey,
  hasStoredSessions,
  listSessions,
  putSession,
  removeActiveSession,
  removeSession,
  setActiveSession,
  updateSessionProfile,
} from './sessions';

const createStorage = (seed: Record<string, string> = {}) => {
  const state = new Map(Object.entries(seed));

  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
  };
};

describe('sessions', () => {
  it('creates stable session ids from normalized baseUrl and userId', () => {
    expect(createSessionId('https://example.com/', '@alice:example.com')).toBe(
      createSessionId('https://example.com', '@alice:example.com')
    );
  });

  it('stores and resolves the active session', () => {
    const storage = createStorage();

    const stored = putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );

    expect(getActiveSession(storage)).toEqual(stored);
    expect(hasStoredSessions(storage)).toBe(true);
  });

  it('updates an existing account instead of duplicating the same baseUrl + userId', () => {
    const storage = createStorage();

    putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        lastKnownDisplayName: 'Alice',
      },
      undefined,
      storage
    );

    const updated = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    const store = getSessionStore(storage);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: updated.sessionId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
        lastKnownDisplayName: 'Alice',
      })
    );
  });

  it('can set a different session active and keeps the session list sorted by lastUsedAt', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    const active = setActiveSession(alice.sessionId, storage);

    expect(active?.sessionId).toBe(alice.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(alice.sessionId);
    expect(listSessions(storage).map((session) => session.sessionId)).toEqual([
      alice.sessionId,
      bob.sessionId,
    ]);
  });

  it('promotes the most recently used remaining account when removing the active session', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );
    setActiveSession(alice.sessionId, storage);

    const nextStore = removeActiveSession(storage);

    expect(nextStore.activeSessionId).toBe(bob.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(bob.sessionId);
  });

  it('removes a non-active session without changing the current active session', () => {
    const storage = createStorage();

    const alice = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );
    const bob = putSession(
      {
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      undefined,
      storage
    );

    setActiveSession(bob.sessionId, storage);
    const nextStore = removeSession(alice.sessionId, storage);

    expect(nextStore.activeSessionId).toBe(bob.sessionId);
    expect(getActiveSession(storage)?.sessionId).toBe(bob.sessionId);
  });

  it('updates cached profile metadata for an existing session', () => {
    const storage = createStorage();

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    updateSessionProfile(
      session.sessionId,
      {
        lastKnownDisplayName: 'Alice',
        lastKnownAvatarUrl: 'mxc://example/avatar',
        lastKnownAvatarDataUrl: 'data:image/png;base64,abc',
      },
      storage
    );

    expect(getActiveSession(storage)).toEqual(
      expect.objectContaining({
        lastKnownDisplayName: 'Alice',
        lastKnownAvatarUrl: 'mxc://example/avatar',
        lastKnownAvatarDataUrl: 'data:image/png;base64,abc',
      })
    );
  });

  it('clears the whole session registry', () => {
    const storage = createStorage({
      [SESSION_STORE_KEY]: JSON.stringify({
        version: 1,
        activeSessionId: 'session',
        sessions: [],
      }),
    });

    clearSessionStore(storage);

    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_STORE_KEY);
    expect(getSessionStore(storage).sessions).toEqual([]);
  });

  it('returns session-scoped store names and storage keys', () => {
    const storage = createStorage();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    expect(getSessionStoreName(session)).toEqual({
      sync: `web-sync-store::${session.sessionId}`,
      crypto: `crypto-store::${session.sessionId}`,
    });
    expect(getSessionScopedStorageKey(session.sessionId, 'mindroom_ios_push_token')).toBe(
      `mindroom_ios_push_token::${session.sessionId}`
    );
  });
});
