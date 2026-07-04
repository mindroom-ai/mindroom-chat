import { MINDROOM_EDIT_DEBUG_STORAGE_KEY } from '../messages/editDebug';
import { clearMindroomLongTextHydrationCache } from '../messages/longText';
import { IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX, clearIOSPushState } from '../native/iosPush';
import { clearRecentThreadsPanelHeightStore } from '../recent-threads/recentThreadsPanelHeight';
import { clearRecentThreadsPanelMobileExpandedStore } from '../recent-threads/recentThreadsPanelMobileExpanded';
import { clearRecentThreadsStore } from '../recent-threads/recentThreads';
import { clearCrossRoomThreadFiltersStore } from '../cross-room-threads/crossRoomThreadFilters';
import { clearLastOpenThreadStore } from '../threads/lastOpenThread';
import { clearRecentThreadViewModelSharedState } from '../threads/recentThreadViewModel';
import { clearRoomThreadFiltersStore } from '../threads/roomThreadFilterState';
import {
  MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  deleteRoomEventCache,
  getRoomEventCacheDbName,
} from '../threads/roomEventCache';
import {
  MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  deleteThreadEventCache,
  getThreadEventCacheDbName,
} from '../threads/threadEventCache';
import {
  deleteThreadSummaryCache,
  getThreadSummaryCacheDbName,
} from '../threads/threadSummaryStore';
import {
  MINDROOM_CACHE_DB_BASE_NAME,
  deleteCacheStoreDb,
  getCacheStoreDbName,
} from '../threads/cacheStore';

// CINNY-207 P2.1 (decision D8): the legacy singleton names REMAIN
// listed here — after the D8 wipe on first v3 open they should already
// be gone, but keeping the delete gesture makes logout cleanup robust
// on installs that never opened the v3 DB (e.g. rolled-back binaries).
// The unified `mindroom-cache` name is added alongside.
export const MINDROOM_SINGLETON_INDEXED_DB_NAMES = [
  MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  MINDROOM_CACHE_DB_BASE_NAME,
] as const;

export const MINDROOM_OWNED_LOCAL_STORAGE_KEYS = [MINDROOM_EDIT_DEBUG_STORAGE_KEY] as const;
export const MINDROOM_OWNED_LOCAL_STORAGE_PREFIXES = [IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX] as const;

export const getMindroomSessionIndexedDbNames = (sessionId: string): string[] => [
  getThreadEventCacheDbName(sessionId),
  getRoomEventCacheDbName(sessionId),
  getThreadSummaryCacheDbName(sessionId),
  getCacheStoreDbName(sessionId),
];

export const deleteMindroomSessionCaches = async (sessionId: string): Promise<void> => {
  await Promise.all([
    deleteThreadEventCache(sessionId),
    deleteRoomEventCache(sessionId),
    deleteThreadSummaryCache(sessionId),
    deleteCacheStoreDb(sessionId),
  ]);
};

export const clearMindroomSessionUiState = (userId: string): void => {
  clearLastOpenThreadStore(userId);
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
