import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as store from '../index';

const session = 'media-eviction';
const save = (id: string, roomId: string) =>
  store.putCachedAttachment(
    session,
    {
      mxcUri: `mxc://test/${id}`,
      bytes: new ArrayBuffer(2000),
      mimeType: 'image/png',
    },
    { roomId }
  );
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store.resetCacheStoreForTesting();
  store.__resetEvictionForTests();
});
afterEach(() => {
  store.__setCacheStoreByteBudgetForTests(undefined);
  vi.restoreAllMocks();
});

it('reclaims oldest optional attachments, preserving recent and focused rooms and text', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
  await save('old', 'room-old');
  await save('new', 'room-new');
  await save('recent', 'room-recent');
  await save('focused', 'room-focused');
  await store.noteRoomOpened(session, 'room-recent');
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(7000);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual(['mxc://test/old']);
  expect(result.bytesAfter).toBe(6000);
  expect(await store.readRoomAttachmentStorage(session, 'room-old')).toMatchObject({
    missing: 1,
    saved: 0,
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/recent')).toBeDefined();
  expect(await store.loadCachedAttachment(session, 'mxc://test/focused')).toBeDefined();
});

it('reports pressure without deleting message history when no media is reclaimable', async () => {
  await store.saveRoomEventsToCacheCommitted(session, 'room-text', [
    {
      event_id: '$text',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { body: 'retained message' },
    },
  ]);
  store.__setCacheStoreByteBudgetForTests(1);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result).toMatchObject({ underPressure: true, evictedMxcUris: [] });
  expect(await store.loadCachedRoomEvent(session, 'room-text', '$text')).toMatchObject({
    content: { body: 'retained message' },
  });
});

it('admits under-budget work without reading raw blobs, references or protection metadata', async () => {
  await save('cached', 'room-a');
  const rawCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
  expect(rawCursor).not.toHaveBeenCalled();
  expect(all.mock.contexts.map((context) => context.name)).toEqual(['room_ledger']);
});
