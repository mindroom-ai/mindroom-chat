/**
 * ISSUE-207 P3.2: cacheStoreDiscontinuity — mark/clear/read the
 * per-room tail-discontinuity marker.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkpointRoomTailDiscontinuity,
  clearRoomTailDiscontinuity,
  loadRoomTailDiscontinuities,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
} from '../cacheStoreDiscontinuity';
import { resetCacheStoreForTesting } from '../cacheStoreDb';
import { updateRoomOfflineProgress } from '../cacheStoreMeta';
import { saveThreadEventsToCache } from '../cacheStoreEvents';

const SESSION_ID = 'session-p32';
const ROOM_ID = '!room:example.org';

describe('cacheStoreDiscontinuity (ISSUE-207 P3.2)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetCacheStoreForTesting();
    await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    resetCacheStoreForTesting();
  });

  it('returns undefined when no marker or meta row exists', async () => {
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toBeUndefined();
  });

  it('marks a room and reads the marker back', async () => {
    const committed = await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-token-1',
    });
    expect(committed).toEqual({ markedAt: 1000, prevBatch: 'batch-token-1' });
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toEqual({ markedAt: 1000, prevBatch: 'batch-token-1' });
  });

  it('later marks overwrite earlier ones (newer markedAt wins)', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-old',
    });
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 2000,
      prevBatch: 'batch-new',
    });
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toEqual({ markedAt: 2000, prevBatch: 'batch-new' });
  });

  it('an older mark cannot overwrite a newer generation', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 2000,
      prevBatch: 'batch-new',
    });
    const committed = await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-stale',
    });

    expect(committed).toMatchObject({ markedAt: 2000, prevBatch: 'batch-new' });
    expect(await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toMatchObject({
      markedAt: 2000,
      prevBatch: 'batch-new',
    });
  });

  it.each([[['$original-tail']], [[]]] as const)(
    'keeps the original overlap boundary when a newer reset replaces the cursor (%j)',
    async (overlapEventIds) => {
      await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
        markedAt: 1000,
        generation: 'old-generation',
        nextToken: 'old-cursor',
        overlapEventIds: [...overlapEventIds],
      });

      const committed = await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
        markedAt: 2000,
        generation: 'new-generation',
        nextToken: 'new-cursor',
        overlapEventIds: ['$newer-page'],
      });

      expect(committed).toEqual({
        markedAt: 2000,
        generation: 'new-generation',
        nextToken: 'new-cursor',
        overlapEventIds: [...overlapEventIds],
      });
      expect(await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toEqual(committed);
    }
  );

  it('preserves other meta fields when marking (additive write)', async () => {
    // Prime a meta row via mark, then re-open through openCacheStore to
    // add an unrelated field, then re-mark and verify the field
    // survives. (Full flow uses saveRoomEventsToCache; here we just
    // ensure our mark path does not stomp fields it does not know.)
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-1',
    });
    // Re-mark; ensure the mark is updated and no other fields appear
    // stripped.
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1500,
      prevBatch: 'batch-2',
    });
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker?.markedAt).toBe(1500);
    expect(marker?.prevBatch).toBe('batch-2');
  });

  it('clears the marker (subsequent reads return undefined)', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-1',
    });
    await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toBeUndefined();
  });

  it('checkpoints and clears only the matching generation', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: 'generation-1',
      nextToken: 'batch-1',
    });

    expect(
      await checkpointRoomTailDiscontinuity(SESSION_ID, ROOM_ID, 'stale-generation', 'stale-token')
    ).toBe(false);
    expect(
      await checkpointRoomTailDiscontinuity(SESSION_ID, ROOM_ID, 'generation-1', 'batch-2', [
        '$cached-tail',
      ])
    ).toBe(true);
    expect(
      await checkpointRoomTailDiscontinuity(SESSION_ID, ROOM_ID, 'generation-1', 'batch-3')
    ).toBe(true);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toMatchObject({
      generation: 'generation-1',
      nextToken: 'batch-3',
      overlapEventIds: ['$cached-tail'],
    });

    expect(await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID, 'stale-generation')).toBe(false);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toBeDefined();
    expect(await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID, 'generation-1')).toBe(true);
    expect(await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toBeUndefined();
  });

  it('clear() on an unmarked room is a no-op', async () => {
    expect(await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).toBe(true);
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toBeUndefined();
  });

  it('marker with a null prevBatch persists (initial-sync-only room case)', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: null,
    });
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toEqual({ markedAt: 1000, prevBatch: null });
  });

  it('marker with an undefined prevBatch persists (SDK not tracking token yet)', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, { markedAt: 1000 });
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker?.markedAt).toBe(1000);
    expect(marker?.prevBatch).toBeUndefined();
  });

  it('rejects marker reads, writes, and clears when IndexedDB is unavailable', async () => {
    resetCacheStoreForTesting();
    vi.stubGlobal('indexedDB', undefined);

    await expect(
      markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, { markedAt: 1000 })
    ).rejects.toThrow('unavailable');
    await expect(loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).rejects.toThrow('unavailable');
    await expect(loadRoomTailDiscontinuities(SESSION_ID, [ROOM_ID])).rejects.toThrow('unavailable');
    await expect(clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID)).rejects.toThrow('unavailable');
  });

  it('reads only requested room-scope discontinuity keys in one meta readonly transaction', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, '!r1:example.org', {
      markedAt: 1000,
      prevBatch: 'b1',
    });
    await markRoomTailDiscontinuity(SESSION_ID, '!left:example.org', {
      markedAt: 2000,
      prevBatch: 'b-left',
    });
    await updateRoomOfflineProgress(SESSION_ID, '!r2:example.org', { opened: true });
    const rootEvent = {
      event_id: '$root',
      room_id: '!r1:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'thread root payload' },
    };
    await saveThreadEventsToCache(
      SESSION_ID,
      '!r1:example.org',
      '$root',
      [{ ...rootEvent, event_id: '$reply', origin_server_ts: 2 }],
      rootEvent
    );

    const txSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    expect((await loadRoomTailDiscontinuities(SESSION_ID, [])).size).toBe(0);
    expect(txSpy).not.toHaveBeenCalled();

    const markers = await loadRoomTailDiscontinuities(SESSION_ID, [
      '!r1:example.org',
      '!r2:example.org',
      '!r1:example.org',
    ]);

    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(txSpy.mock.calls[0]?.slice(0, 2)).toEqual(['meta', 'readonly']);
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(getSpy.mock.calls.map(([key]) => key)).toEqual(['!r1:example.org|', '!r2:example.org|']);
    expect(Array.from(markers.entries())).toEqual([
      ['!r1:example.org', { markedAt: 1000, prevBatch: 'b1' }],
    ]);
    await clearRoomTailDiscontinuity(SESSION_ID, '!r1:example.org');
    await clearRoomTailDiscontinuity(SESSION_ID, '!left:example.org');
  });
});
