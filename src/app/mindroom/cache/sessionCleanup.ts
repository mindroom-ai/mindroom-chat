import { MINDROOM_EDIT_DEBUG_STORAGE_KEY } from '../messages/editDebug';
import { clearMindroomLongTextHydrationCache } from '../messages/longText';
import { IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX, clearIOSPushState } from '../native/iosPush';
import { clearRecentThreadsPanelHeightStore } from '../recent-threads/recentThreadsPanelHeight';
import { clearRecentThreadsPanelMobileExpandedStore } from '../recent-threads/recentThreadsPanelMobileExpanded';
import { clearRecentThreadsStore } from '../recent-threads/recentThreads';
import { clearCrossRoomThreadFiltersStore } from '../cross-room-threads/crossRoomThreadFilters';
import { clearRecentThreadViewModelSharedState } from '../threads/recentThreadViewModel';
import { clearRoomThreadFiltersStore } from '../threads/roomThreadFilterState';
import {
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  MINDROOM_CACHE_DB_BASE_NAME,
  deleteCacheStoreDb,
  getCacheStoreDbName,
  getLegacyRoomEventCacheDbName,
  getLegacySessionScopedCacheDbNames,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
} from '../threads/cacheStore';

// CINNY-207 P2.1 (decision D8) / P2.3: the legacy singleton names REMAIN
// listed here — after the D8 wipe on first v3 open they should already
// be gone, but keeping the delete gesture makes logout cleanup robust
// on installs that never opened the v3 DB (e.g. rolled-back binaries).
// The unified `mindroom-cache` name is added alongside. The legacy
// per-session-scoped DBs (three-way split) are still enumerated so a
// rolled-back binary that never triggered the D8 wipe gets its
// per-session DBs deleted on logout too.
export const MINDROOM_SINGLETON_INDEXED_DB_NAMES = [
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  MINDROOM_CACHE_DB_BASE_NAME,
] as const;

export const MINDROOM_OWNED_LOCAL_STORAGE_KEYS = [MINDROOM_EDIT_DEBUG_STORAGE_KEY] as const;
export const MINDROOM_OWNED_LOCAL_STORAGE_PREFIXES = [IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX] as const;

export const getMindroomSessionIndexedDbNames = (sessionId: string): string[] => [
  getLegacyThreadEventCacheDbName(sessionId),
  getLegacyRoomEventCacheDbName(sessionId),
  getLegacyThreadSummaryCacheDbName(sessionId),
  getCacheStoreDbName(sessionId),
];

export const deleteMindroomSessionCaches = async (sessionId: string): Promise<void> => {
  // Delete the unified DB plus each legacy per-session DB name. The
  // three-way legacy split collapsed to a single unified DB in P2.1;
  // enumerating the legacy names here is the logout-cleanup fallback
  // for installs that never opened v3.
  const legacyNames = getLegacySessionScopedCacheDbNames(sessionId);
  await Promise.all([
    deleteCacheStoreDb(sessionId),
    ...legacyNames.map(
      (dbName) =>
        new Promise<void>((resolve) => {
          if (typeof indexedDB === 'undefined') {
            resolve();
            return;
          }
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })
    ),
  ]);
};


// The last-open-thread auto-restore feature was removed; its per-user
// localStorage key may still exist on installs that ran older builds.
const LEGACY_LAST_OPEN_THREAD_STORE_PREFIX = 'lastOpenThread';

export const clearMindroomSessionUiState = (userId: string): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`${LEGACY_LAST_OPEN_THREAD_STORE_PREFIX}${userId}`);
  }
  clearRoomThreadFiltersStore(userId);
  clearCrossRoomThreadFiltersStore(userId);
  clearRecentThreadsStore(userId);
  clearRecentThreadsPanelHeightStore(userId);
  clearRecentThreadsPanelMobileExpandedStore(userId);
  clearRecentThreadViewModelSharedState();
};

export const clearMindroomSessionNativeState = (sessionId: string): void => {
  clearIOSPushState(sessionId);
};

export const clearMindroomInMemoryCaches = (): void => {
  clearMindroomLongTextHydrationCache();
};
