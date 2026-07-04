// CINNY-207 P2.1: this module is now a pure re-export shim over the
// unified `cacheStore` module. The DB-per-domain implementation was
// consolidated into a single schema-v3 IndexedDB (see `./cacheStore/`).
// The legacy DB name string `mindroom-thread-summary-cache` is retained
// (re-exported from `legacyCacheDbNames`) for logout cleanup on
// installs that never opened v3, and for the P2.1/D8 wipe list.
//
// Direct imports of this file are supported for compatibility only. New
// callers should import from `./cacheStore` (or via `./threadSummaryStore`,
// which is the thread summary state facade). Phase 2.3 flips remaining
// direct callers off the shims and Phase 7 deletes them entirely.

export { LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME as MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME } from './cacheStore/legacyCacheDbNames';
export { getLegacyThreadSummaryCacheDbName as getThreadSummaryCacheDbName } from './cacheStore/legacyCacheDbNames';

export {
  loadCachedThreadSummaries,
  saveCachedThreadSummary,
} from './cacheStore';

import { deleteCacheStoreDb } from './cacheStore';

/**
 * Legacy delete-cache API. See the note in `roomEventCache.ts` — all
 * three legacy DBs shared a lifecycle in practice, so collapsing the
 * delete to a single `deleteCacheStoreDb` call has no observable
 * effect on callers.
 */
export const deleteThreadSummaryCache = (sessionId: string): Promise<void> =>
  deleteCacheStoreDb(sessionId);
