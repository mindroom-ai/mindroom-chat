import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheStoreMetaUnavailableError } from '../cacheStoreMeta';
import {
  cachedHistoryJoinsBefore,
  holdUnsavedRoomCacheGap,
  loadRoomCacheGap,
  whenRoomCacheGapsSaved,
} from '../cacheStoreGap';
import {
  deleteCacheStoreDb,
  loadLatestCachedRoomEvents,
  saveRoomEventsToCacheCommitted,
} from '../index';

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

describe('whenRoomCacheGapsSaved', () => {
  const SESSION_ID = 'cache-gap-session';
  const ROOM_ID = '!gap:example.org';

  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
  });

  it('settles at once for a room without an unsaved hole', async () => {
    await expect(whenRoomCacheGapsSaved(SESSION_ID, ROOM_ID)).resolves.toBeUndefined();
  });

  it('saves no room event before every hole of the room has its marker', async () => {
    const releaseFirst = holdUnsavedRoomCacheGap(SESSION_ID, ROOM_ID);
    const releaseSecond = holdUnsavedRoomCacheGap(SESSION_ID, ROOM_ID);
    let saved = false;
    const save = saveRoomEventsToCacheCommitted(SESSION_ID, ROOM_ID, [
      {
        event_id: '$after-gap',
        origin_server_ts: 10,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: { body: 'after the gap' },
      },
    ]).then((result) => {
      saved = result;
    });

    releaseFirst();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(saved).toBe(false);
    expect((await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10)).events).toEqual([]);

    releaseSecond();
    await save;
    expect(saved).toBe(true);
    expect(
      (await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10)).events.map(
        (event) => event.event_id
      )
    ).toEqual(['$after-gap']);
  });
});
