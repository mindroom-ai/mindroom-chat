import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBCryptoStore, IndexedDBStore } from 'matrix-js-sdk';
import {
  clearBrowserCacheAndReload,
  initClient,
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  removeStoredSession,
} from './initMatrix';
import { createMatrixClient } from './matrixClientFactory';
import { createSessionId, getSessionStore, putSession, setActiveSession } from '../app/state/sessions';
import { deleteThreadEventCache } from '../app/features/room/threadEventCache';
import { deleteRoomEventCache } from '../app/features/room/roomEventCache';
import { clearIOSPushState } from '../app/utils/iosPush';

vi.mock('matrix-js-sdk', () => ({
  MatrixClient: vi.fn(),
  IndexedDBStore: vi.fn(),
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
        }) as unknown as IndexedDBStore
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({}) as unknown as IndexedDBCryptoStore
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
      lastUsedAt: 1,
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
    expect(syncAccumulator.opts.maxTimelineEntries).toBe(LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT);
    expect(startup).toHaveBeenCalledTimes(1);
    expect(initRustCrypto).toHaveBeenCalledTimes(1);
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
        }) as unknown as IndexedDBStore
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({}) as unknown as IndexedDBCryptoStore
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
      lastUsedAt: 1,
    });

    expect(syncAccumulator.opts.maxTimelineEntries).toBe(9000);
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

    expect(deleteDatabase).toHaveBeenCalledWith(`web-sync-store::${inactiveSession.sessionId}`);
    expect(deleteDatabase).toHaveBeenCalledWith(`crypto-store::${inactiveSession.sessionId}`);
    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(getSessionStore().sessions.map((session) => session.sessionId)).toEqual([
      activeSession.sessionId,
    ]);
    expect(getSessionStore().activeSessionId).toBe(activeSession.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });
});
