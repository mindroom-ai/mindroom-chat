import { Filter, MatrixClient, type IStartClientOpts } from 'matrix-js-sdk';
import { buildFeatureSupportMap, Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { readCachedSpecVersions } from '../cachedSpecVersions';
import { keepUnthreadedReceiptEvents } from '../receiptReadTs';
import { getSafeLocalStorage, removeStorageItemSafe } from '../../lib/safeLocalStorage';
import { dropRoomsForgottenElsewhere } from './roomsForgottenElsewhere';
import { keepBundledEditsInTheirRoom } from './bundledEditRoom';
import { keepNewerEditsOnMappedCopies } from './mappedCopyEdits';
import { keepRedactionsInSavedSync } from './savedSyncRedactions';
import { keepThreadReplyCounts } from './threadReplyCounts';
import { relistThreadsAfterGaps } from './threadListGaps';
import { keepUnopenedThreadEditsShown } from './unopenedThreadEdits';
import { keepStreamingRepliesChecked } from './streamingReplies';
import { keepEncryptedRoomCounts } from './encryptedRoomCounts';
import { keepSyncedEdits } from './syncedEdits';
import { keepUnsentMessages } from './unsentMessages';

// How the client syncs. The startup orchestrator (src/app/account/lifecycle/initMatrix.ts) creates
// the client and its stores; the app shell (src/app/shell/ClientRoot.tsx) then calls `startClient`
// here. This module imports neither.

/** Timeline events per room in a /sync response: enough for previews and the first screen. */
export const STARTUP_SYNC_TIMELINE_LIMIT = 20;

/**
 * Timeline events per room the IndexedDB sync store keeps between sessions, so a reload shows
 * recent history without asking the server.
 */
export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 500;

/** Room ephemeral events to receive: typing, receipts and MindRoom's live reply frames. */
const SYNC_EPHEMERAL_TYPES = ['m.typing', 'm.receipt', 'io.mindroom.live'];

type ServerVersionsClient = MatrixClient & { serverVersionsPromise?: Promise<unknown> };

/**
 * Hands the SDK the `/versions` answer this account cached last time, so starting does not wait
 * for the request and works offline. The SDK asks the server again later on its own.
 */
const seedCachedServerVersions = async (mx: MatrixClient): Promise<void> => {
  const userId = mx.getUserId();
  const client = mx as ServerVersionsClient;
  if (!userId || client.serverVersionsPromise) return;
  const cached = readCachedSpecVersions(mx.baseUrl, userId);
  if (!cached) return;
  const versions = { versions: cached.versions, unstable_features: cached.unstable_features ?? {} };
  client.serverVersionsPromise = Promise.resolve(versions);
  mx.canSupport = await buildFeatureSupportMap(versions);
};

/** The sync filter: short timelines, lazy-loaded members, the ephemeral events above. */
const buildSyncFilter = (mx: MatrixClient): Filter => {
  const filter = new Filter(mx.getUserId());
  filter.setDefinition({
    room: {
      timeline: { limit: STARTUP_SYNC_TIMELINE_LIMIT },
      state: { lazy_load_members: true },
      ephemeral: { types: SYNC_EPHEMERAL_TYPES },
    },
  });
  // Per-thread unread counts, unless the server says it cannot send them.
  if (mx.canSupport?.get(Feature.ThreadUnreadNotifications) !== ServerSupport.Unsupported) {
    filter.setUnreadThreadNotifications(true);
  }
  return filter;
};

/**
 * Forgets the IDs of an account's sync filters, which the SDK keeps in localStorage under the
 * account's Matrix ID, for when the account leaves this browser.
 */
export const clearSyncFilterIds = (userId: string): void => {
  const storage = getSafeLocalStorage();
  [`FILTER_SYNC_${userId}`, `FILTER_SYNC_${userId}_LEFT_ROOMS`].forEach((filterName) =>
    removeStorageItemSafe(storage, `mxjssdk_memory_filter_${filterName}`)
  );
};

const countedClients = new WeakSet<MatrixClient>();

/** Starts syncing: bounded timelines, lazy-loaded members, threads and live reply frames. */
export const startClient = async (
  mx: MatrixClient,
  options: Partial<IStartClientOpts> = {}
): Promise<void> => {
  await seedCachedServerVersions(mx);
  // Before the saved sync is replayed, which brings thread roots together with their replies
  // and edits, bundled ones among them. Only an SDK client has rooms whose threads count replies
  // and hold edits. A deleted message is saved at once, so the next replay does not bring it back.
  // Messages the last page left unsent come back as Not sent rows once the rooms are known.
  if (mx instanceof MatrixClient && !countedClients.has(mx)) {
    countedClients.add(mx);
    keepBundledEditsInTheirRoom(mx);
    keepNewerEditsOnMappedCopies(mx);
    keepThreadReplyCounts(mx);
    keepUnopenedThreadEditsShown(mx);
    keepStreamingRepliesChecked(mx);
    relistThreadsAfterGaps(mx);
    keepRedactionsInSavedSync(mx);
    dropRoomsForgottenElsewhere(mx);
    keepSyncedEdits(mx);
    keepUnthreadedReceiptEvents(mx);
    keepEncryptedRoomCounts(mx);
    keepUnsentMessages(mx);
  }
  const policy: Partial<IStartClientOpts> = {
    threadSupport: true,
    lazyLoadMembers: true,
    initialSyncLimit: STARTUP_SYNC_TIMELINE_LIMIT,
    filter: buildSyncFilter(mx),
  };
  await mx.startClient({ ...policy, ...options });
};
