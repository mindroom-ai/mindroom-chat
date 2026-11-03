import { type ICreateClientOpts, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';

import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import { LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT } from '../app/mindroom/matrix/clientSyncPolicy';
import {
  type ClientBootstrapSession,
  inspectCryptoStoreContinuity,
  serverHasDeviceIdentity,
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../app/mindroom/matrix/cryptoStoreContinuity';
import {
  getSessionRustCryptoStorePrefix,
  getSessionStoreName,
  hasInitializedCryptoStore,
  markCryptoStoreInitialized,
} from '../app/state/sessions';
import { createStoredSessionTokenRefresh } from './sessionTokenRefresh';
import { cryptoCallbacks } from './secretStorageKeys';

// Account removal, logout and cache clearing live in the MindRoom session lifecycle module;
// this module is the startup orchestrator and re-exports them for the app shell.
export {
  clearAllCacheAndReload,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  removeStoredSession,
} from '../app/mindroom/matrix/sessionLifecycle';
export { DeviceIdentityVerificationError, MissingCryptoStoreError };
// How the client syncs is the MindRoom sync policy's; the app shell starts the client from here.
export {
  LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT,
  STARTUP_SYNC_TIMELINE_LIMIT,
  startClient,
} from '../app/mindroom/matrix/clientSyncPolicy';

const MAX_CLIENT_LISTENERS = 50;

type SyncArchiveStore = IndexedDBStore & {
  backend?: { syncAccumulator?: { opts?: { maxTimelineEntries?: number } } };
};

// The local IndexedDB backend trims each room's saved timeline to its accumulator's limit.
const raiseSyncArchiveTimelineLimit = (store: SyncArchiveStore): void => {
  const opts = store.backend?.syncAccumulator?.opts;
  if (!opts) return;
  opts.maxTimelineEntries = Math.max(
    opts.maxTimelineEntries ?? 0,
    LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT
  );
};

// Failures here are logged, never thrown: the mark only guards against recreating a lost store.
const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const safeHasInitializedCryptoStore = (sessionId: string): boolean => {
  try {
    return hasInitializedCryptoStore(sessionId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[initMatrix] could not read the crypto store mark', describeError(error));
    return false;
  }
};

const safeMarkCryptoStoreInitialized = (sessionId: string): void => {
  try {
    markCryptoStoreInitialized(sessionId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[initMatrix] could not record the crypto store mark', describeError(error));
  }
};

/**
 * Creates the Matrix client for a stored session and opens its stores, without syncing.
 *
 * The device's encryption keys live in its Rust crypto store. A missing store must not be
 * recreated for a device the homeserver already knows: that would give the device new keys and
 * make its messages unreadable to others. So a missing store is only created after the
 * homeserver confirms it has no keys for the device; otherwise startup stops with
 * MissingCryptoStoreError, or DeviceIdentityVerificationError when that cannot be checked.
 */
export const initClient = async (session: ClientBootstrapSession): Promise<MatrixClient> => {
  const continuity = await inspectCryptoStoreContinuity(session);
  if (continuity === undefined) throw new DeviceIdentityVerificationError(session.userId);
  if (!continuity && safeHasInitializedCryptoStore(session.sessionId)) {
    throw new MissingCryptoStoreError(session.userId);
  }

  const tokenRefreshFunction = createStoredSessionTokenRefresh(session);
  // The SDK store names; IndexedDB databases get the SDK's own prefix on top.
  const storeNames = getSessionStoreName(session);
  const store: SyncArchiveStore = new IndexedDBStore({
    indexedDB: globalThis.indexedDB,
    localStorage: globalThis.localStorage,
    dbName: storeNames.sync,
  });
  const legacyCryptoStore = new IndexedDBCryptoStore(globalThis.indexedDB, storeNames.crypto);

  const { userId, deviceId } = session;
  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenRefreshFunction,
    userId,
    deviceId,
    store,
    cryptoStore: legacyCryptoStore,
    // The JavaScript cache answers `undefined` for an unknown key, which the SDK treats as none.
    cryptoCallbacks: cryptoCallbacks as unknown as CryptoCallbacks,
    timelineSupport: true,
    threadSupport: true,
    verificationMethods: ['m.sas.v1'],
  } as ICreateClientOpts & { threadSupport: boolean });

  if (!continuity && (await serverHasDeviceIdentity(mx, session))) {
    throw new MissingCryptoStoreError(session.userId);
  }

  raiseSyncArchiveTimelineLimit(store);

  // Both open IndexedDB databases; run them together, and on failure wait for the other to
  // settle before tearing the half-started runtime down.
  const results = await Promise.allSettled([
    store.startup(),
    mx.initRustCrypto({ cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session) }),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) {
    try {
      mx.stopClient();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[initMatrix] could not stop the half-started client', describeError(error));
    }
    await Promise.resolve(store.destroy?.()).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[initMatrix] could not close the sync store', describeError(error));
    });
    throw failure.reason;
  }

  safeMarkCryptoStoreInitialized(session.sessionId);
  mx.setMaxListeners(MAX_CLIENT_LISTENERS);
  return mx;
};
