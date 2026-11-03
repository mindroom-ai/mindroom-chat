import {
  ClientEvent,
  Filter,
  type ICreateClientOpts,
  type IStartClientOpts,
  type MatrixClient,
} from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { Feature, ServerSupport, buildFeatureSupportMap } from 'matrix-js-sdk/lib/feature';

import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
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
import { readCachedSpecVersions } from '../app/state/cachedSpecVersions';
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

/** Timeline events per room in a /sync response: enough for previews and the first screen. */
export const STARTUP_SYNC_TIMELINE_LIMIT = 20;

/**
 * Timeline events per room the IndexedDB sync store keeps between sessions, so a reload shows
 * recent history without asking the server.
 */
export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 500;

/** Room ephemeral events to receive: typing, receipts and MindRoom's live reply frames. */
const SYNC_EPHEMERAL_TYPES = ['m.typing', 'm.receipt', 'io.mindroom.live'];

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

const safeHasInitializedCryptoStore = (sessionId: string): boolean => {
  try {
    return hasInitializedCryptoStore(sessionId);
  } catch {
    return false;
  }
};

const safeMarkCryptoStoreInitialized = (sessionId: string): void => {
  try {
    markCryptoStoreInitialized(sessionId);
  } catch {
    // The mark only guards against recreating a lost store; startup does not depend on it.
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

  const mx = createMatrixClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenRefreshFunction,








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
    } catch {
      // Already stopped.
    }
    await Promise.resolve(store.destroy?.()).catch(() => undefined);
    throw failure.reason;
  }

  safeMarkCryptoStoreInitialized(session.sessionId);
  mx.setMaxListeners(MAX_CLIENT_LISTENERS);
  return mx;
};

type VersionSeedableClient = MatrixClient & {
  serverVersionsPromise?: Promise<unknown>;
};

/**
 * Gives the SDK the `/versions` this account cached last time, so startup does not wait for the
 * request (and works offline). The SDK refreshes them later on its own schedule.
 */
const seedCachedServerVersions = async (mx: MatrixClient): Promise<void> => {
  const userId = mx.getUserId();
  if (!userId) return;
  const cached = readCachedSpecVersions(mx.baseUrl, userId);
  if (!cached) return;
  const client = mx as VersionSeedableClient;
  if (client.serverVersionsPromise) return;
  const versions = { versions: cached.versions, unstable_features: cached.unstable_features ?? {} };
  client.serverVersionsPromise = Promise.resolve(versions);
  client.canSupport = await buildFeatureSupportMap(versions);
};

const buildSyncFilter = (mx: MatrixClient): Filter => {
  const filter = new Filter(mx.getUserId());
  filter.setDefinition({
    room: {
      timeline: { limit: STARTUP_SYNC_TIMELINE_LIMIT },
      state: { lazy_load_members: true },
      ephemeral: { types: SYNC_EPHEMERAL_TYPES },
    },
  });
  if (mx.canSupport?.get(Feature.ThreadUnreadNotifications) !== ServerSupport.Unsupported) {
    filter.setUnreadThreadNotifications(true);
  }
  return filter;
};

const deferredParentFetch = (): Promise<never> =>
  Promise.reject(new Error('Relation parents are not fetched while the saved sync is replayed.'));

/**
 * The saved sync can hold a reaction or edit whose parent it does not hold. Replaying it, the
 * SDK would fetch each such parent and wait for the answer before showing any chat, so startup
 * hung while the network did. During the replay those fetches fail at once instead; the relation
 * is kept and applies when its parent arrives. Fetching resumes with the first sync state.
 */
const deferRelationParentFetchesDuringReplay = async (mx: MatrixClient): Promise<void> => {
  let savedSyncToken: string | null | undefined;
  try {
    savedSyncToken = await mx.store?.getSavedSyncToken?.();
  } catch {
    savedSyncToken = undefined;
  }
  if (!savedSyncToken) return;

  const client = mx as MatrixClient & { fetchRoomEvent: MatrixClient['fetchRoomEvent'] };
  const hadOwnFetch = Object.prototype.hasOwnProperty.call(client, 'fetchRoomEvent');
  const ownFetch = hadOwnFetch ? client.fetchRoomEvent : undefined;
  client.fetchRoomEvent = deferredParentFetch;
  mx.once(ClientEvent.Sync, () => {
    if (client.fetchRoomEvent !== deferredParentFetch) return;
    if (ownFetch) client.fetchRoomEvent = ownFetch;
    else delete (client as Partial<typeof client>).fetchRoomEvent;
  });
};

/** Starts syncing: bounded timelines, lazy-loaded members, threads and live reply frames. */
export const startClient = async (
  mx: MatrixClient,
  options: Partial<IStartClientOpts> = {}
): Promise<void> => {
  await seedCachedServerVersions(mx);
  await deferRelationParentFetchesDuringReplay(mx);



    initialSyncLimit: STARTUP_SYNC_TIMELINE_LIMIT,
    filter: buildSyncFilter(mx),
    ...options,
  });
};
