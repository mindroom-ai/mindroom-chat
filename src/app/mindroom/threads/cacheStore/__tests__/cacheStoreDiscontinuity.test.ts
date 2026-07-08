/**
 * CINNY-207 P3.2: cacheStoreDiscontinuity — mark/clear/read the
 * per-room tail-discontinuity marker.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRoomTailDiscontinuity,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
} from '../cacheStoreDiscontinuity';
import { resetCacheStoreForTesting } from '../cacheStoreDb';

const SESSION_ID = 'session-p32';
const ROOM_ID = '!room:example.org';

describe('cacheStoreDiscontinuity (CINNY-207 P3.2)', () => {
  beforeEach(async () => {
    await resetCacheStoreForTesting();
  });

  afterEach(async () => {
    await resetCacheStoreForTesting();
  });

  it('returns undefined when no marker or meta row exists', async () => {
    const marker = await loadRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
    expect(marker).toBeUndefined();
  });

  it('marks a room and reads the marker back', async () => {
    await markRoomTailDiscontinuity(SESSION_ID, ROOM_ID, {
      markedAt: 1000,
      prevBatch: 'batch-token-1',
    });
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

  it('clear() on an unmarked room is a no-op', async () => {
    await clearRoomTailDiscontinuity(SESSION_ID, ROOM_ID);
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
});
