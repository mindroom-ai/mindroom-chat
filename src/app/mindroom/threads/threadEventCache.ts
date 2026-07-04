// CINNY-207 P2.1: this module is now a pure re-export shim over the
// unified `cacheStore` module. The DB-per-domain implementation was
// consolidated into a single schema-v3 IndexedDB with a shared
// scoped-cursor core (see `./cacheStore/`). The legacy DB name string
// `mindroom-thread-event-cache` is retained (re-exported from
// `legacyCacheDbNames`) for logout cleanup on installs that never
// opened v3, and for the P2.1/D8 wipe list.
//
// Direct imports of this file are supported for compatibility only. New
// callers should import from `./cacheStore` (or through the arch-guarded
// `eventRepository.ts` seam). Phase 2.3 flips remaining direct callers
// off the shims and Phase 7 deletes them entirely.
//
// Behavior contract preserved by the shim flip is pinned by the
// parameterized suite in `./cacheStore/__tests__/cacheContract.test.ts`.

export { LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME as MINDROOM_THREAD_EVENT_CACHE_DB_NAME } from './cacheStore/legacyCacheDbNames';
export { getLegacyThreadEventCacheDbName as getThreadEventCacheDbName } from './cacheStore/legacyCacheDbNames';

export {
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  filterPageableCachedThreadEvents,
  getCachedThreadSummaryInfoFromRawEvent,
  getThreadCursorAnchor,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore,
  loadCachedThreadPaginationToken,
  loadLatestCachedThreadEvents,
  loadLatestCachedThreadSummaryInfo,
  mergeThreadCacheFlag,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from './cacheStore';

import { deleteCacheStoreDb } from './cacheStore';

/**
 * Legacy delete-cache API. See the note in `roomEventCache.ts` — the
 * two DBs share a lifecycle in practice, so collapsing the delete to a
 * single `deleteCacheStoreDb` call has no observable effect on callers.
 */
export const deleteThreadEventCache = (sessionId: string): Promise<void> =>
  deleteCacheStoreDb(sessionId);
