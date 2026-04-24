import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { Filter } from 'matrix-js-sdk/lib/filter';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';

import { clearSecretStorageKeys, cryptoCallbacks } from './secretStorageKeys';
import { clearLastOpenThreadStore } from '../app/state/lastOpenThread';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { clearRecentThreadsStore } from '../app/state/recentThreads';
import { clearRecentThreadsPanelHeightStore } from '../app/state/recentThreadsPanelHeight';
import { clearRecentThreadsPanelMobileExpandedStore } from '../app/state/recentThreadsPanelMobileExpanded';
import { clearRoomThreadFiltersStore } from '../app/state/room/roomThreadFilterState';
import { createMatrixClient } from './matrixClientFactory';
import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from '../app/utils/basePath';
import { clearMindroomLongTextHydrationCache } from '../app/components/message/mindroomLongText';
import { clearRecentThreadViewModelSharedState } from '../app/mindroom/threads/recentThreadViewModel';
import {
  deleteThreadEventCache,
  getThreadEventCacheDbName,
} from '../app/features/room/threadEventCache';
import { deleteRoomEventCache, getRoomEventCacheDbName } from '../app/features/room/roomEventCache';
import { deleteThreadSummaryCache } from '../app/features/room/threadSummaryCache';
import { clearIOSPushState } from '../app/utils/iosPush';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SESSION_STORE_KEY,
  StoredSession,
  clearLegacySessionStorage,
  clearSessionStore,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStoreName,
  listSessions,
  removeSession,
  removeActiveSession,
} from '../app/state/sessions';

export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 500;
export const STARTUP_SYNC_TIMELINE_LIMIT = 20;

type SessionCleanupContext = Pick<StoredSession, 'sessionId' | 'userId' | 'deviceId'>;

type IndexedDBStoreWithSyncAccumulator = IndexedDBStore & {
  backend?: {
    syncAccumulator?: {
      opts?: {
        maxTimelineEntries?: number;
      };
    };
  };
};

export const configureLargeSyncArchive = (indexedDBStore: IndexedDBStore): void => {
  const syncAccumulator = (indexedDBStore as IndexedDBStoreWithSyncAccumulator).backend
    ?.syncAccumulator;
  if (!syncAccumulator?.opts) return;

  syncAccumulator.opts.maxTimelineEntries = Math.max(
    syncAccumulator.opts.maxTimelineEntries ?? 0,
    LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT
  );
};

export type ClientBootstrapSession = Pick<
  StoredSession,
  'sessionId' | 'baseUrl' | 'userId' | 'deviceId' | 'accessToken'
>;

export const initClient = async (session: ClientBootstrapSession): Promise<MatrixClient> => {
  const storeNames = getSessionStoreName(session);
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage as Storage,
    dbName: storeNames.sync,
  } as ConstructorParameters<typeof IndexedDBStore>[0]);
  configureLargeSyncArchive(indexedDBStore);

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, storeNames.crypto);

  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    threadSupport: true,
    cryptoCallbacks: cryptoCallbacks as unknown as CryptoCallbacks,
    verificationMethods: ['m.sas.v1'],
  });

  await Promise.all([
    indexedDBStore.startup(),
    mx.initRustCrypto({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
    }),
  ]);

  mx.setMaxListeners(50);

  return mx;
};

const createStartupSyncFilter = (mx: MatrixClient): Filter => {
  const filter = new Filter(mx.getUserId());
  filter.setDefinition({
    room: {
      timeline: {
        limit: STARTUP_SYNC_TIMELINE_LIMIT,
      },
      state: {
        lazy_load_members: true,
      },
    },
  });

  if (mx.canSupport.get(Feature.ThreadUnreadNotifications) !== ServerSupport.Unsupported) {
    filter.setUnreadThreadNotifications(true);
  }

  return filter;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    filter: createStartupSyncFilter(mx),
    lazyLoadMembers: true,
    threadSupport: true,
  });
};

const deleteNamedDatabase = async (name: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
};

const deleteNamedDatabases = async (names: string[]): Promise<void> => {
  const uniqueNames = Array.from(new Set(names));
  if (uniqueNames.length === 0) return;

  await Promise.all(uniqueNames.map((name) => deleteNamedDatabase(name)));
};

const getCacheBustedAppReloadTarget = (appBasePath: string): string => {
  const reloadUrl = new URL(appBasePath, window.location.origin);
  reloadUrl.searchParams.set('clear_cache', `${Date.now()}`);
  return `${reloadUrl.pathname}${reloadUrl.search}${reloadUrl.hash}`;
};

const LEGACY_APP_SINGLETON_INDEXED_DB_NAMES = [
  'matrix-js-sdk:web-sync-store',
  'crypto-store',
  'matrix-js-sdk::matrix-sdk-crypto',
  'matrix-js-sdk::matrix-sdk-crypto-meta',
];
const APP_SINGLETON_INDEXED_DB_NAMES = ['mindroom-room-event-cache', 'mindroom-thread-event-cache'];
const APP_OWNED_LOCAL_STORAGE_KEYS = [
  'settings',
  'after_login_redirect_url',
  'mindroom.debug.edits',
  'i18nextLng',
  'kb-color-mode',
] as const;
const APP_OWNED_LOCAL_STORAGE_PREFIXES = [
  'cinny_',
  'navToActivePath',
  'mindroom_ios_push_',
  'mx_pending_events_',
  'mxjssdk_memory_filter_',
  'crypto.',
] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getStoredSessionCleanupContexts = (): SessionCleanupContext[] =>
  listSessions().map((session) => ({
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
  }));

const mergeSessionCleanupContexts = (
  contexts: SessionCleanupContext[]
): SessionCleanupContext[] => {
  const mergedContexts = new Map<string, SessionCleanupContext>();

  contexts.forEach((context) => {
    mergedContexts.set(context.sessionId, context);
  });

  return Array.from(mergedContexts.values());
};

const getSessionOwnedIndexedDbNames = (session: SessionCleanupContext): string[] => {
  const indexedDbStoreNames = getSessionIndexedDbStoreName(session);

  return [
    indexedDbStoreNames.sync,
    indexedDbStoreNames.crypto,
    ...getSessionRustCryptoStoreNames(session),
    ...getLegacySessionRustCryptoStoreNames(session),
    getThreadEventCacheDbName(session.sessionId),
    getRoomEventCacheDbName(session.sessionId),
  ];
};

const getFallbackAppOwnedIndexedDbNames = (
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): string[] =>
  Array.from(
    new Set([
      ...APP_SINGLETON_INDEXED_DB_NAMES,
      ...(legacySessionStoragePresent ? LEGACY_APP_SINGLETON_INDEXED_DB_NAMES : []),
      ...sessions.flatMap((session) => getSessionOwnedIndexedDbNames(session)),
    ])
  );

const isSessionRustCryptoDbName = (name: string, sessionId: string): boolean => {
  const escapedSessionId = escapeRegExp(sessionId);
  const pattern = new RegExp(
    `^matrix-js-sdk::${escapedSessionId}(?:::.*)?::matrix-sdk-crypto(?:-meta)?$`
  );
  return pattern.test(name);
};

const hasLegacySessionStorage = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    return LEGACY_SESSION_STORAGE_KEYS.some((key) => Boolean(localStorage.getItem(key)));
  } catch {
    return false;
  }
};

const isAppOwnedIndexedDbName = (
  name: string,
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): boolean => {
  if (APP_SINGLETON_INDEXED_DB_NAMES.includes(name)) return true;
  if (legacySessionStoragePresent && LEGACY_APP_SINGLETON_INDEXED_DB_NAMES.includes(name))
    return true;

  return sessions.some((session) => {
    const knownNames = getSessionOwnedIndexedDbNames(session);
    return knownNames.includes(name) || isSessionRustCryptoDbName(name, session.sessionId);
  });
};

const getAppOwnedIndexedDbNames = async (
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): Promise<string[]> => {
  const fallbackNames = getFallbackAppOwnedIndexedDbNames(sessions, legacySessionStoragePresent);
  if (typeof indexedDB === 'undefined') return [];
  if (typeof indexedDB.databases !== 'function') return fallbackNames;

  try {
    const dbs = await indexedDB.databases();

    return dbs
      .map((idbInfo) => idbInfo.name)
      .filter((name): name is string => Boolean(name))
      .filter((name) => isAppOwnedIndexedDbName(name, sessions, legacySessionStoragePresent));
  } catch {
    return fallbackNames;
  }
};

const getStorageKeys = (storage: Pick<Storage, 'length' | 'key'>): string[] =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => Boolean(key)
  );

const isAppOwnedLocalStorageKey = (key: string): boolean =>
  key !== SESSION_STORE_KEY &&
  (APP_OWNED_LOCAL_STORAGE_KEYS.includes(key as typeof APP_OWNED_LOCAL_STORAGE_KEYS[number]) ||
    APP_OWNED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)));

const clearAppOwnedLocalStorage = (preservedSessionStore: string | null): void => {
  if (typeof localStorage === 'undefined') return;

  // Nuclear wipe: clear ALL localStorage, not just app-owned keys.
  // This matches the "private window" experience the user expects.
  // Only the session store (login credentials) is preserved.
  localStorage.clear();

  if (preservedSessionStore !== null) {
    localStorage.setItem(SESSION_STORE_KEY, preservedSessionStore);
  }
};

const getPreservedSessionStore = (): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SESSION_STORE_KEY);
  } catch {
    return null;
  }
};

type AppScopedBrowserCleanupContext = {
  appScopeUrl: string;
  appServiceWorkerScriptUrls: Set<string>;
  normalizeUrl: (url: string) => string;
};

const getAppScopedBrowserCleanupContext = (
  appBasePath: string,
  origin: string = window.location.origin
): AppScopedBrowserCleanupContext => {
  const normalizeUrl = (url: string): string => {
    const parsed = new URL(url, origin);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  };

  return {
    appScopeUrl: new URL(ensureBasePathTrailingSlash(appBasePath), origin).href,
    appServiceWorkerScriptUrls: new Set([
      normalizeUrl(appUrl('sw.js', appBasePath)),
      normalizeUrl(appUrl('dev-sw.js', appBasePath)),
    ]),
    normalizeUrl,
  };
};

const clearAppScopedServiceWorkers = async (appBasePath: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const { appScopeUrl, appServiceWorkerScriptUrls, normalizeUrl } =
    getAppScopedBrowserCleanupContext(appBasePath);
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations
      .filter((registration) => {
        const workerScriptUrls = [
          registration.active,
          registration.installing,
          registration.waiting,
        ]
          .filter((worker): worker is ServiceWorker => Boolean(worker))
          .map((worker) => normalizeUrl(worker.scriptURL));

        if (
          workerScriptUrls.some((workerScriptUrl) =>
            appServiceWorkerScriptUrls.has(workerScriptUrl)
          )
        ) {
          return true;
        }

        return normalizeUrl(registration.scope) === normalizeUrl(appScopeUrl);
      })
      .map((registration) => registration.unregister())
  );
};

const clearAppScopedCacheStorage = async (appBasePath: string): Promise<void> => {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  const { appScopeUrl, normalizeUrl } = getAppScopedBrowserCleanupContext(appBasePath);
  const cacheNames = await window.caches.keys();

  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await window.caches.open(cacheName);
      const requests = await cache.keys();

      await Promise.all(
        requests
          .filter((request) => normalizeUrl(request.url).startsWith(appScopeUrl))
          .map((request) => cache.delete(request))
      );

      const remainingRequests = await cache.keys();
      if (remainingRequests.length === 0 && requests.length > 0) {
        await window.caches.delete(cacheName);
      }
    })
  );
};

const getMatrixClientSessionCleanupContext = (
  mx: Pick<MatrixClient, 'getDeviceId' | 'getHomeserverUrl' | 'getSafeUserId'>
): SessionCleanupContext | undefined => {
  const deviceId = mx.getDeviceId();
  if (!deviceId) return undefined;

  const userId = mx.getSafeUserId();
  return {
    sessionId: createSessionId(mx.getHomeserverUrl(), userId),
    userId,
    deviceId,
  };
};

const clearSessionScopedUiState = (userId: string): void => {
  clearLastOpenThreadStore(userId);
  clearNavToActivePathStore(userId);
  clearRoomThreadFiltersStore(userId);
  clearRecentThreadsStore(userId);
  clearRecentThreadsPanelHeightStore(userId);
  clearRecentThreadsPanelMobileExpandedStore(userId);
  clearRecentThreadViewModelSharedState();
};

const clearMatrixClientStores = async (
  mx: MatrixClient,
  session: SessionCleanupContext | undefined = getMatrixClientSessionCleanupContext(mx)
): Promise<SessionCleanupContext | undefined> => {
  await Promise.all([
    session
      ? mx.clearStores({
          cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
        })
      : mx.clearStores(),
    session
      ? deleteNamedDatabases(getLegacySessionRustCryptoStoreNames(session))
      : Promise.resolve(),
  ]);

  return session;
};

export const deleteSessionLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  clearSessionScopedUiState(session.userId);

  const indexedDbStoreNames = getSessionIndexedDbStoreName(session);
  const rustCryptoStoreNames = Array.from(
    new Set([
      ...getSessionRustCryptoStoreNames(session),
      ...getLegacySessionRustCryptoStoreNames(session),
    ])
  );

  await Promise.all([
    mx ? clearMatrixClientStores(mx, session) : deleteNamedDatabase(indexedDbStoreNames.sync),
    mx ? Promise.resolve() : deleteNamedDatabase(indexedDbStoreNames.crypto),
    mx ? Promise.resolve() : deleteNamedDatabases(rustCryptoStoreNames),
    deleteThreadEventCache(session.sessionId),
    deleteRoomEventCache(session.sessionId),
    deleteThreadSummaryCache(session.sessionId),
  ]);
  clearIOSPushState(session.sessionId);
};

export const removeSessionAndReload = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  mx?.stopClient();
  await deleteSessionLocalData(session, mx);
  removeSession(session.sessionId);
  clearLegacySessionStorage();
  window.location.reload();
};

export const removeCurrentClientSessionAndReload = async (
  mx: MatrixClient,
  session: SessionCleanupContext | undefined = getMatrixClientSessionCleanupContext(mx)
): Promise<void> => {
  mx.stopClient();

  if (session) {
    await deleteSessionLocalData(session, mx);
    removeSession(session.sessionId);
  } else {
    await clearMatrixClientStores(mx);
    clearSessionScopedUiState(mx.getSafeUserId());
    removeActiveSession();
  }

  clearLegacySessionStorage();
  window.location.reload();
};

export const removeStoredSession = async (session: StoredSession): Promise<void> => {
  const activeSession = getActiveSession();
  if (activeSession?.sessionId === session.sessionId) {
    await removeSessionAndReload(session);
    return;
  }

  await deleteSessionLocalData(session);
  removeSession(session.sessionId);
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  const userId = mx.getSafeUserId();
  clearSessionScopedUiState(userId);
  const activeSession = getActiveSession() ?? getMatrixClientSessionCleanupContext(mx);
  await Promise.all([
    clearMatrixClientStores(mx, activeSession),
    activeSession ? deleteThreadEventCache(activeSession.sessionId) : Promise.resolve(),
    activeSession ? deleteRoomEventCache(activeSession.sessionId) : Promise.resolve(),
    activeSession ? deleteThreadSummaryCache(activeSession.sessionId) : Promise.resolve(),
  ]);
  window.location.reload();
};

export const clearAllCacheAndReload = async (mx?: MatrixClient): Promise<void> => {
  const liveSession = mx ? getMatrixClientSessionCleanupContext(mx) : undefined;
  const sessions = mergeSessionCleanupContexts([
    ...getStoredSessionCleanupContexts(),
    ...(liveSession ? [liveSession] : []),
  ]);
  const legacySessionStoragePresent = hasLegacySessionStorage();
  const preservedSessionStore = getPreservedSessionStore();
  const appBasePath = getAppBasePath();

  try {
    mx?.stopClient();
  } catch {
    // ignore stop errors and continue clearing the rest of the app state
  }

  try {
    await clearAppScopedServiceWorkers(appBasePath);
  } catch {
    // ignore browser service worker cleanup errors
  }

  try {
    await clearAppScopedCacheStorage(appBasePath);
  } catch {
    // ignore browser cache storage cleanup errors
  }

  try {
    clearSecretStorageKeys();
  } catch {
    // ignore secret storage cleanup errors
  }

  try {
    clearMindroomLongTextHydrationCache();
  } catch {
    // ignore long-text hydration cache cleanup errors
  }

  try {
    const appOwnedDbNames = await getAppOwnedIndexedDbNames(sessions, legacySessionStoragePresent);
    await deleteNamedDatabases(appOwnedDbNames);
  } catch {
    // ignore IndexedDB cleanup errors
  }

  try {
    clearAppOwnedLocalStorage(preservedSessionStore);
  } catch {
    // ignore localStorage cleanup errors
  }

  try {
    sessionStorage.clear();
  } catch {
    // ignore sessionStorage cleanup errors
  }

  window.location.replace(getCacheBustedAppReloadTarget(appBasePath));
};

export const clearBrowserCacheAndReload = async () => {
  const appBasePath = getAppBasePath();

  try {
    await clearAppScopedServiceWorkers(appBasePath);
  } catch {
    // ignore browser service worker cleanup errors
  }

  try {
    await clearAppScopedCacheStorage(appBasePath);
  } catch {
    // ignore browser cache storage cleanup errors
  }

  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  const activeSession = getActiveSession();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await removeCurrentClientSessionAndReload(mx, activeSession);
};

export const clearLoginData = async () => {
  const sessions = listSessions();
  const legacySessionStoragePresent = hasLegacySessionStorage();
  const dbs = await window.indexedDB.databases();
  const appOwnedDbNames = dbs
    .map((idbInfo) => idbInfo.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => isAppOwnedIndexedDbName(name, sessions, legacySessionStoragePresent));

  await deleteNamedDatabases(appOwnedDbNames);

  await Promise.all(
    sessions.map((session) =>
      Promise.all([
        deleteThreadEventCache(session.sessionId),
        deleteRoomEventCache(session.sessionId),
        deleteThreadSummaryCache(session.sessionId),
      ]).catch(() => undefined)
    )
  );
  sessions.forEach((session) => {
    clearSessionScopedUiState(session.userId);
    clearIOSPushState(session.sessionId);
  });

  clearLegacySessionStorage();
  clearSessionStore();
  window.location.reload();
};
