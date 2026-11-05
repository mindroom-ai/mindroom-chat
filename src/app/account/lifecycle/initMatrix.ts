import { type ICreateClientOpts, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';

import { createMatrixClient } from '../../matrix/client/matrixClientFactory';
import * as sessionLifecycle from './sessionLifecycle';
import { clearFetchedAvatars } from '../../avatars/user-avatar/avatarMedia';
import { LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT } from '../../matrix/client/clientSyncPolicy';
import {
  type ClientBootstrapSession,
  inspectCryptoStoreContinuity,
  serverHasDeviceIdentity,
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../../matrix/client/cryptoStoreContinuity';
import {
  type StoredSession,
  getSessionRustCryptoStorePrefix,
  getSessionStoreName,
  hasInitializedCryptoStore,
  markCryptoStoreInitialized,
} from '../../matrix/session/sessions';
import { createStoredSessionTokenRefresh } from '../../matrix/client/sessionTokenRefresh';
import { cryptoCallbacks } from '../../matrix/client/secretStorageKeys';

// Account removal, logout and cache clearing live in sessionLifecycle.ts. The three below end an
// account's session and also drop the avatars that account fetched (avatarMedia keeps them per
// account), so callers take them from here.

// The account a client signed in as, or undefined when it has none (then every avatar goes).
const accountOf = (mx: MatrixClient): string | undefined => {
  try {
    return mx.getSafeUserId();
  } catch {
    return undefined;
  }
};

export const logoutClient = async (mx: MatrixClient): Promise<void> => {
  const userId = accountOf(mx);
  try {
    await sessionLifecycle.logoutClient(mx);
  } finally {
    clearFetchedAvatars(userId);
  }
};

export const removeStoredSession = async (session: StoredSession): Promise<void> => {
  try {
    await sessionLifecycle.removeStoredSession(session);
  } finally {
    clearFetchedAvatars(session.userId);
  }
};

export const clearAllCacheAndReload = async (mx?: MatrixClient): Promise<void> => {
  clearFetchedAvatars();
  await sessionLifecycle.clearAllCacheAndReload(mx);
};

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
