import { type ICreateClientOpts, type MatrixClient } from 'matrix-js-sdk';
import { Method } from 'matrix-js-sdk/lib/http-api';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';

import { createMatrixClient } from '../../matrix/client/matrixClientFactory';
import {
  installEventContentGuard,
  trustAgentsOfViewer,
} from '../../matrix/protocol/untrustedContent';
import { removeSessionAndReload, removeStoredSession } from './sessionLifecycle';
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
  getRecordedDeviceIdentityKey,
  hasInitializedCryptoStore,
  markCryptoStoreInitialized,
} from '../../matrix/session/sessions';
import { createStoredSessionTokenRefresh } from '../../matrix/client/sessionTokenRefresh';
import { cryptoCallbacks } from '../../matrix/client/secretStorageKeys';
import { renewExpiredCloudflareAccess } from '../../native/cloudflareAccess';
import { keepEveryReceiptInSavedSync } from '../../matrix/client/savedSyncReceipts';
import { restoreStreamingRepliesFromCache } from '../../event-store/sdk/restoredStreamingReplies';

// Account removal, logout and cache clearing live in sessionLifecycle.ts; the two below first log
// a stored session's device out on the homeserver.

/** A client of `session` without stores or sync, for requests in its name. */
export const createSessionRequestClient = (session: ClientBootstrapSession): MatrixClient =>
  createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenRefreshFunction: createStoredSessionTokenRefresh(session),
    userId: session.userId,
    deviceId: session.deviceId,
  });

/** The homeserver logs the session's device out and drops the keys it keeps for it. */
const logoutOnServer = async (session: ClientBootstrapSession): Promise<void> => {
  const mx = createSessionRequestClient(session);
  // A logout that cannot pass Cloudflare Access leaves the device on the server.
  await renewExpiredCloudflareAccess(session.baseUrl);
  try {
    await mx.logout(true);
  } catch {
    // The server may already have dropped this device; local cleanup still runs.
  }
};

/**
 * Ends a session whose encryption keys this browser lost, then opens `nextHref`: the homeserver
 * logs the device out (and drops the keys it keeps for it), and this browser forgets the account
 * and deletes its stores by name, without opening them. Other accounts stay.
 */
export const logoutSessionWithoutStores = async (
  session: ClientBootstrapSession,
  nextHref: string
): Promise<void> => {
  await logoutOnServer(session);
  await removeSessionAndReload(session, undefined, nextHref);
};

/**
 * Logs out an account that is not the active one, as Logout does for the active one: the
 * homeserver logs its device out, and this browser forgets the account and deletes its stores.
 * The active account goes on.
 */
export const logoutStoredSession = async (session: StoredSession): Promise<void> => {
  await logoutOnServer(session);
  await removeStoredSession(session);
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

/**
 * The libolm-era crypto store that `initRustCrypto` migrates from. The SDK asks whether it holds
 * data by opening it, which creates an empty database, and then deletes that again. Another tab of
 * the account starting at that moment could open the short-lived database and lose its connection
 * to the deletion, and then failed to start ("The database connection is closing"). Listing the
 * databases answers without creating one; a browser that cannot list them still asks the SDK.
 */
class LegacyCryptoStore extends IndexedDBCryptoStore {
  private readonly factory: IDBFactory;

  private readonly databaseName: string;

  constructor(factory: IDBFactory, databaseName: string) {
    super(factory, databaseName);
    this.factory = factory;
    this.databaseName = databaseName;
  }

  override async containsData(): Promise<boolean> {
    try {
      const databases = await this.factory.databases();
      return databases.some(({ name }) => name === this.databaseName);
    } catch {
      return super.containsData();
    }
  }
}

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

const safeRecordedDeviceIdentityKey = (sessionId: string): string | undefined => {
  try {
    return getRecordedDeviceIdentityKey(sessionId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[initMatrix] could not read the device identity key', describeError(error));
    return undefined;
  }
};

const safeMarkCryptoStoreInitialized = (sessionId: string, deviceIdentityKey: string): void => {
  try {
    markCryptoStoreInitialized(sessionId, deviceIdentityKey);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[initMatrix] could not record the crypto store mark', describeError(error));
  }
};

/** Stops a client whose stores are opening or open, and closes its sync store. */
const abandonClient = async (mx: MatrixClient, store: SyncArchiveStore): Promise<void> => {
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
};

type DeviceKeysQueryResponse = {
  device_keys?: Record<string, Record<string, { keys?: Record<string, string> }>>;
};

// A first start after an update waits at most this long for the homeserver's answer.
const IDENTITY_CHECK_TIMEOUT_MS = 10_000;

/** The ed25519 key the homeserver holds for the session's device; undefined when it has none. */
const serverDeviceIdentityKey = async (
  mx: MatrixClient,
  { userId, deviceId }: ClientBootstrapSession
): Promise<string | undefined> => {
  const body = await mx.http.authedRequest<DeviceKeysQueryResponse>(
    Method.Post,
    '/keys/query',
    undefined,
    { device_keys: { [userId]: [deviceId] } },
    { localTimeoutMs: IDENTITY_CHECK_TIMEOUT_MS }
  );
  return body.device_keys?.[userId]?.[deviceId]?.keys?.[`ed25519:${deviceId}`];
};

/**
 * Whether the Rust store that just opened is the device's own: the store can vanish between the
 * existence check and its opening (a deletion that waited for another tab to close it, or one
 * made while the page unloaded), and the Rust machine then makes new keys for the device. The key
 * recorded the last time decides. A store this browser marked before it recorded keys is
 * compared with the homeserver's key once (that also finds sessions an earlier version already
 * gave new keys); when the homeserver cannot answer, the start goes on unrecorded.
 */
const openedOwnStore = async (
  mx: MatrixClient,
  session: ClientBootstrapSession,
  storeExisted: boolean
): Promise<boolean> => {
  const ownKeys = await mx.getCrypto()?.getOwnDeviceKeys();
  if (!ownKeys) throw new DeviceIdentityVerificationError(session.userId);
  const recorded = safeRecordedDeviceIdentityKey(session.sessionId);
  if (recorded !== undefined) return recorded === ownKeys.ed25519;
  // A missing store was only created after the homeserver said it has no keys for the device.
  if (storeExisted && safeHasInitializedCryptoStore(session.sessionId)) {
    let serverKey: string | undefined;
    try {
      serverKey = await serverDeviceIdentityKey(mx, session);
    } catch {
      return true;
    }
    if (serverKey !== undefined && serverKey !== ownKeys.ed25519) return false;
  }
  safeMarkCryptoStoreInitialized(session.sessionId, ownKeys.ed25519);
  return true;
};

/**
 * Creates the Matrix client for a stored session and opens its stores, without syncing.
 *
 * The device's encryption keys live in its Rust crypto store. A missing store must not be
 * recreated for a device the homeserver already knows: that would give the device new keys and
 * make its messages unreadable to others. So a missing store is only created after the
 * homeserver confirms it has no keys for the device; otherwise startup stops with
 * MissingCryptoStoreError, or DeviceIdentityVerificationError when that cannot be checked. A store
 * that opens with other keys than the device's (it vanished after the check) stops startup the
 * same way, before the client syncs or uploads a key.
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
  // Before the store starts: starting replays the receipts it saved.
  keepEveryReceiptInSavedSync();
  const store: SyncArchiveStore = new IndexedDBStore({
    indexedDB: globalThis.indexedDB,
    localStorage: globalThis.localStorage,
    dbName: storeNames.sync,
  });
  const legacyCryptoStore = new LegacyCryptoStore(globalThis.indexedDB, storeNames.crypto);

  const { userId, deviceId } = session;
  // Every event's content is read through the shape and trust checks, with this account's agents.
  installEventContentGuard();
  trustAgentsOfViewer(userId);
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
  // settle before tearing the half-started runtime down. Streaming replies the saved sync holds
  // are read from the event cache meanwhile, so the rooms first show their newest saved text.
  const results = await Promise.allSettled([
    store.startup().then(() => restoreStreamingRepliesFromCache(mx)),
    mx.initRustCrypto({ cryptoDatabasePrefix: getSessionRustCryptoStorePrefix(session) }),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) {
    await abandonClient(mx, store);
    throw failure.reason;
  }

  let ownStore: boolean;
  try {
    ownStore = await openedOwnStore(mx, session, continuity);
  } catch (error) {
    await abandonClient(mx, store);
    throw error;
  }
  if (!ownStore) {
    await abandonClient(mx, store);
    throw new MissingCryptoStoreError(session.userId);
  }

  mx.setMaxListeners(MAX_CLIENT_LISTENERS);
  return mx;
};
