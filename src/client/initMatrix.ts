import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { createMatrixClient } from './matrixClientFactory';
import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from '../app/utils/basePath';
import { deleteThreadEventCache } from '../app/features/room/threadEventCache';
import { deleteRoomEventCache } from '../app/features/room/roomEventCache';
import { clearIOSPushState } from '../app/utils/iosPush';
import {
  StoredSession,
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

export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 5000;

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
  const indexedDBStore = new IndexedDBStore(
    {
      indexedDB: global.indexedDB,
      localStorage: global.localStorage as Storage,
      dbName: storeNames.sync,
    } as ConstructorParameters<typeof IndexedDBStore>[0]
  );
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
    cryptoCallbacks: cryptoCallbacks as unknown as CryptoCallbacks,
    verificationMethods: ['m.sas.v1'],
  });

  await indexedDBStore.startup();
  await mx.initRustCrypto({
    cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session),
  });

  mx.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
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

const APP_OWNED_INDEXED_DB_PREFIXES = ['matrix-js-sdk:', 'matrix-js-sdk::', 'crypto-store::'];
const APP_OWNED_INDEXED_DB_NAMES = ['mindroom-room-event-cache', 'mindroom-thread-event-cache'];

const isAppOwnedIndexedDbName = (name: string): boolean =>
  APP_OWNED_INDEXED_DB_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
  APP_OWNED_INDEXED_DB_NAMES.includes(name) ||
  name === 'crypto-store';

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
    session ? deleteNamedDatabases(getLegacySessionRustCryptoStoreNames(session)) : Promise.resolve(),
  ]);

  return session;
};

export const deleteSessionLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  clearNavToActivePathStore(session.userId);

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
    removeActiveSession();
  }

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
  clearNavToActivePathStore(mx.getSafeUserId());
  const activeSession = getActiveSession() ?? getMatrixClientSessionCleanupContext(mx);
  await Promise.all([
    clearMatrixClientStores(mx, activeSession),
    activeSession ? deleteThreadEventCache(activeSession.sessionId) : Promise.resolve(),
    activeSession ? deleteRoomEventCache(activeSession.sessionId) : Promise.resolve(),
  ]);
  window.location.reload();
};

export const clearBrowserCacheAndReload = async () => {
  const appScopeUrl = new URL(
    ensureBasePathTrailingSlash(getAppBasePath()),
    window.location.origin
  ).href;
  const normalizeUrl = (url: string): string => {
    const parsed = new URL(url, window.location.origin);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  };
  const appServiceWorkerScriptUrls = new Set([
    normalizeUrl(appUrl('sw.js')),
    normalizeUrl(appUrl('dev-sw.js')),
  ]);

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            const workerScriptUrls = [registration.active, registration.installing, registration.waiting]
              .filter((worker): worker is ServiceWorker => Boolean(worker))
              .map((worker) => normalizeUrl(worker.scriptURL));

            if (workerScriptUrls.some((workerScriptUrl) => appServiceWorkerScriptUrls.has(workerScriptUrl))) {
              return true;
            }

            return normalizeUrl(registration.scope) === normalizeUrl(appScopeUrl);
          })
          .map((registration) => registration.unregister())
      );
    }
  } catch {
    // ignore browser service worker cleanup errors
  }

  try {
    if ('caches' in window) {
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
    }
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
  const dbs = await window.indexedDB.databases();
  const appOwnedDbNames = dbs
    .map((idbInfo) => idbInfo.name)
    .filter((name): name is string => Boolean(name))
    .filter(isAppOwnedIndexedDbName);

  await deleteNamedDatabases(appOwnedDbNames);

  await Promise.all(
    sessions.map((session) =>
      Promise.all([
        deleteThreadEventCache(session.sessionId),
        deleteRoomEventCache(session.sessionId),
      ]).catch(() => undefined)
    )
  );
  sessions.forEach((session) => {
    clearNavToActivePathStore(session.userId);
    clearIOSPushState(session.sessionId);
  });

  clearSessionStore();
  window.location.reload();
};
