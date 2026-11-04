import { Filter, MatrixClient, type IStartClientOpts } from 'matrix-js-sdk';
import { buildFeatureSupportMap, Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { readCachedSpecVersions } from '../../state/cachedSpecVersions';
import { keepThreadReplyCounts } from './threadReplyCounts';

// How the client syncs. The startup orchestrator (src/client/initMatrix.ts) creates the client
// and its stores and then calls `startClient` here; this module does not import it.

/** Timeline events per room in a /sync response: enough for previews and the first screen. */
export const STARTUP_SYNC_TIMELINE_LIMIT = 20;

/**
 * Timeline events per room the IndexedDB sync store keeps between sessions, so a reload shows
 * recent history without asking the server.
 */
export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 500;

/** Room ephemeral events to receive: typing, receipts and MindRoom's live reply frames. */
export const SYNC_EPHEMERAL_TYPES = ['m.typing', 'm.receipt', 'io.mindroom.live'];

type ServerVersionsClient = MatrixClient & { serverVersionsPromise?: Promise<unknown> };

/**
 * Hands the SDK the `/versions` answer this account cached last time, so starting does not wait
 * for the request and works offline. The SDK asks the server again later on its own.
 */
export const seedCachedServerVersions = async (mx: MatrixClient): Promise<void> => {
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
export const buildSyncFilter = (mx: MatrixClient): Filter => {
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

const countedClients = new WeakSet<MatrixClient>();

/** Starts syncing: bounded timelines, lazy-loaded members, threads and live reply frames. */
export const startClient = async (
  mx: MatrixClient,
  options: Partial<IStartClientOpts> = {}
): Promise<void> => {
  await seedCachedServerVersions(mx);
  // Before the saved sync is replayed, which brings thread roots together with their replies.
  // Only an SDK client has rooms whose threads count replies.
  if (mx instanceof MatrixClient && !countedClients.has(mx)) {
    countedClients.add(mx);
    keepThreadReplyCounts(mx);
  }
  const policy: Partial<IStartClientOpts> = {
    threadSupport: true,
    lazyLoadMembers: true,
    initialSyncLimit: STARTUP_SYNC_TIMELINE_LIMIT,
    filter: buildSyncFilter(mx),
  };
  await mx.startClient({ ...policy, ...options });
};
