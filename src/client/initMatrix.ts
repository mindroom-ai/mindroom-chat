import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk/lib/client';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { Filter } from 'matrix-js-sdk/lib/filter';
import { Method } from 'matrix-js-sdk/lib/http-api';
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
  StoredSession,
  clearLegacySessionStorage,
  createSessionId,
  getActiveSession,
  getSessionIndexedDbStoreName,
  getLegacySessionRustCryptoStoreNames,
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  hasInitializedCryptoStore,
  getSessionStoreName,
  listSessions,
  markCryptoStoreInitialized,
  removeSession,
} from '../app/state/sessions';
import { clearAppOwnedCacheLocalStorage } from '../app/utils/appOwnedStorage';
import { stopMindroomSyncEngineForClient } from '../app/mindroom/engine/mindroomSyncEngine';
import { createSessionTokenRefresh } from './sessionTokenRefresh';

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

export class MissingCryptoStoreError extends Error {
  constructor(userId: string) {
    super(
      `The encryption storage for ${userId} is missing while its existing Matrix device login is still present. ` +
        'Continuing would replace that device identity and make encrypted messages and calls unreadable to other devices. ' +
        'Remove this account, then sign in again to create a new Matrix device.'
    );
    this.name = 'MissingCryptoStoreError';
  }
}

export class DeviceIdentityVerificationError extends Error {
  constructor(userId: string) {
    super(
      `MindRoom Chat could not verify the encryption identity for ${userId} with the homeserver. ` +
        'Check your connection and retry. No encryption keys were changed.'
    );
    this.name = 'DeviceIdentityVerificationError';
  }
}

export class DeviceIdentityMismatchError extends Error {
  constructor(userId: string) {
    super(
      `The local encryption identity for ${userId} no longer matches this Matrix device on the homeserver. ` +
        'Encrypted messages and calls cannot be trusted in this state. ' +
        'Remove this account, then sign in again to create a new Matrix device.'
    );
    this.name = 'DeviceIdentityMismatchError';
  }
}

const inspectDatabaseExistence = async (name: string): Promise<boolean | undefined> => {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') return undefined;

  return new Promise<boolean | undefined>((resolve) => {
    let created = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return;
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(!created);
    };
    request.onerror = () => {
      if (created || request.error?.name === 'AbortError') {
        // An aborted first open should not persist a database, but delete it
        // defensively before Rust crypto gets a chance to create the real one.
        let deletion: IDBOpenDBRequest;
        try {
          deletion = indexedDB.deleteDatabase(name);
        } catch {
          resolve(false);
          return;
        }
        deletion.onsuccess = () => resolve(false);
        deletion.onerror = () => resolve(false);
        deletion.onblocked = () => resolve(false);
        return;
      }
      resolve(undefined);
    };
  });
};

const inspectCryptoStoreContinuity = async (
  session: ClientBootstrapSession
): Promise<boolean | undefined> => {
  if (typeof indexedDB === 'undefined') return undefined;
  const expectedNames = getSessionRustCryptoStoreNames(session);

  if (typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      const names = new Set(databases.flatMap(({ name }) => (name ? [name] : [])));
      return expectedNames.every((name) => names.has(name));
    } catch {
      // Safari privacy modes and older browsers may deny enumeration. Fall
      // back to non-destructively opening each known database name.
    }
  }

  const existence = await Promise.all(expectedNames.map(inspectDatabaseExistence));
  if (existence.some((exists) => exists === false)) return false;
  if (existence.every((exists) => exists === true)) return true;
  return undefined;
};

type DeviceIdentityVerificationMode = 'opportunistic' | 'required';
type DeviceIdentityVerificationPlan = {
  mode: DeviceIdentityVerificationMode;
  cleanupRustStoresOnFailure: boolean;
};

const getDeviceIdentityVerificationPlan = async (
  session: ClientBootstrapSession
): Promise<DeviceIdentityVerificationPlan> => {
  const cryptoStoreExists = await inspectCryptoStoreContinuity(session);
  if (cryptoStoreExists === true) {
    // Existing stores remain usable offline. When online, still compare their
    // identity with the server so a replacement by another broken client is
    // detected rather than silently producing undecryptable traffic.
    return { mode: 'opportunistic', cleanupRustStoresOnFailure: false };
  }
  if (cryptoStoreExists === false && hasInitializedCryptoStore(session.sessionId)) {
    throw new MissingCryptoStoreError(session.userId);
  }

  // A genuinely new login has no local store and no server keys. An existing
  // login whose store disappeared has server keys which must match the local
  // identity before startClient can upload anything.
  return {
    mode: 'required',
    // Only delete databases when the preflight conclusively established that
    // Rust crypto is creating them now. An indeterminate preflight can still
    // represent an existing store in a browser that denies DB enumeration.
    cleanupRustStoresOnFailure: cryptoStoreExists === false,
  };
};

type DeviceKeysQueryResponse = {
  device_keys?: Record<
    string,
    Record<
      string,
      {
        keys?: Record<string, string>;
      }
    >
  >;
};

const verifyDeviceIdentity = async (
  mx: MatrixClient,
  session: ClientBootstrapSession
): Promise<void> => {
  let body: DeviceKeysQueryResponse;
  try {
    body = await mx.http.authedRequest<DeviceKeysQueryResponse>(
      Method.Post,
      '/keys/query',
      undefined,
      {
        device_keys: {
          [session.userId]: [session.deviceId],
        },
      }
    );
  } catch {
    throw new DeviceIdentityVerificationError(session.userId);
  }

  const serverKeys = body.device_keys?.[session.userId]?.[session.deviceId]?.keys;
  if (!serverKeys) return;

  const serverEd25519 = serverKeys[`ed25519:${session.deviceId}`];
  const serverCurve25519 = serverKeys[`curve25519:${session.deviceId}`];
  if (!serverEd25519 || !serverCurve25519) {
    throw new DeviceIdentityVerificationError(session.userId);
  }

  const crypto = mx.getCrypto();
  if (!crypto) throw new DeviceIdentityVerificationError(session.userId);
  let localKeys;
  try {
    localKeys = await crypto.getOwnDeviceKeys();
  } catch {
    throw new DeviceIdentityVerificationError(session.userId);
  }
  if (!localKeys?.ed25519 || !localKeys.curve25519) {
    throw new DeviceIdentityVerificationError(session.userId);
  }
  if (serverEd25519 !== localKeys.ed25519 || serverCurve25519 !== localKeys.curve25519) {
    throw new DeviceIdentityMismatchError(session.userId);
  }
};

export const initClient = async (session: ClientBootstrapSession): Promise<MatrixClient> => {
  const identityVerification = await getDeviceIdentityVerificationPlan(session);
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
    ? createSessionTokenRefresh({
        sessionId: session.sessionId,
        refresh: (refreshToken) => refreshClient.refreshToken(refreshToken),
      })
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

  const shouldVerifyIdentity =
    identityVerification.mode === 'required' ||
    (identityVerification.mode === 'opportunistic' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === true);
  if (shouldVerifyIdentity) {
    try {
      await verifyDeviceIdentity(mx, session);
    } catch (error) {
      const canUseKnownLocalStore =
        identityVerification.mode === 'opportunistic' &&
        error instanceof DeviceIdentityVerificationError;
      if (!canUseKnownLocalStore) {
        await Promise.allSettled([
          Promise.resolve().then(() => mx.stopClient()),
          indexedDBStore.destroy(),
        ]);
        if (identityVerification.cleanupRustStoresOnFailure) {
          // stopClient closes the Rust IndexedDB handles. Delete only stores
          // proven absent before this attempt so a failed verification cannot
          // turn freshly generated, untrusted keys into an "existing" store on
          // retry. Cleanup failure must not mask the original identity error.
          await Promise.allSettled([deleteNamedDatabases(getSessionRustCryptoStoreNames(session))]);
        }
        throw error;
      }
    }
  }
  markCryptoStoreInitialized(session.sessionId);

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

const deleteSessionLocalData = async (
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

// Removes the session from the registry then runs local-data teardown,
// wrapped in the legacy-storage finalizer the SDK expects after any
// credential-store mutation. Deriving `clearUserScopedState` from the
// post-removal registry keeps shared-MXID sessions (e.g. same account on a
// different base URL) from losing per-user UI state.
const removeSessionRecordAndLocalData = async (
  session: SessionCleanupContext,
  mx?: MatrixClient
): Promise<void> => {
  const nextStore = removeSession(session.sessionId);
  try {
    await deleteSessionLocalData(
      session,
      mx,
      !nextStore.sessions.some((storedSession) => storedSession.userId === session.userId)
    );
  } finally {
    clearLegacySessionStorage();
  }
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
  await removeSessionRecordAndLocalData(session);
  window.location.reload();
};

export const removeCurrentClientSessionAndReload = async (
  mx: MatrixClient,
  candidate?: SessionCleanupContext
): Promise<void> => {
  const session = getMatrixClientSessionCleanupContext(mx, candidate);
  stopClientRuntime(mx);

  if (session) {
    await removeSessionRecordAndLocalData(session, mx);
    window.location.reload();
    return;
  }

  // Fallback when the client has no deviceId and no candidate matches: fall
  // back to the identity derived from the live client and skip the per-
  // session cache/native teardown that requires a full SessionCleanupContext.
  const identity = getMatrixClientSessionIdentity(mx);
  const nextStore = removeSession(identity.sessionId);
  const clearUserScopedState = !nextStore.sessions.some(
    (storedSession) => storedSession.userId === identity.userId
  );
  try {
    await clearMatrixClientStores(mx);
    clearSessionScopedUiState(identity, clearUserScopedState);
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

  await removeSessionRecordAndLocalData(session);
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
    clearAppOwnedCacheLocalStorage();
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
