import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { Filter } from 'matrix-js-sdk/lib/filter';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';

import { clearSecretStorageKeys, cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import {
  appUrl,
  ensureBasePathTrailingSlash,
  getAppBasePath,
  normalizeBasePath,
} from '../app/utils/basePath';
import {
  MINDROOM_SINGLETON_INDEXED_DB_NAMES,
  clearMindroomInMemoryCaches,
  clearMindroomSessionNativeState,
  clearMindroomSessionUiState,
  clearMindroomUserUiState,
  deleteMindroomSessionCaches,
  getMindroomSessionIndexedDbNames,
} from '../app/mindroom/cache/sessionCleanup';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  SESSION_STORE_KEY,
  StoredSession,
  clearLegacySessionStorage,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStoreName,
  listSessions,
  removeSession,
  updateSessionCredentials,
} from '../app/state/sessions';
import { clearAppOwnedCacheLocalStorage } from '../app/utils/appOwnedStorage';
import { stopMindroomSyncEngineForClient } from '../app/mindroom/engine/mindroomSyncEngine';

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
  'sessionId' | 'baseUrl' | 'userId' | 'deviceId' | 'accessToken' | 'refreshToken'
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

  const refreshClient = session.refreshToken
    ? createMatrixClient({ baseUrl: session.baseUrl })
    : undefined;
  const tokenRefreshFunction = refreshClient
    ? async (refreshToken: string) => {
        const response = await refreshClient.refreshToken(refreshToken);
        const nextRefreshToken = response.refresh_token ?? refreshToken;
        const expiresInMs =
          typeof response.expires_in_ms === 'number' ? response.expires_in_ms : undefined;
        updateSessionCredentials(
          session.sessionId,
          {
            accessToken: response.access_token,
            refreshToken: nextRefreshToken,
            expiresInMs,
          },
          { expectedRefreshToken: refreshToken }
        );
        return {
          accessToken: response.access_token,
          refreshToken: nextRefreshToken,
          expiry: expiresInMs === undefined ? undefined : new Date(Date.now() + expiresInMs),
        };
      }
    : undefined;

  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenRefreshFunction,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    threadSupport: true,
    cryptoCallbacks: cryptoCallbacks as unknown as CryptoCallbacks,
    verificationMethods: ['m.sas.v1'],
  });

  const initializationResults = await Promise.allSettled([
    indexedDBStore.startup(),
    mx.initRustCrypto({
      cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
    }),
  ]);
  const initializationFailure = initializationResults.find(
    (result) => result.status === 'rejected'
  );
  if (initializationFailure?.status === 'rejected') {
    // Both initializers may open IndexedDB handles. Wait for the sibling to
    // settle before disposing the partial runtime so retry starts cleanly.
    await Promise.allSettled([
      Promise.resolve().then(() => mx.stopClient()),
      indexedDBStore.destroy(),
    ]);
    throw initializationFailure.reason;
  }

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
  reloadUrl.pathname = ensureBasePathTrailingSlash(normalizeBasePath(reloadUrl.pathname));
  reloadUrl.searchParams.set('clear_cache', `${Date.now()}`);
  return `${reloadUrl.pathname}${reloadUrl.search}${reloadUrl.hash}`;
};

const LEGACY_APP_SINGLETON_INDEXED_DB_NAMES = [
  'matrix-js-sdk:web-sync-store',
  'crypto-store',
  'matrix-js-sdk::matrix-sdk-crypto',
  'matrix-js-sdk::matrix-sdk-crypto-meta',
];
const APP_SINGLETON_INDEXED_DB_NAMES: readonly string[] = [...MINDROOM_SINGLETON_INDEXED_DB_NAMES];

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
    ...getMindroomSessionIndexedDbNames(session.sessionId),
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

const getAllSessionRustCryptoDbNames = async (
  session: SessionCleanupContext
): Promise<string[]> => {
  const fallbackNames = [
    ...getSessionRustCryptoStoreNames(session),
    ...getLegacySessionRustCryptoStoreNames(session),
  ];
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return fallbackNames;
  }

  try {
    const databases = await indexedDB.databases();
    return Array.from(
      new Set([
        ...fallbackNames,
        ...databases.flatMap(({ name }) =>
          name && isSessionRustCryptoDbName(name, session.sessionId) ? [name] : []
        ),
      ])
    );
  } catch {
    return fallbackNames;
  }
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

const getMatrixClientSessionIdentity = (
  mx: Pick<MatrixClient, 'getHomeserverUrl' | 'getSafeUserId'>
): Pick<SessionCleanupContext, 'sessionId' | 'userId'> => {
  const userId = mx.getSafeUserId();
  return {
    sessionId: createSessionId(mx.getHomeserverUrl(), userId),
    userId,
  };
};

const getMatrixClientSessionCleanupContext = (
  mx: Pick<MatrixClient, 'getDeviceId' | 'getHomeserverUrl' | 'getSafeUserId'>,
  candidate?: SessionCleanupContext
): SessionCleanupContext | undefined => {
  const identity = getMatrixClientSessionIdentity(mx);
  const deviceId = mx.getDeviceId();
  if (deviceId) return { ...identity, deviceId };
  if (candidate?.sessionId === identity.sessionId && candidate.userId === identity.userId) {
    return candidate;
  }

  return undefined;
};

const stopClientRuntime = (mx: MatrixClient): void => {
  try {
    stopMindroomSyncEngineForClient(mx);
  } catch {
    // Matrix cleanup must continue even if a trailing cache flush fails.
  }
  mx.stopClient();
};

const clearSessionScopedUiState = (
  session: Pick<SessionCleanupContext, 'sessionId' | 'userId'>,
  clearUserScopedState = true
): void => {
  const { sessionId, userId } = session;
  if (clearUserScopedState) {
    try {
      clearNavToActivePathStore(userId);
      clearMindroomUserUiState(userId);
    } catch {
      // Local UI cleanup is best effort and must not retain account credentials.
    }
  }
  try {
    clearMindroomSessionUiState(sessionId);
  } catch {
    // Continue with Matrix stores and credential removal.
  }
};

const clearSessionScopedNativeState = (sessionId: string): void => {
  try {
    clearMindroomSessionNativeState(sessionId);
  } catch {
    // Native preference cleanup is best effort during account removal.
  }
};

const clearMatrixClientStores = async (
  mx: MatrixClient,
  candidate?: SessionCleanupContext
): Promise<void> => {
  const session = getMatrixClientSessionCleanupContext(mx, candidate);
  const additionalRustStoreNames = session
    ? (await getAllSessionRustCryptoDbNames(session)).filter(
        (name) => !getSessionRustCryptoStoreNames(session).includes(name)
      )
    : [];
  await Promise.all([
    session
      ? mx.clearStores({
          cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
        })
      : mx.clearStores(),
    deleteNamedDatabases(additionalRustStoreNames),
  ]);
};

export const deleteSessionLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient,
  clearUserScopedState = true
): Promise<void> => {
  clearSessionScopedUiState(session, clearUserScopedState);

  const indexedDbStoreNames = getSessionIndexedDbStoreName(session);
  const rustCryptoStoreNames = mx ? [] : await getAllSessionRustCryptoDbNames(session);

  // Teardown is best effort across independent stores. A blocked cache DB
  // must not prevent crypto, sync, native, and credential cleanup from
  // running; reloading will also release this tab's remaining DB handles.
  await Promise.allSettled([
    mx ? clearMatrixClientStores(mx, session) : deleteNamedDatabase(indexedDbStoreNames.sync),
    mx ? Promise.resolve() : deleteNamedDatabase(indexedDbStoreNames.crypto),
    mx ? Promise.resolve() : deleteNamedDatabases(rustCryptoStoreNames),
    deleteMindroomSessionCaches(session.sessionId),
  ]);
  clearSessionScopedNativeState(session.sessionId);
};

export const removeSessionAndReload = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  if (mx) {
    await removeCurrentClientSessionAndReload(mx, session);
    return;
  }

  // Keep a recoverable account until its registry update succeeds. Orphaned
  // cache data is safe to clean up later; deleting crypto for an account that
  // remains selectable is not.
  const nextStore = removeSession(session.sessionId);
  try {
    await deleteSessionLocalData(
      session,
      undefined,
      !nextStore.sessions.some((storedSession) => storedSession.userId === session.userId)
    );
  } finally {
    clearLegacySessionStorage();
  }
  window.location.reload();
};

export const removeCurrentClientSessionAndReload = async (
  mx: MatrixClient,
  candidate?: SessionCleanupContext
): Promise<void> => {
  const session = getMatrixClientSessionCleanupContext(mx, candidate);
  const identity = getMatrixClientSessionIdentity(mx);
  stopClientRuntime(mx);

  const removedIdentity = session ?? identity;
  const nextStore = removeSession(removedIdentity.sessionId);
  const clearUserScopedState = !nextStore.sessions.some(
    (storedSession) => storedSession.userId === removedIdentity.userId
  );
  try {
    if (session) {
      await deleteSessionLocalData(session, mx, clearUserScopedState);
    } else {
      await clearMatrixClientStores(mx);
      clearSessionScopedUiState(identity, clearUserScopedState);
    }
  } finally {
    clearLegacySessionStorage();
  }
  window.location.reload();
};

export const removeStoredSession = async (session: StoredSession): Promise<void> => {
  const activeSession = getActiveSession();
  if (activeSession?.sessionId === session.sessionId) {
    await removeSessionAndReload(session);
    return;
  }

  const nextStore = removeSession(session.sessionId);
  try {
    await deleteSessionLocalData(
      session,
      undefined,
      !nextStore.sessions.some((storedSession) => storedSession.userId === session.userId)
    );
  } finally {
    clearLegacySessionStorage();
  }
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  stopClientRuntime(mx);
  const identity = getMatrixClientSessionIdentity(mx);
  const session = getMatrixClientSessionCleanupContext(mx, getActiveSession());
  clearSessionScopedUiState(identity);
  await Promise.all([
    clearMatrixClientStores(mx, session),
    deleteMindroomSessionCaches(identity.sessionId),
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
  const appBasePath = getAppBasePath();

  try {
    if (mx) stopClientRuntime(mx);
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
    clearMindroomInMemoryCaches();
  } catch {
    // ignore MindRoom in-memory cleanup errors
  }

  try {
    const appOwnedDbNames = await getAppOwnedIndexedDbNames(sessions, legacySessionStoragePresent);
    await deleteNamedDatabases(appOwnedDbNames);
  } catch {
    // ignore IndexedDB cleanup errors
  }

  try {
    clearAppOwnedCacheLocalStorage(new Set([SESSION_STORE_KEY]));
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
  stopClientRuntime(mx);
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await removeCurrentClientSessionAndReload(mx, activeSession);
};
