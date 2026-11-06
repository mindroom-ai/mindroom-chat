import { describe, expect, it } from 'vitest';
import { CacheStoreMetaUnavailableError } from '../cacheStoreMeta';
import {
  cachedHistoryJoinsBefore,
  holdUnsavedRoomCacheGap,
  loadRoomCacheGap,
} from '../cacheStoreGap';

const noMarker = async () => undefined;

describe('loadRoomCacheGap', () => {
  it('finds no hole in a room without a marker', async () => {
    expect(await loadRoomCacheGap('session', '!whole', noMarker)).toBeUndefined();
  });

  it('knows the events from before the hole from the durable marker', async () => {
    const gap = await loadRoomCacheGap('session', '!gap', async () => ({
      markedAt: 1,
      overlapEventIds: ['$before-1', '$before-2'],
    }));
    expect([...(gap?.beforeGapEventIds ?? [])]).toEqual(['$before-1', '$before-2']);
  });

  it('treats a marker without a boundary or an unreadable marker as a hole with unknown sides', async () => {
    const withoutBoundary = await loadRoomCacheGap('session', '!gap', async () => ({
      markedAt: 1,
    }));
    const unreadable = await loadRoomCacheGap('session', '!gap', async () => {
      throw new Error('blocked');
    });
    expect(withoutBoundary?.beforeGapEventIds.size).toBe(0);
    expect(unreadable?.beforeGapEventIds.size).toBe(0);
  });

  it('finds no hole without IndexedDB, where nothing is cached', async () => {
    const gap = await loadRoomCacheGap('session', '!gap', async () => {
      throw new CacheStoreMetaUnavailableError();
    });
    expect(gap).toBeUndefined();
  });

  it('holds a hole whose marker is not saved yet until every hold is released', async () => {
    const releaseFirst = holdUnsavedRoomCacheGap('session', '!unsaved');
    const releaseSecond = holdUnsavedRoomCacheGap('session', '!unsaved');
    expect(await loadRoomCacheGap('session', '!unsaved', noMarker)).toBeDefined();
    expect(await loadRoomCacheGap('other-session', '!unsaved', noMarker)).toBeUndefined();

    releaseFirst();
    releaseFirst();
    expect(await loadRoomCacheGap('session', '!unsaved', noMarker)).toBeDefined();
    releaseSecond();
    expect(await loadRoomCacheGap('session', '!unsaved', noMarker)).toBeUndefined();
  });
});

describe('cachedHistoryJoinsBefore', () => {
  const gap = { beforeGapEventIds: new Set(['$before']) };

  it('lets cached history continue any event of a room without a hole', () => {
    expect(cachedHistoryJoinsBefore(undefined, '$any')).toBe(true);
  });

  it('lets cached history continue only events from before the hole', () => {
    expect(cachedHistoryJoinsBefore(gap, '$before')).toBe(true);
    expect(cachedHistoryJoinsBefore(gap, '$after')).toBe(false);
    expect(cachedHistoryJoinsBefore(gap, undefined)).toBe(false);
  });
});
