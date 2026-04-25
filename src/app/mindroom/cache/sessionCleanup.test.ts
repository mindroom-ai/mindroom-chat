import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMindroomLongTextHydrationCache } from '../../components/message/mindroomLongText';
import { MINDROOM_EDIT_DEBUG_STORAGE_KEY } from '../messages/editDebug';
import { IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX, clearIOSPushState } from '../native/iosPush';
import { clearRecentThreadsPanelHeightStore } from '../recent-threads/recentThreadsPanelHeight';
import { clearRecentThreadsPanelMobileExpandedStore } from '../recent-threads/recentThreadsPanelMobileExpanded';
import { clearRecentThreadsStore } from '../recent-threads/recentThreads';
import { clearRecentThreadViewModelSharedState } from '../threads/recentThreadViewModel';
import { clearRoomThreadFiltersStore } from '../threads/roomThreadFilterState';
import { deleteRoomEventCache, getRoomEventCacheDbName } from '../threads/roomEventCache';
import { deleteThreadEventCache, getThreadEventCacheDbName } from '../threads/threadEventCache';
import { deleteThreadSummaryCache } from '../threads/threadSummaryCache';
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

vi.mock('../../components/message/mindroomLongText', () => ({
  clearMindroomLongTextHydrationCache: vi.fn(),
}));

vi.mock('../native/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

vi.mock('../recent-threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
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

vi.mock('../threads/threadSummaryCache', () => ({
  deleteThreadSummaryCache: vi.fn().mockResolvedValue(undefined),
}));

describe('MindRoom session cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes MindRoom-owned app cleanup keys from one boundary', () => {
    expect(MINDROOM_SINGLETON_INDEXED_DB_NAMES).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
    ]);
    expect(MINDROOM_OWNED_LOCAL_STORAGE_KEYS).toEqual([MINDROOM_EDIT_DEBUG_STORAGE_KEY]);
    expect(MINDROOM_OWNED_LOCAL_STORAGE_PREFIXES).toEqual([IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX]);
  });

  it('derives session-scoped MindRoom IndexedDB names', () => {
    expect(getMindroomSessionIndexedDbNames('session-a')).toEqual([
      'thread-cache::session-a',
      'room-cache::session-a',
    ]);
    expect(vi.mocked(getThreadEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getRoomEventCacheDbName)).toHaveBeenCalledWith('session-a');
  });

  it('deletes all MindRoom session caches together', async () => {
    await deleteMindroomSessionCaches('session-a');

    expect(vi.mocked(deleteThreadEventCache)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(deleteRoomEventCache)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(deleteThreadSummaryCache)).toHaveBeenCalledWith('session-a');
  });

  it('clears MindRoom UI, native, and in-memory state', () => {
    clearMindroomSessionUiState('@alice:example.com');
    clearMindroomSessionNativeState('session-a');
    clearMindroomInMemoryCaches();

    expect(vi.mocked(clearRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
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
