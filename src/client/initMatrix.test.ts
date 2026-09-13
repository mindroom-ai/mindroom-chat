import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import {
  clearBrowserCacheAndReload,
  clearCacheAndReload,
  clearLoginData,
  initClient,
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  logoutClient,
  removeStoredSession,
} from './initMatrix';
import { createMatrixClient } from './matrixClientFactory';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  createSessionId,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  putSession,
  setActiveSession,
} from '../app/state/sessions';
import { deleteThreadEventCache } from '../app/features/room/threadEventCache';
import { deleteRoomEventCache } from '../app/features/room/roomEventCache';
import { deleteThreadSummaryCache } from '../app/features/room/threadSummaryCache';
import { clearIOSPushState } from '../app/utils/iosPush';

vi.mock('matrix-js-sdk/lib/store/indexeddb', () => ({
  IndexedDBStore: vi.fn(),
}));

vi.mock('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store', () => ({
  IndexedDBCryptoStore: vi.fn(),
}));

vi.mock('./secretStorageKeys', () => ({
  cryptoCallbacks: {},
}));

vi.mock('./matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('../app/state/navToActivePath', () => ({
  clearNavToActivePathStore: vi.fn(),
}));

vi.mock('../app/features/room/threadEventCache', () => ({
  deleteThreadEventCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../app/features/room/roomEventCache', () => ({
  deleteRoomEventCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../app/features/room/threadSummaryCache', () => ({
  deleteThreadSummaryCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../app/utils/iosPush', () => ({
  clearIOSPushState: vi.fn(),
}));

describe('initClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('raises the saved sync archive timeline limit for the IndexedDB store', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const startup = vi.fn().mockResolvedValue(undefined);
    const syncAccumulator = {
      opts: {
        maxTimelineEntries: 50,
      },
    };
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          backend: {
            syncAccumulator,
          },
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );

    const initRustCrypto = vi.fn().mockResolvedValue(undefined);
    const setMaxListeners = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      setMaxListeners,
    } as never);

    await initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    });

    expect(vi.mocked(IndexedDBStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        dbName: `web-sync-store::${sessionId}`,
      })
    );
    expect(vi.mocked(IndexedDBCryptoStore)).toHaveBeenCalledWith(
      global.indexedDB,
      `crypto-store::${sessionId}`
    );
    expect(vi.mocked(createMatrixClient)).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineSupport: true,
        threadSupport: true,
      })
    );
    expect(syncAccumulator.opts.maxTimelineEntries).toBe(LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT);
    expect(startup).toHaveBeenCalledTimes(1);
    expect(initRustCrypto).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix({
        sessionId,
        deviceId: 'DEVICE',
      }),
    });
    expect(setMaxListeners).toHaveBeenCalledWith(50);
  });

  it('does not lower a larger existing sync archive limit', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    const startup = vi.fn().mockResolvedValue(undefined);
    const syncAccumulator = {
      opts: {
        maxTimelineEntries: 9000,
      },
    };
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          backend: {
            syncAccumulator,
          },
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      setMaxListeners: vi.fn(),
    } as never);

    await initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    });

    expect(syncAccumulator.opts.maxTimelineEntries).toBe(9000);
  });
});

describe('clearCacheAndReload', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('clears session-scoped rust crypto stores for the active session', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const session = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
    });
    setActiveSession(session.sessionId);

    const stopClient = vi.fn();
    const clearStores = vi.fn().mockResolvedValue(undefined);
    const getSafeUserId = vi.fn().mockReturnValue(session.userId);

    await clearCacheAndReload({
      clearStores,
      getSafeUserId,
      stopClient,
    } as never);

    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(getSafeUserId).toHaveBeenCalledTimes(1);
    expect(clearStores).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
    });
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith(session.sessionId);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('derives the session-scoped rust crypto prefix from the live client when session storage is unavailable', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const reload = vi.fn();
    const userId = '@alice:example.com';
    const deviceId = 'DEVICE_A';
    const sessionId = createSessionId('https://example.com', userId);

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const stopClient = vi.fn();
    const clearStores = vi.fn().mockResolvedValue(undefined);
    const getSafeUserId = vi.fn().mockReturnValue(userId);
    const getHomeserverUrl = vi.fn().mockReturnValue('https://example.com');
    const getDeviceId = vi.fn().mockReturnValue(deviceId);

    await clearCacheAndReload({
      clearStores,
      getDeviceId,
      getHomeserverUrl,
      getSafeUserId,
      stopClient,
    } as never);

    expect(clearStores).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix({
        sessionId,
        deviceId,
      }),
    });
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith(sessionId);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('logoutClient', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDB = globalThis.indexedDB;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('clears the current session-scoped rust crypto store when the stored session is unavailable', async () => {
    const storageState = new Map<string, string>(
      LEGACY_SESSION_STORAGE_KEYS.map((key) => [key, `legacy-${key}`])
    );
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const deleteDatabase = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.({} as Event);
      });
      return request;
    });
    const reload = vi.fn();
    const userId = '@alice:example.com';
    const deviceId = 'DEVICE_A';
    const sessionId = createSessionId('https://example.com', userId);

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const stopClient = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    const clearStores = vi.fn().mockResolvedValue(undefined);
    const getSafeUserId = vi.fn().mockReturnValue(userId);
    const getHomeserverUrl = vi.fn().mockReturnValue('https://example.com');
    const getDeviceId = vi.fn().mockReturnValue(deviceId);

    await logoutClient({
      clearStores,
      getDeviceId,
      getHomeserverUrl,
      getSafeUserId,
      logout,
      stopClient,
    } as never);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(clearStores).toHaveBeenCalledWith({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix({
        sessionId,
        deviceId,
      }),
    });
    const legacyRustCryptoStoreNames = getLegacySessionRustCryptoStoreNames({ sessionId });
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[1]);
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith(sessionId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(sessionId);
    LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(key);
      expect(storageState.has(key)).toBe(false);
    });
    expect(stopClient).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('clearLoginData', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  });

  it('deletes session-scoped and legacy app-owned IndexedDB databases when legacy auth state is present', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
      localStorageMock.setItem(key, `legacy-${key}`);
    });

    const deletedDatabaseNames: string[] = [];
    const deleteDatabase = vi.fn((name: string) => {
      deletedDatabaseNames.push(name);
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    });

    const indexedDBMock = {
      databases: vi
        .fn()
        .mockResolvedValue([
          { name: getSessionIndexedDbStoreName(session).sync },
          { name: 'matrix-js-sdk:web-sync-store' },
          { name: getSessionRustCryptoStoreNames(session)[1] },
          { name: getSessionRustCryptoStoreNames(session)[0] },
          { name: getSessionIndexedDbStoreName(session).crypto },
          { name: 'crypto-store' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto-meta' },
          { name: 'mindroom-room-event-cache' },
          { name: 'mindroom-thread-event-cache' },
          { name: 'matrix-js-sdk:web-sync-store::other-session' },
          { name: 'crypto-store::other-session' },
          { name: 'matrix-js-sdk::other-session::OTHERDEVICE::matrix-sdk-crypto' },
          { name: 'unrelated-db' },
        ]),
      deleteDatabase,
    };

    Object.defineProperty(globalThis, 'indexedDB', {
      value: indexedDBMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        indexedDB: indexedDBMock,
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    await clearLoginData();

    expect(deletedDatabaseNames).toEqual([
      getSessionIndexedDbStoreName(session).sync,
      'matrix-js-sdk:web-sync-store',
      getSessionRustCryptoStoreNames(session)[1],
      getSessionRustCryptoStoreNames(session)[0],
      getSessionIndexedDbStoreName(session).crypto,
      'crypto-store',
      'matrix-js-sdk::matrix-sdk-crypto',
      'matrix-js-sdk::matrix-sdk-crypto-meta',
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
    ]);
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith(session.sessionId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(session.sessionId);
    LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(key);
      expect(storageState.has(key)).toBe(false);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not delete legacy singleton IndexedDB databases without this app legacy auth state', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );

    const deletedDatabaseNames: string[] = [];
    const deleteDatabase = vi.fn((name: string) => {
      deletedDatabaseNames.push(name);
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    });

    const indexedDBMock = {
      databases: vi
        .fn()
        .mockResolvedValue([
          { name: getSessionIndexedDbStoreName(session).sync },
          { name: getSessionRustCryptoStoreNames(session)[0] },
          { name: getSessionRustCryptoStoreNames(session)[1] },
          { name: getSessionIndexedDbStoreName(session).crypto },
          { name: 'mindroom-room-event-cache' },
          { name: 'mindroom-thread-event-cache' },
          { name: 'matrix-js-sdk:web-sync-store' },
          { name: 'crypto-store' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto-meta' },
        ]),
      deleteDatabase,
    };

    Object.defineProperty(globalThis, 'indexedDB', {
      value: indexedDBMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        indexedDB: indexedDBMock,
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    await clearLoginData();

    expect(deletedDatabaseNames).toEqual([
      getSessionIndexedDbStoreName(session).sync,
      getSessionRustCryptoStoreNames(session)[0],
      getSessionRustCryptoStoreNames(session)[1],
      getSessionIndexedDbStoreName(session).crypto,
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('clearBrowserCacheAndReload', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('unregisters and clears only app-scoped browser cache resources', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom';

    const unregisterApp = vi.fn().mockResolvedValue(true);
    const unregisterOther = vi.fn().mockResolvedValue(true);
    const appRegistration = {
      scope: 'https://example.com/mindroom/',
      active: { scriptURL: 'https://example.com/mindroom/sw.js' },
      installing: null,
      waiting: null,
      unregister: unregisterApp,
    } as unknown as ServiceWorkerRegistration;
    const otherRegistration = {
      scope: 'https://example.com/other/',
      active: { scriptURL: 'https://example.com/other/sw.js' },
      installing: null,
      waiting: null,
      unregister: unregisterOther,
    } as unknown as ServiceWorkerRegistration;
    const getRegistrations = vi.fn().mockResolvedValue([appRegistration, otherRegistration]);

    const appRequest = { url: 'https://example.com/mindroom/assets/index.js' } as Request;
    const otherRequest = { url: 'https://example.com/other/assets/index.js' } as Request;

    const appCache = {
      keys: vi
        .fn()
        .mockResolvedValueOnce([appRequest, otherRequest])
        .mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const otherCache = {
      keys: vi.fn().mockResolvedValueOnce([otherRequest]).mockResolvedValueOnce([otherRequest]),
      delete: vi.fn().mockResolvedValue(false),
    };
    const deleteCacheName = vi.fn().mockResolvedValue(true);

    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      open: vi.fn().mockImplementation((cacheName: string) => {
        if (cacheName === 'cache-a') {
          return Promise.resolve(appCache as unknown as Cache);
        }
        return Promise.resolve(otherCache as unknown as Cache);
      }),
      delete: deleteCacheName,
    };

    const reload = vi.fn();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          reload,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    await clearBrowserCacheAndReload();

    expect(unregisterApp).toHaveBeenCalledTimes(1);
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(appCache.delete).toHaveBeenCalledTimes(1);
    expect(appCache.delete).toHaveBeenCalledWith(appRequest);
    expect(otherCache.delete).not.toHaveBeenCalled();
    expect(deleteCacheName).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('removeStoredSession', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDB = globalThis.indexedDB;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('removes an inactive account without reloading the active one', async () => {
    const storageState = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
    };
    const deleteDatabase = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onsuccess?.({} as Event);
      });
      return request;
    });
    const reload = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: localStorageMock,
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: {
          reload,
        },
      },
      configurable: true,
    });

    const activeSession = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
    });
    const inactiveSession = putSession({
      baseUrl: 'https://matrix.org',
      userId: '@bob:matrix.org',
      deviceId: 'DEVICE_B',
      accessToken: 'token-b',
    });
    setActiveSession(activeSession.sessionId);

    await removeStoredSession(inactiveSession);

    const indexedDbStoreNames = getSessionIndexedDbStoreName(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(indexedDbStoreNames.sync);
    expect(deleteDatabase).toHaveBeenCalledWith(indexedDbStoreNames.crypto);
    const rustCryptoStoreNames = getSessionRustCryptoStoreNames(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(rustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(rustCryptoStoreNames[1]);
    const legacyRustCryptoStoreNames = getLegacySessionRustCryptoStoreNames(inactiveSession);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[0]);
    expect(deleteDatabase).toHaveBeenCalledWith(legacyRustCryptoStoreNames[1]);
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(getSessionStore().sessions.map((session) => session.sessionId)).toEqual([
      activeSession.sessionId,
    ]);
    expect(getSessionStore().activeSessionId).toBe(activeSession.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });
});
