import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { deleteRoomEventCache, getRoomEventCacheDbName } from '../threads/roomEventCache';
import { deleteThreadEventCache, getThreadEventCacheDbName } from '../threads/threadEventCache';
import {
  deleteThreadSummaryCache,
  getThreadSummaryCacheDbName,
} from '../threads/threadSummaryStore';
import { deleteCacheStoreDb, getCacheStoreDbName } from '../threads/cacheStore';
import {
  MINDROOM_OWNED_LOCAL_STORAGE_KEYS,
  MINDROOM_OWNED_LOCAL_STORAGE_PREFIXES,
  MINDROOM_SINGLETON_INDEXED_DB_NAMES,
  clearMindroomInMemoryCaches,
  clearMindroomSessionNativeState,
  clearMindroomSessionUiState,
  deleteMindroomSessionCaches,
  getMindroomSessionIndexedDbNames,
} from './sessionCleanup';

vi.mock('../messages/longText', () => ({
  clearMindroomLongTextHydrationCache: vi.fn(),
}));

vi.mock('../native/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

vi.mock('../recent-threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
}));

vi.mock('../cross-room-threads/crossRoomThreadFilters', () => ({
  clearCrossRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../threads/lastOpenThread', () => ({
  clearLastOpenThreadStore: vi.fn(),
}));

vi.mock('../recent-threads/recentThreadsPanelHeight', () => ({
  clearRecentThreadsPanelHeightStore: vi.fn(),
}));

vi.mock('../recent-threads/recentThreadsPanelMobileExpanded', () => ({
  clearRecentThreadsPanelMobileExpandedStore: vi.fn(),
}));

vi.mock('../threads/recentThreadViewModel', () => ({
  clearRecentThreadViewModelSharedState: vi.fn(),
}));

vi.mock('../threads/roomThreadFilterState', () => ({
  clearRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../threads/roomEventCache', () => ({
  MINDROOM_ROOM_EVENT_CACHE_DB_NAME: 'mindroom-room-event-cache',
  deleteRoomEventCache: vi.fn().mockResolvedValue(undefined),
  getRoomEventCacheDbName: vi.fn((sessionId: string) => `room-cache::${sessionId}`),
}));

vi.mock('../threads/threadEventCache', () => ({
  MINDROOM_THREAD_EVENT_CACHE_DB_NAME: 'mindroom-thread-event-cache',
  deleteThreadEventCache: vi.fn().mockResolvedValue(undefined),
  getThreadEventCacheDbName: vi.fn((sessionId: string) => `thread-cache::${sessionId}`),
}));

vi.mock('../threads/threadSummaryStore', () => ({
  deleteThreadSummaryCache: vi.fn().mockResolvedValue(undefined),
  getThreadSummaryCacheDbName: vi.fn((sessionId: string) => `summary-cache::${sessionId}`),
}));

vi.mock('../threads/cacheStore', () => ({
  MINDROOM_CACHE_DB_BASE_NAME: 'mindroom-cache',
  deleteCacheStoreDb: vi.fn().mockResolvedValue(undefined),
  getCacheStoreDbName: vi.fn((sessionId: string) => `mindroom-cache::${sessionId}`),
}));

describe('MindRoom session cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes MindRoom-owned app cleanup keys from one boundary', () => {
    // CINNY-207 P2.1 (D8): legacy singleton names are RETAINED here so
    // logout cleanup keeps working on installs that never opened v3
    // (e.g. rolled-back binaries); the unified `mindroom-cache` name is
    // listed alongside.
    expect(MINDROOM_SINGLETON_INDEXED_DB_NAMES).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
      'mindroom-cache',
    ]);
    expect(MINDROOM_OWNED_LOCAL_STORAGE_KEYS).toEqual([MINDROOM_EDIT_DEBUG_STORAGE_KEY]);
    expect(MINDROOM_OWNED_LOCAL_STORAGE_PREFIXES).toEqual([IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX]);
  });

  it('derives session-scoped MindRoom IndexedDB names', () => {
    expect(getMindroomSessionIndexedDbNames('session-a')).toEqual([
      'thread-cache::session-a',
      'room-cache::session-a',
      'summary-cache::session-a',
      'mindroom-cache::session-a',
    ]);
    expect(vi.mocked(getThreadEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getRoomEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getThreadSummaryCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getCacheStoreDbName)).toHaveBeenCalledWith('session-a');
  });

  it('deletes all MindRoom session caches together', async () => {
    await deleteMindroomSessionCaches('session-a');

    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith('session-a');
  });

  it('clears MindRoom UI, native, and in-memory state', () => {
    clearMindroomSessionUiState('@alice:example.com');
    clearMindroomSessionNativeState('session-a');
    clearMindroomInMemoryCaches();

    expect(vi.mocked(clearLastOpenThreadStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearCrossRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentThreadsPanelHeightStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearRecentThreadsPanelMobileExpandedStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearRecentThreadViewModelSharedState)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearMindroomLongTextHydrationCache)).toHaveBeenCalledTimes(1);
  });
});
