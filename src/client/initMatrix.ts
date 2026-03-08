import { MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { createMatrixClient } from './matrixClientFactory';
import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from '../app/utils/basePath';
import { deleteThreadEventCache } from '../app/features/room/threadEventCache';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 5000;

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

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: 'web-sync-store',
  });
  configureLargeSyncArchive(indexedDBStore);

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, 'crypto-store');

  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
  });

  await indexedDBStore.startup();
  await mx.initRustCrypto();

  mx.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await Promise.all([mx.store.deleteAllData(), deleteThreadEventCache()]);
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
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await Promise.all([mx.clearStores(), deleteThreadEventCache()]);
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  await deleteThreadEventCache();

  window.localStorage.clear();
  window.location.reload();
};
