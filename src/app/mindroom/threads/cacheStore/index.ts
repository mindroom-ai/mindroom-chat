// CINNY-207 P2.1: barrel for the unified CacheStore module. The legacy
// per-domain files (`roomEventCache.ts`, `threadEventCache.ts`,
// `threadSummaryCache.ts`) become pure re-export shims over this module
// in commit 4 of the P2.1 stack.

export {
  MINDROOM_CACHE_DB_BASE_NAME,
  CACHE_STORE_DB_VERSION,
  CACHE_BYTE_BUDGET_BYTES,
  getCacheStoreByteBudget,
  __setCacheStoreByteBudgetForTests,
  buildEventCacheKey,
  buildMetaKey,
  buildSummaryCacheKey,
  estimateRawEventBytes,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_STORE,
  EVENTS_BY_SCOPE_TS_INDEX,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  ROOM_SCOPE,
  INTERNAL_META_ROOM_ID,
  LEGACY_WIPE_MARKER_META_KEY,
  type CachedEventRecord,
  type CachedMetaRecord,
  type CachedRoomLedgerRecord,
  type CachedThreadSummaryRecord,
} from './cacheStoreSchema';

export {
  getCacheStoreDbName,
  deleteCacheStoreDb,
  openCacheStore,
  resetCacheStoreForTesting,
  getOpenCacheStoreDbPromise,
  setLegacyWipeHook,
  __setLegacyWipeHookForTests,
} from './cacheStoreDb';

export {
  filterPageableCachedThreadEvents,
  getCachedThreadSummaryInfoFromRawEvent,
  getRoomCursorAnchor,
  getThreadCursorAnchor,
  mergeThreadCacheFlag,
  normalizeCachedRoomEvents,
  normalizeCachedThreadEvents,
  normalizeExpectedReplyCount,
  type CachedRoomEvent,
  type CachedThreadEvent,
  type CursorAnchor,
} from './cacheStoreNormalize';

export {
  deleteRoomEventsFromCache,
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore,
  loadCachedThreadPaginationToken,
  loadLatestCachedRoomEvents,
  loadLatestCachedThreadEvents,
  loadLatestCachedThreadSummaryInfo,
  noteRoomOpened,
  noteThreadOpened,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
  type CachedRoomEventPage,
  type CachedThreadEventPage,
} from './cacheStoreEvents';

export { readLedgerSnapshot } from './cacheStoreLedger';

export {
  loadCachedThreadSummaries,
  saveCachedThreadSummary,
} from './cacheStoreSummaries';

export {
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME,
  LEGACY_MINDROOM_SINGLETON_DB_NAMES,
  getLegacyRoomEventCacheDbName,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
  getLegacySessionScopedCacheDbNames,
} from './legacyCacheDbNames';
