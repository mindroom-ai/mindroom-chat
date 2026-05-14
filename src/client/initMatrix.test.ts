import { afterEach, describe, expect, it, vi } from 'vitest';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import {
  clearAllCacheAndReload,
  clearBrowserCacheAndReload,
  clearCacheAndReload,
  clearLoginData,
  initClient,
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  logoutClient,
  removeStoredSession,
  STARTUP_SYNC_TIMELINE_LIMIT,
  startClient,
} from './initMatrix';
import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import { clearSecretStorageKeys } from './secretStorageKeys';
import { MINDROOM_EDIT_DEBUG_STORAGE_KEY } from '../app/mindroom/messages/editDebug';
import { clearMindroomLongTextHydrationCache } from '../app/mindroom/messages/longText';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SESSION_STORE_KEY,
  createSessionId,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  putSession,
  setActiveSession,
} from '../app/state/sessions';
import {
  deleteThreadEventCache,
  getThreadEventCacheDbName,
} from '../app/mindroom/threads/threadEventCache';
import {
  deleteRoomEventCache,
  getRoomEventCacheDbName,
} from '../app/mindroom/threads/roomEventCache';
import {
  deleteThreadSummaryCache,
  getThreadSummaryCacheDbName,
} from '../app/mindroom/threads/threadSummaryStore';
import { clearIOSPushState } from '../app/mindroom/native/iosPush';
import { clearRecentThreadsStore } from '../app/mindroom/recent-threads/recentThreads';
import { clearRecentThreadsPanelHeightStore } from '../app/mindroom/recent-threads/recentThreadsPanelHeight';
import { clearRecentThreadsPanelMobileExpandedStore } from '../app/mindroom/recent-threads/recentThreadsPanelMobileExpanded';
import { clearRecentThreadViewModelSharedState } from '../app/mindroom/threads/recentThreadViewModel';

vi.mock('matrix-js-sdk/lib/store/indexeddb', () => ({
  IndexedDBStore: vi.fn(),
}));

vi.mock('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store', () => ({
  IndexedDBCryptoStore: vi.fn(),
}));

vi.mock('./secretStorageKeys', () => ({
  clearSecretStorageKeys: vi.fn(),
  cryptoCallbacks: {},
}));

vi.mock('../app/mindroom/messages/longText', () => ({
  clearMindroomLongTextHydrationCache: vi.fn(),
}));

vi.mock('../app/mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('../app/state/navToActivePath', () => ({
  clearNavToActivePathStore: vi.fn(),
}));

vi.mock('../app/mindroom/recent-threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
}));

vi.mock('../app/mindroom/recent-threads/recentThreadsPanelHeight', () => ({
  clearRecentThreadsPanelHeightStore: vi.fn(),
}));

vi.mock('../app/mindroom/recent-threads/recentThreadsPanelMobileExpanded', () => ({
  clearRecentThreadsPanelMobileExpandedStore: vi.fn(),
}));

vi.mock('../app/mindroom/threads/recentThreadViewModel', () => ({
  clearRecentThreadViewModelSharedState: vi.fn(),
}));

vi.mock('../app/mindroom/threads/roomThreadFilterState', () => ({
  clearRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../app/mindroom/threads/threadEventCache', () => ({
  MINDROOM_THREAD_EVENT_CACHE_DB_NAME: 'mindroom-thread-event-cache',
  deleteThreadEventCache: vi.fn().mockResolvedValue(undefined),
  getThreadEventCacheDbName: vi.fn(
    (sessionId: string) => `mindroom-thread-event-cache::${sessionId}`
  ),
}));

vi.mock('../app/mindroom/threads/roomEventCache', () => ({
  MINDROOM_ROOM_EVENT_CACHE_DB_NAME: 'mindroom-room-event-cache',
  deleteRoomEventCache: vi.fn().mockResolvedValue(undefined),
  getRoomEventCacheDbName: vi.fn((sessionId: string) => `mindroom-room-event-cache::${sessionId}`),
}));

vi.mock('../app/mindroom/threads/threadSummaryStore', () => ({
  deleteThreadSummaryCache: vi.fn().mockResolvedValue(undefined),
  getThreadSummaryCacheDbName: vi.fn(
    (sessionId: string) => `mindroom-thread-summary-cache::${sessionId}`
  ),
}));

vi.mock('../app/mindroom/native/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

const createStorageMock = (initialEntries: Record<string, string> = {}) => {
  const state = new Map<string, string>(Object.entries(initialEntries));
  const storage = {
    get length() {
      return state.size;
    },
    key: vi.fn((index: number) => Array.from(state.keys())[index] ?? null),
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
  } as unknown as Storage;

  return { state, storage };
};

const createDeleteDatabaseMock = ({
  blockedNames = new Set<string>(),
  errorNames = new Map<string, Error>(),
}: {
  blockedNames?: Set<string>;
  errorNames?: Map<string, Error>;
} = {}) =>
  vi.fn((name: string) => {
    const request = {} as IDBOpenDBRequest;

    queueMicrotask(() => {
      const error = errorNames.get(name);
      if (error) {
        Object.defineProperty(request, 'error', {
          value: error,
          configurable: true,
        });
        request.onerror?.call(request, new Event('error'));
        return;
      }

      if (blockedNames.has(name)) {
        request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
        return;
      }

      request.onsuccess?.call(request, new Event('success'));
    });

    return request;
  });

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
    expect(LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT).toBe(500);
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

  it('starts IndexedDB store startup and Rust crypto initialization in parallel', async () => {
    const sessionId = createSessionId('https://example.com', '@user:example.com');
    let resolveStartup: (() => void) | undefined;
    let resolveRustCrypto: (() => void) | undefined;
    const startup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStartup = resolve;
        })
    );
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({
          startup,
        } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );

    const initRustCrypto = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRustCrypto = resolve;
        })
    );
    vi.mocked(createMatrixClient).mockReturnValue({
      initRustCrypto,
      setMaxListeners: vi.fn(),
    } as never);

    let settled = false;
    const initPromise = initClient({
      sessionId,
      baseUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@user:example.com',
      deviceId: 'DEVICE',
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(startup).toHaveBeenCalledTimes(1);
    expect(initRustCrypto).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveStartup?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRustCrypto?.();
    await initPromise;
    expect(settled).toBe(true);
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

describe('startClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts syncing with a bounded timeline filter and lazy-loaded members', async () => {
    const matrixStartClient = vi.fn().mockResolvedValue(undefined);
    const mx = {
      canSupport: new Map([[Feature.ThreadUnreadNotifications, ServerSupport.Stable]]),
      getUserId: vi.fn(() => '@user:example.com'),
      startClient: matrixStartClient,
    } as unknown as Parameters<typeof startClient>[0];

    await startClient(mx);

    expect(matrixStartClient).toHaveBeenCalledTimes(1);
    const startOptions = matrixStartClient.mock.calls[0][0];

    expect(startOptions).toMatchObject({
      lazyLoadMembers: true,
      threadSupport: true,
    });
    expect(startOptions.filter.getDefinition()).toMatchObject({
      room: {
        timeline: {
          limit: STARTUP_SYNC_TIMELINE_LIMIT,
        },
        state: {
          lazy_load_members: true,
        },
      },
    });
  });
});

describe('clearAllCacheAndReload', () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = globalThis.navigator;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDB,
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

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }

    if (originalSessionStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'sessionStorage');
    } else {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: originalSessionStorage,
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

  it('clears all localStorage (preserving only the multi-account store), clears sessionStorage, and navigates to the cache-busted app base path', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom';
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { state: localStorageState, storage: localStorageMock } = createStorageMock();
    const { state: sessionStorageState, storage: sessionStorageMock } = createStorageMock({
      transient: 'value',
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
    const preservedSessionStore = localStorageMock.getItem(SESSION_STORE_KEY);

    localStorageMock.setItem('settings', 'settings');
    localStorageMock.setItem('after_login_redirect_url', '/room');
    localStorageMock.setItem(MINDROOM_EDIT_DEBUG_STORAGE_KEY, '1');
    localStorageMock.setItem('i18nextLng', 'en');
    localStorageMock.setItem('kb-color-mode', 'dark');
    localStorageMock.setItem('cinny_access_token', 'legacy-token');
    localStorageMock.setItem(`navToActivePath${session.userId}`, '/room');
    localStorageMock.setItem(`mindroom_ios_push_token::${session.sessionId}`, 'push-token');
    localStorageMock.setItem('mx_pending_events_!room:example.com', 'pending');
    localStorageMock.setItem('mxjssdk_memory_filter_sync', 'filter');
    localStorageMock.setItem('crypto.account', 'crypto');
    localStorageMock.setItem('third_party_key', 'keep');

    const unregisterApp = vi.fn().mockResolvedValue(true);
    const unregisterOther = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([
      {
        scope: 'https://example.com/mindroom/',
        active: { scriptURL: 'https://example.com/mindroom/sw.js' },
        installing: null,
        waiting: null,
        unregister: unregisterApp,
      },
      {
        scope: 'https://example.com/other/',
        active: { scriptURL: 'https://example.com/other/sw.js' },
        installing: null,
        waiting: null,
        unregister: unregisterOther,
      },
    ] as unknown as ServiceWorkerRegistration[]);

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
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['cache-a', 'cache-b']),
      open: vi.fn().mockImplementation((cacheName: string) => {
        if (cacheName === 'cache-a') return Promise.resolve(appCache as unknown as Cache);
        return Promise.resolve(otherCache as unknown as Cache);
      }),
      delete: vi.fn().mockResolvedValue(true),
    };
    const replace = vi.fn();
    const deleteDatabase = createDeleteDatabaseMock();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([]),
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    const stopClient = vi.fn();

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(undefined),
      stopClient,
    } as never);

    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearSecretStorageKeys)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearMindroomLongTextHydrationCache)).toHaveBeenCalledTimes(1);
    expect(unregisterApp).toHaveBeenCalledTimes(1);
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(appCache.delete).toHaveBeenCalledWith(appRequest);
    expect(otherCache.delete).not.toHaveBeenCalled();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect(localStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(sessionStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(sessionStorageState.size).toBe(0);
    expect(localStorageState.get(SESSION_STORE_KEY)).toBe(preservedSessionStore);
    expect(localStorageState.has('third_party_key')).toBe(false);
    expect(localStorageState.has('settings')).toBe(false);
    expect(localStorageState.has('after_login_redirect_url')).toBe(false);
    expect(localStorageState.has(MINDROOM_EDIT_DEBUG_STORAGE_KEY)).toBe(false);
    expect(localStorageState.has('i18nextLng')).toBe(false);
    expect(localStorageState.has('kb-color-mode')).toBe(false);
    expect(localStorageState.has('cinny_access_token')).toBe(false);
    expect(localStorageState.has(`navToActivePath${session.userId}`)).toBe(false);
    expect(localStorageState.has(`mindroom_ios_push_token::${session.sessionId}`)).toBe(false);
    expect(localStorageState.has('mx_pending_events_!room:example.com')).toBe(false);
    expect(localStorageState.has('mxjssdk_memory_filter_sync')).toBe(false);
    expect(localStorageState.has('crypto.account')).toBe(false);
    expect(replace).toHaveBeenCalledWith('/mindroom?clear_cache=1234');
  });

  it('collects live-session, inactive-session, legacy, and event-cache IndexedDB names from indexedDB.databases()', async () => {
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();

    const activeSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@alice:example.com',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
      },
      undefined,
      localStorageMock
    );
    const inactiveSession = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@bob:example.com',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
      },
      { setActive: false },
      localStorageMock
    );
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    const liveSession = {
      sessionId: createSessionId('https://example.com', '@carol:example.com'),
      userId: '@carol:example.com',
      deviceId: 'DEVICE_C',
    };

    const deleteDatabase = createDeleteDatabaseMock();
    const indexedDbMock = {
      databases: vi
        .fn()
        .mockResolvedValue([
          { name: getSessionIndexedDbStoreName(activeSession).sync },
          { name: getSessionIndexedDbStoreName(inactiveSession).crypto },
          { name: getSessionRustCryptoStoreNames(inactiveSession)[0] },
          { name: getLegacySessionRustCryptoStoreNames(activeSession)[1] },
          { name: getThreadEventCacheDbName(activeSession.sessionId) },
          { name: getRoomEventCacheDbName(inactiveSession.sessionId) },
          { name: getSessionIndexedDbStoreName(liveSession).sync },
          { name: getThreadEventCacheDbName(liveSession.sessionId) },
          { name: 'matrix-js-sdk:web-sync-store' },
          { name: 'crypto-store' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto' },
          { name: 'matrix-js-sdk::matrix-sdk-crypto-meta' },
          { name: 'unrelated-db' },
        ]),
      deleteDatabase,
    };
    const replace = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(5678);

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: indexedDbMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(liveSession.deviceId),
      getHomeserverUrl: vi.fn().mockReturnValue('https://example.com'),
      getSafeUserId: vi.fn().mockReturnValue(liveSession.userId),
      stopClient: vi.fn(),
    } as never);

    expect(deleteDatabase.mock.calls.map(([name]) => name)).toEqual([
      getSessionIndexedDbStoreName(activeSession).sync,
      getSessionIndexedDbStoreName(inactiveSession).crypto,
      getSessionRustCryptoStoreNames(inactiveSession)[0],
      getLegacySessionRustCryptoStoreNames(activeSession)[1],
      getThreadEventCacheDbName(activeSession.sessionId),
      getRoomEventCacheDbName(inactiveSession.sessionId),
      getSessionIndexedDbStoreName(liveSession).sync,
      getThreadEventCacheDbName(liveSession.sessionId),
      'matrix-js-sdk:web-sync-store',
      'crypto-store',
      'matrix-js-sdk::matrix-sdk-crypto',
      'matrix-js-sdk::matrix-sdk-crypto-meta',
    ]);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=5678');
  });

  it('falls back to known app-owned IndexedDB names when indexedDB.databases() is unavailable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(6789);
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
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
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    const deleteDatabase = createDeleteDatabaseMock();
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
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
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(deleteDatabase.mock.calls.map(([name]) => name)).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
      'matrix-js-sdk:web-sync-store',
      'crypto-store',
      'matrix-js-sdk::matrix-sdk-crypto',
      'matrix-js-sdk::matrix-sdk-crypto-meta',
      getSessionIndexedDbStoreName(session).sync,
      getSessionIndexedDbStoreName(session).crypto,
      ...getSessionRustCryptoStoreNames(session),
      ...getLegacySessionRustCryptoStoreNames(session),
      getThreadEventCacheDbName(session.sessionId),
      getRoomEventCacheDbName(session.sessionId),
      getThreadSummaryCacheDbName(session.sessionId),
    ]);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=6789');
  });

  it('preserves existing app-base query params when adding the cache-busting query', async () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom?client=web';
    vi.spyOn(Date, 'now').mockReturnValue(7890);

    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(replace).toHaveBeenCalledWith('/mindroom?client=web&clear_cache=7890');
  });

  it('does not hang when IndexedDB delete requests are blocked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(8901);
    const { storage: localStorageMock } = createStorageMock();
    const { storage: sessionStorageMock } = createStorageMock();
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

    const blockedName = getSessionIndexedDbStoreName(session).sync;
    const deleteDatabase = createDeleteDatabaseMock({
      blockedNames: new Set([blockedName]),
    });
    const replace = vi.fn();

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        databases: vi.fn().mockResolvedValue([{ name: blockedName }]),
        deleteDatabase,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://example.com',
          replace,
        },
      },
      configurable: true,
    });

    await clearAllCacheAndReload();

    expect(deleteDatabase).toHaveBeenCalledWith(blockedName);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=8901');
  });

  it('continues to later cleanup steps when earlier steps fail', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(9012);
    const { storage: localStorageMock } = createStorageMock({
      settings: 'settings',
    });
    const { storage: sessionStorageMock } = createStorageMock({
      transient: 'value',
    });
    localStorageMock.setItem(LEGACY_SESSION_STORAGE_KEYS[0], 'legacy-token');

    vi.mocked(clearSecretStorageKeys).mockImplementation(() => {
      throw new Error('secret storage failure');
    });

    localStorageMock.removeItem = vi.fn(() => {
      throw new Error('localStorage failure');
    }) as Storage['removeItem'];

    const deleteDatabase = createDeleteDatabaseMock({
      errorNames: new Map([['mindroom-room-event-cache', new Error('delete failure')]]),
    });
    const replace = vi.fn();
    const getRegistrations = vi.fn().mockRejectedValue(new Error('service worker failure'));
    const cacheStorage = {
      keys: vi.fn().mockRejectedValue(new Error('cache failure')),
    };
    const stopClient = vi.fn(() => {
      throw new Error('stop failure');
    });

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          getRegistrations,
        },
      },
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
        location: {
          origin: 'https://example.com',
          replace,
        },
        caches: cacheStorage,
      },
      configurable: true,
    });

    await clearAllCacheAndReload({
      getDeviceId: vi.fn().mockReturnValue(undefined),
      stopClient,
    } as never);

    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith('mindroom-room-event-cache');
    expect(localStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(sessionStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/?clear_cache=9012');
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
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearRecentThreadsPanelHeightStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearRecentThreadsPanelMobileExpandedStore)).toHaveBeenCalledWith(
      session.userId
    );
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).toHaveBeenCalled();
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
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(userId);
    expect(vi.mocked(clearRecentThreadsPanelHeightStore)).toHaveBeenCalledWith(userId);
    expect(vi.mocked(clearRecentThreadsPanelMobileExpandedStore)).toHaveBeenCalledWith(userId);
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).toHaveBeenCalled();
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
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearRecentThreadsPanelHeightStore)).toHaveBeenCalledWith(session.userId);
    expect(vi.mocked(clearRecentThreadsPanelMobileExpandedStore)).toHaveBeenCalledWith(
      session.userId
    );
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).toHaveBeenCalled();
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
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith(inactiveSession.userId);
    expect(vi.mocked(clearRecentThreadsPanelHeightStore)).toHaveBeenCalledWith(
      inactiveSession.userId
    );
    expect(vi.mocked(clearRecentThreadsPanelMobileExpandedStore)).toHaveBeenCalledWith(
      inactiveSession.userId
    );
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).toHaveBeenCalled();
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith(inactiveSession.sessionId);
    expect(getSessionStore().sessions.map((session) => session.sessionId)).toEqual([
      activeSession.sessionId,
    ]);
    expect(getSessionStore().activeSessionId).toBe(activeSession.sessionId);
    expect(reload).not.toHaveBeenCalled();
  });
});
