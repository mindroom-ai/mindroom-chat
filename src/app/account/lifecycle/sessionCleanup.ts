import { clearLongTextHydrationCache } from '../../matrix/protocol/longText';
import { clearAttachmentRepositoryMemory } from '../../event-store/cache/attachmentRepository';
import { clearRoomInputDrafts } from '../../composer/roomInputDrafts';
import { clearUnsentMessages } from '../../matrix/client/unsentMessages';
import { clearSavedVoiceDraft } from '../../composer/voice/savedVoiceDraft';
import { clearIOSPushState } from '../../notifications/push/iosPush';
import { clearRecentThreadsStore } from '../../event-store/threads/recentThreads';
import { clearRecentlyOpenedPanelHeightStore } from '../../preferences/recentlyOpenedPanelHeight';
import { clearCallWindowStore } from '../../calls/window/callWindowState';
import { clearThreadSidebarPreferencesStore } from '../../threads/cross-room/threadSidebarPreferences';
import { clearCrossRoomThreadFiltersStore } from '../../threads/cross-room/crossRoomThreadFilters';
import { clearRoomThreadFiltersStore } from '../../threads/overview/roomThreadFilterState';
import { clearRoomViewModeStore } from '../../navigation/roomViewMode';
import { clearThreadSummarySharedState } from '../../event-store/threads/threadSummaryState';
import { getSafeLocalStorage, removeStorageItemSafe } from '../../lib/safeLocalStorage';
import { clearSeenThreadRoots } from '../../matrix/seenThreadRoots';
import { clearClosedNavCategoriesStore } from '../../ui/nav/closedNavCategories';
import { clearSyncFilterIds } from '../../matrix/client/clientSyncPolicy';
import { clearNotified } from '../../notifications/notifiedOnce';
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
  revokeAllCacheStoreWrites,
} from '../../event-store/cache/db';

// ISSUE-207 P2.1 (decision D8) / P2.3: the legacy singleton names REMAIN
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

export const getSessionIndexedDbNames = (sessionId: string): string[] => [
  getLegacyThreadEventCacheDbName(sessionId),
  getLegacyRoomEventCacheDbName(sessionId),
  getLegacyThreadSummaryCacheDbName(sessionId),
  getCacheStoreDbName(sessionId),
];

const deleteLegacyCacheDb = (dbName: string): Promise<void> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }

    try {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });

export const deleteSessionCaches = async (sessionId: string): Promise<void> => {
  // Delete the unified DB plus each legacy per-session DB name. The
  // three-way legacy split collapsed to a single unified DB in P2.1;
  // enumerating the legacy names here is the logout-cleanup fallback
  // for installs that never opened v3.
  const legacyNames = getLegacySessionScopedCacheDbNames(sessionId);
  await Promise.allSettled([
    Promise.resolve().then(() => deleteCacheStoreDb(sessionId)),
    ...legacyNames.map(deleteLegacyCacheDb),
  ]);
};

// The last-open-thread auto-restore feature was removed; its per-user
// localStorage key may still exist on installs that ran older builds.
const LEGACY_LAST_OPEN_THREAD_STORE_PREFIX = 'lastOpenThread';

export const clearUserUiState = (userId: string): void => {
  clearRoomInputDrafts(userId);
  clearUnsentMessages(userId);
  void clearSavedVoiceDraft(userId);
  removeStorageItemSafe(getSafeLocalStorage(), `${LEGACY_LAST_OPEN_THREAD_STORE_PREFIX}${userId}`);
  clearRoomThreadFiltersStore(userId);
  clearCrossRoomThreadFiltersStore(userId);
  clearRecentThreadsStore(userId);
  clearRecentlyOpenedPanelHeightStore(userId);
  clearCallWindowStore(userId);
  clearThreadSidebarPreferencesStore(userId);
  clearSeenThreadRoots(userId);
  clearClosedNavCategoriesStore(userId);
  clearSyncFilterIds(userId);
  clearNotified(userId);
};

export const clearSessionUiState = (sessionId: string): void => {
  clearRoomViewModeStore(sessionId);
  clearThreadSummarySharedState(sessionId);
};

export const clearSessionNativeState = (sessionId: string): void => {
  clearIOSPushState(sessionId);
};

export const clearInMemoryCaches = (): void => {
  revokeAllCacheStoreWrites();
  clearAttachmentRepositoryMemory();
  clearLongTextHydrationCache();
};
