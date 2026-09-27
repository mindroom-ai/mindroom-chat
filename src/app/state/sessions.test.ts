import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetStorageConnectionRecoveryForTesting,
  startStorageConnectionSentinel,
} from '../mindroom/client/storageConnectionRecovery';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SessionStoreWriteError,
  clearLegacySessionStorage,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStorePrefix,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  getSessionStoreName,
  getSessionScopedStorageKey,
  hasInitializedCryptoStore,
  hasStoredSessions,
  listSessions,
  markCryptoStoreInitialized,
  persistKnownSessionStore,
  putSession,
  removeSession,
  setActiveSession,
  updateSessionProfile,
  updateSessionCredentials,
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
  afterEach(() => {
    resetStorageConnectionRecoveryForTesting();
  });

  it('keeps the known sessions when a lost storage connection reads them as missing', async () => {
    const storage = createStorage();
    const session = putSession(
      {
        baseUrl: 'https://matrix.example.org',
        userId: '@alice:example.org',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    expect(getActiveSession(storage)?.sessionId).toBe(session.sessionId);
    const database = new EventTarget();
    startStorageConnectionSentinel({
      indexedDB: {
        open: () => {
          const request = { result: database, onsuccess: null as null | (() => void) };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      } as unknown as IDBFactory,
      markerStorage: undefined,
    });
    await Promise.resolve();
    // WebKit reads every existing Web Storage key as null after its networking process exits.
    storage.getItem.mockReturnValue(null);

    // Reads between the loss and its close event cannot be told apart from a logout.
    expect(getActiveSession(storage)).toBeUndefined();

    database.dispatchEvent(new Event('close'));

    expect(getActiveSession(storage)?.sessionId).toBe(session.sessionId);
    expect(listSessions(storage)).toHaveLength(1);

    // A persistent profile can also serve an older value this page saw before.
    const olderRaw = storage.setItem.mock.calls[0][1] as string;
    storage.getItem.mockReturnValue(olderRaw);
    expect(getActiveSession(storage)?.sessionId).toBe(session.sessionId);

    // A value this page never saw was written by another tab: never overwrite it, adopt it.
    const otherTab = JSON.stringify({ version: 1, sessions: [] });
    storage.getItem.mockReturnValue(otherTab);
    storage.setItem.mockClear();
    persistKnownSessionStore(storage);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(listSessions(storage)).toHaveLength(0);

    // Writes made after the loss still read back and are trusted.
    storage.getItem.mockReset();
    const written = new Map<string, string>();
    storage.setItem.mockImplementation((key: string, value: string) => {
      written.set(key, value);
    });
    storage.getItem.mockImplementation((key: string) => written.get(key) ?? null);
    removeSession(session.sessionId, storage);
    expect(listSessions(storage)).toHaveLength(0);

    persistKnownSessionStore(storage);
    expect(JSON.parse(written.get('mindroom_multi_account_store') ?? '{}').sessions).toEqual([]);
  });

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

  it('uses a device-scoped rust crypto prefix while keeping the account session id stable', () => {
    const storage = createStorage();

    const initial = putSession(
      {
        baseUrl: 'https://example.com/',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
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

    expect(updated.sessionId).toBe(initial.sessionId);
    expect(getSessionRustCryptoStorePrefix(updated)).not.toBe(
      getSessionRustCryptoStorePrefix(initial)
    );
    expect(getLegacySessionRustCryptoStorePrefix(updated)).toBe(
      getLegacySessionRustCryptoStorePrefix(initial)
    );
  });

  it('marks crypto continuity and resets it when a new Matrix device replaces the login', () => {
    const storage = createStorage();
    const initial = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      storage
    );

    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(false);
    markCryptoStoreInitialized(initial.sessionId, storage);
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(true);

    putSession(
      {
        baseUrl: initial.baseUrl,
        userId: initial.userId,
        deviceId: initial.deviceId,
        accessToken: 'token-b',
      },
      undefined,
      storage
    );
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(true);

    putSession(
      {
        baseUrl: initial.baseUrl,
        userId: initial.userId,
        deviceId: 'DEVICE_B',
        accessToken: 'token-c',
      },
      undefined,
      storage
    );
    expect(hasInitializedCryptoStore(initial.sessionId, storage)).toBe(false);
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

    const nextStore = removeSession(alice.sessionId, storage);

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

  it('persists a refresh-token rotation without changing account metadata', () => {
    const storage = createStorage();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        refreshToken: 'refresh-a',
        lastKnownDisplayName: 'Alice',
      },
      undefined,
      storage
    );

    const updated = updateSessionCredentials(
      session.sessionId,
      {
        accessToken: 'token-b',
        refreshToken: 'refresh-b',
        expiresInMs: 60_000,
      },
      storage
    );

    expect(updated).toEqual(
      expect.objectContaining({
        accessToken: 'token-b',
        refreshToken: 'refresh-b',
        expiresInMs: 60_000,
        lastKnownDisplayName: 'Alice',
        lastUsedAt: session.lastUsedAt,
      })
    );
  });

  it('allows cached profile metadata to be explicitly cleared', () => {
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
    updateSessionProfile(
      session.sessionId,
      {
        lastKnownDisplayName: undefined,
        lastKnownAvatarUrl: undefined,
        lastKnownAvatarDataUrl: undefined,
      },
      storage
    );

    expect(getActiveSession(storage)).toEqual(
      expect.objectContaining({
        lastKnownDisplayName: undefined,
        lastKnownAvatarUrl: undefined,
        lastKnownAvatarDataUrl: undefined,
      })
    );
  });

  it('isolates blocked session-storage operations', () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('blocked write');
    });

    expect(() =>
      putSession(
        {
          baseUrl: 'https://example.com',
          userId: '@alice:example.com',
          deviceId: 'DEVICE_A',
          accessToken: 'token-a',
        },
        undefined,
        storage
      )
    ).toThrow(SessionStoreWriteError);

    const removed: string[] = [];
    storage.removeItem.mockImplementation((key: string) => {
      if (key === LEGACY_SESSION_STORAGE_KEYS[0]) throw new Error('blocked remove');
      removed.push(key);
    });

    expect(() => clearLegacySessionStorage(storage)).not.toThrow();
    expect(removed).toEqual(LEGACY_SESSION_STORAGE_KEYS.slice(1));
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
    expect(getSessionIndexedDbStoreName(session)).toEqual({
      sync: `matrix-js-sdk:web-sync-store::${session.sessionId}`,
      crypto: `crypto-store::${session.sessionId}`,
    });
    expect(getSessionScopedStorageKey(session.sessionId, 'mindroom_ios_push_token')).toBe(
      `mindroom_ios_push_token::${session.sessionId}`
    );
  });

  it('returns stable store snapshots while the backing storage is unchanged', () => {
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

    const storeA = getSessionStore(storage);
    const storeB = getSessionStore(storage);
    const activeA = getActiveSession(storage);
    const activeB = getActiveSession(storage);
    const sessionsA = listSessions(storage);
    const sessionsB = listSessions(storage);

    expect(storeA).toBe(storeB);
    expect(activeA).toBe(activeB);
    expect(activeA?.sessionId).toBe(session.sessionId);
    expect(sessionsA).toBe(sessionsB);
    expect(sessionsA[0].sessionId).toBe(session.sessionId);
  });
});
