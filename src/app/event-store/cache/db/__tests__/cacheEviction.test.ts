import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as deepTrace from '../../../../diagnostics/deepTrace';
import { saveAttachmentOwner } from '../../__tests__/attachmentFixtures';
import { loadCachedScaledPicture, putCachedScaledPicture } from '../cacheStoreScaledPictures';
import {
  ATTACHMENTS_STORE,
  ATTACHMENT_BYTES_SUMMARY_KEY,
  EVICTION_PROTECTED_VERDICT_TTL_MS,
  type CachedAttachmentBytesSummaryRecord,
  type CachedAttachmentRecord,
} from '../cacheStoreSchema';
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

const saveText = (roomId: string, ts: number) =>
  store.saveRoomEventsToCacheCommitted(session, roomId, [
    {
      event_id: '$text',
      type: 'm.room.message',
      origin_server_ts: ts,
      content: { body: 'cached message' },
    },
  ]);
const hasText = async (roomId: string) =>
  (await store.loadCachedRoomEvent(session, roomId, '$text')) !== undefined;
/** Set a budget that one room's bytes, of `roomCount` equal rooms, brings back under. */
const budgetOverByHalfARoom = async (roomCount: number) => {
  const { bytesBefore } = await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(bytesBefore - bytesBefore / roomCount / 2);
};

it('evicts the least recently active unprotected rooms when media cannot free enough', async () => {
  await saveText('room-cold', 1);
  await saveText('room-warm', 2);
  await saveText('room-recent', 3);
  await saveText('room-focused', 4);
  await saveText('room-pinned', 5);
  await store.noteRoomOpened(session, 'room-recent');
  await store.setRoomAttachmentPinned(session, 'room-pinned', true);
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.markRoomTailDiscontinuity(session, 'room-cold', { markedAt: 1, prevBatch: 'gap' });
  await budgetOverByHalfARoom(5);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result).toMatchObject({ evictedRoomIds: ['room-cold'], underPressure: false });
  expect(await hasText('room-cold')).toBe(false);
  expect(await store.loadRoomTailDiscontinuity(session, 'room-cold')).toBeUndefined();
  for (const roomId of ['room-warm', 'room-recent', 'room-focused', 'room-pinned']) {
    // eslint-disable-next-line no-await-in-loop
    expect(await hasText(roomId)).toBe(true);
  }
});

it("frees an evicted room's essential bodies with its history", async () => {
  await saveText('room-cold', 1);
  await save('body', 'room-cold');
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/essential', bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
    { roomId: 'room-cold', essential: true }
  );
  await saveText('room-focused', 2);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(2000);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result).toMatchObject({ evictedRoomIds: ['room-cold'], underPressure: false });
  expect(await store.loadCachedAttachment(session, 'mxc://test/essential')).toBeUndefined();
  expect(await hasText('room-focused')).toBe(true);
});

it('reports pressure and keeps the text when protected rooms alone exceed the budget', async () => {
  await saveText('room-focused', 1);
  await saveText('room-recent', 2);
  await store.noteRoomOpened(session, 'room-recent');
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(trace).toHaveBeenCalledWith('storage.cache.eviction', {
    budget_bytes: 1,
    bytes_before: result.bytesBefore,
    bytes_after: result.bytesBefore,
    protected_bytes: result.bytesBefore,
    evicted_media: 0,
    evicted_rooms: 0,
    under_pressure: true,
  });
  expect(result).toMatchObject({ underPressure: true, evictedMxcUris: [], evictedRoomIds: [] });
  expect(await hasText('room-focused')).toBe(true);
  expect(await hasText('room-recent')).toBe(true);
});

it('evicts rooms never opened before rooms opened more than a day ago', async () => {
  await saveText('room-opened', 1);
  await saveText('room-busy', 2);
  const openedAt = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 25 * 60 * 60 * 1000);
  await store.noteRoomOpened(session, 'room-opened');
  openedAt.mockRestore();
  await budgetOverByHalfARoom(2);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-busy'],
  });
});

it('keeps a room focused while its protection is read', async () => {
  for (let index = 1; index <= 3; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  const getKey = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function getSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (this.name === 'room_ledger' && key === 'room-2')
      store.setEvictionProtectedRoomIds(['room-2']);
    return getKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-3']);
  expect(await hasText('room-2')).toBe(true);
});

it('keeps a room opened and left again while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    // Opening stamps the room; leaving it clears the focus registry again.
    if (key === 'room-1') void store.noteRoomOpened(session, 'room-4');
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('leaves unused rooms alone when protected text alone exceeds the budget', async () => {
  await saveText('room-cold', 1);
  await saveText('room-focused', 2);
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
  expect(await hasText('room-cold')).toBe(true);
});

it("leaves unused rooms alone when a protected room's media alone exceeds the budget", async () => {
  await saveText('room-cold', 1);
  await saveText('room-focused', 2);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/focused-body', bytes: new ArrayBuffer(4000), mimeType: 'text/plain' },
    { roomId: 'room-focused', essential: true }
  );
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(3000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
  expect(await hasText('room-cold')).toBe(true);
  expect(trace.mock.calls[0]?.[1]?.protected_bytes).toBeGreaterThan(4000);
});

it("counts an evicted room's attachment bytes toward the target", async () => {
  await saveText('room-a', 1);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/a-body', bytes: new ArrayBuffer(4000), mimeType: 'text/plain' },
    { roomId: 'room-a', essential: true }
  );
  await saveText('room-b', 2);
  const { bytesBefore } = await store.runCacheEvictionIfOverBudget(session);
  // Clearing room-a's text alone would not reach the target; its body does.
  store.__setCacheStoreByteBudgetForTests(bytesBefore - 2000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-a'],
    underPressure: false,
  });
  expect(await hasText('room-b')).toBe(true);
});

it('keeps a room focused while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    // The first room's ledger row goes; the user opens the last room meanwhile.
    if (key === 'room-1') store.setEvictionProtectedRoomIds(['room-4']);
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('keeps a room pinned while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (key === 'room-1') void store.setRoomAttachmentPinned(session, 'room-4', true);
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('evicts a room known only from its attachment references', async () => {
  // No cached event left, so the room has no ledger row.
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/orphan-body', bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
    { roomId: 'room-refs', essential: true }
  );
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-refs'],
    underPressure: false,
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/orphan-body')).toBeUndefined();
});

it("keeps a room's media when its download starts during the pass", async () => {
  await save('old', 'room-old');
  await save('new', 'room-new');
  store.__setCacheStoreByteBudgetForTests(3000);
  const getKey = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function getSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (key === 'mxc://test/old') store.setEvictionDownloadingRoomIds(session, ['room-old']);
    return getKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual(['mxc://test/new']);
  expect(await store.loadCachedAttachment(session, 'mxc://test/old')).toBeDefined();
});

it("keeps one session's download protection when another session updates its own", async () => {
  await saveText('room-a', 1);
  // Let the check the save scheduled settle under the default budget.
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionDownloadingRoomIds(session, ['room-a']);
  store.setEvictionDownloadingRoomIds('other-session', []);
  store.__setCacheStoreByteBudgetForTests(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
});

it('reads the total once more after freed bytes reach the target without attachment cursor scans', async () => {
  for (let index = 1; index <= 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toHaveLength(5);
  // Admission and one final total, not one total per room; only the media phase uses a cursor.
  expect(
    transaction.mock.calls.filter(
      ([stores, mode]) =>
        mode === 'readonly' &&
        Array.isArray(stores) &&
        stores.length === 2 &&
        stores.includes('attachments') &&
        stores.includes('room_ledger')
    )
  ).toHaveLength(2);
  expect(
    (keyCursor.mock.contexts as IDBIndex[]).filter(
      (index) => index.objectStore.name === 'attachments'
    )
  ).toHaveLength(1);
});

it('shares one pass between concurrent checks', async () => {
  await saveText('room-a', 1);
  await saveText('room-b', 2);
  await saveText('room-c', 3);
  await budgetOverByHalfARoom(3);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  const [first, second] = await Promise.all([
    store.runCacheEvictionIfOverBudget(session),
    store.runCacheEvictionIfOverBudget(session),
  ]);
  expect(second).toBe(first);
  expect(trace.mock.calls.filter(([name]) => name === 'storage.cache.eviction')).toHaveLength(1);
  expect(first.evictedRoomIds).toEqual(['room-a']);
  expect(await hasText('room-b')).toBe(true);
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
  expect((all.mock.contexts as IDBObjectStore[]).map((context) => context.name)).toEqual([
    'room_ledger',
  ]);
});

const evictionTraces = (trace: { mock: { calls: unknown[][] } }) =>
  trace.mock.calls.filter(([name]) => name === 'storage.cache.eviction');

it('caches a no-op protected-pressure verdict without touching IndexedDB or dropping on no-op updates', async () => {
  await saveText('room-focused', 1);
  await save('optional', 'room-cold');
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  const first = await store.runCacheEvictionIfOverBudget(session);
  expect(first).toMatchObject({
    underPressure: true,
    evictedMxcUris: ['mxc://test/optional'],
    evictedRoomIds: [],
  });
  expect(first.bytesBefore).toBeGreaterThan(first.bytesAfter);
  expect(evictionTraces(trace)).toHaveLength(1);

  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.setEvictionDownloadingRoomIds(session, []);
  const second = await store.runCacheEvictionIfOverBudget(session);
  expect(second).toEqual({
    bytesBefore: first.bytesAfter,
    bytesAfter: first.bytesAfter,
    evictedMxcUris: [],
    evictedRoomIds: [],
    underPressure: true,
  });
  expect(transaction).not.toHaveBeenCalled();
  expect(evictionTraces(trace)).toHaveLength(1);
});

it.each<[string, (advanceNow: (ms: number) => void) => Promise<void> | void]>([
  ['focus changes', () => store.setEvictionProtectedRoomIds([])],
  ['downloading rooms change', () => store.setEvictionDownloadingRoomIds(session, ['room-other'])],
  ['room pin changes', () => store.setRoomAttachmentPinned(session, 'room-pinned', false)],
  [
    'room cache is cleared',
    async () => {
      await store.clearRoomCachedContent(session, 'room-focused');
    },
  ],
  ['verdict TTL expires', (advanceNow) => advanceNow(1)],
  ['budget changes', () => store.__setCacheStoreByteBudgetForTests(2)],
])('reruns eviction after %s', async (_reason, trigger) => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await saveText('room-focused', 1);
  await saveText('room-pinned', 2);
  await store.runCacheEvictionIfOverBudget(session);
  await store.setRoomAttachmentPinned(session, 'room-pinned', true);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);

  now += EVICTION_PROTECTED_VERDICT_TTL_MS - 1;
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);

  await trigger((ms) => {
    now += ms;
  });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(2);
});

it('evicts once protection is lifted after a cached verdict', async () => {
  await saveText('room-focused', 1);
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    underPressure: true,
    evictedRoomIds: [],
  });
  store.setEvictionProtectedRoomIds([]);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    underPressure: false,
    evictedRoomIds: ['room-focused'],
  });
  expect(await hasText('room-focused')).toBe(false);
});

it('does not cache pressure that is not caused by protected bytes', async () => {
  await store.putCachedAttachment(
    session,
    {
      mxcUri: 'mxc://test/unowned-essential',
      bytes: new ArrayBuffer(2000),
      mimeType: 'text/plain',
    },
    { essential: true }
  );
  store.__setCacheStoreByteBudgetForTests(1000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(2);
});

it('drops a cached verdict when a redaction prunes protected attachment bytes', async () => {
  await saveAttachmentOwner(session, 'room-focused', '$photo', 1, [
    { mxcUri: 'mxc://test/protected', essential: false },
  ]);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/protected', bytes: new ArrayBuffer(2000), mimeType: 'image/png' },
    { roomId: 'room-focused', eventId: '$photo', revisionTs: 1 }
  );
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });

  await saveAttachmentOwner(session, 'room-focused', '$photo', 2, [], undefined, {
    redacted: true,
  });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: false });
  expect(await store.loadCachedAttachment(session, 'mxc://test/protected')).toBeUndefined();
});

it('keeps a cached verdict when pruning an uncached attachment reference', async () => {
  await save('protected', 'room-focused');
  await saveAttachmentOwner(session, 'room-focused', '$uncached', 1, [
    { mxcUri: 'mxc://test/uncached', essential: false },
  ]);
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);

  await saveAttachmentOwner(session, 'room-focused', '$uncached', 2, [], undefined, {
    redacted: true,
  });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);
});

it('drops a cached verdict when pruning removes a cached scaled picture', async () => {
  await saveAttachmentOwner(session, 'room-focused', '$scaled', 1, [
    { mxcUri: 'mxc://test/scaled', essential: false },
  ]);
  expect(
    await putCachedScaledPicture(
      session,
      { mxcUri: 'mxc://test/scaled', bytes: new ArrayBuffer(2000), mimeType: 'image/jpeg' },
      { roomId: 'room-focused', eventId: '$scaled', revisionTs: 1 }
    )
  ).toBe(true);
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });

  await saveAttachmentOwner(session, 'room-focused', '$scaled', 2, [], undefined, {
    redacted: true,
  });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: false });
  expect(await loadCachedScaledPicture(session, 'mxc://test/scaled')).toBeUndefined();
});

it('drops a cached verdict when pruning turns a cached essential attachment optional', async () => {
  await save('protected', 'room-focused');
  await saveAttachmentOwner(session, 'room-cold', '$essential', 1, [
    { mxcUri: 'mxc://test/shared', essential: true },
  ]);
  await saveAttachmentOwner(session, 'room-cold', '$optional', 1, [
    { mxcUri: 'mxc://test/shared', essential: false },
  ]);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/shared', bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
    { roomId: 'room-cold', eventId: '$essential', revisionTs: 1, essential: true }
  );
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    underPressure: true,
    evictedMxcUris: [],
  });
  expect(evictionTraces(trace)).toHaveLength(1);

  await saveAttachmentOwner(session, 'room-cold', '$essential', 2, [], undefined, {
    redacted: true,
  });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    underPressure: true,
    evictedMxcUris: ['mxc://test/shared'],
  });
  expect(evictionTraces(trace)).toHaveLength(2);
});

it('drops a cached verdict when redacting a large uncached-attachment caption brings ledger bytes under budget', async () => {
  await store.saveRoomEventsToCacheCommitted(
    session,
    'room-focused',
    [
      {
        event_id: '$captioned',
        room_id: 'room-focused',
        origin_server_ts: 1,
        sender: '@owner:test',
        type: 'm.room.message',
        content: { msgtype: 'm.image', body: 'x'.repeat(2000), url: 'mxc://test/uncached-caption' },
      },
    ],
    undefined,
    'partial',
    undefined,
    [
      {
        roomId: 'room-focused',
        eventId: '$captioned',
        revisionTs: 1,
        attachments: [
          { mxcUri: 'mxc://test/uncached-caption', essential: false, autoDownload: false },
        ],
      },
    ]
  );
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });

  await store.saveRoomEventsToCacheCommitted(session, 'room-focused', [
    {
      event_id: '$redact-captioned',
      room_id: 'room-focused',
      origin_server_ts: 2,
      sender: '@owner:test',
      type: 'm.room.redaction',
      redacts: '$captioned',
      content: {},
    },
  ]);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: false });
});

it('keeps a cached verdict when a small redaction leaves protected bytes well over budget', async () => {
  await save('protected-a', 'room-focused');
  await save('protected-b', 'room-focused');
  await store.saveRoomEventsToCacheCommitted(session, 'room-focused', [
    {
      event_id: '$small',
      room_id: 'room-focused',
      origin_server_ts: 1,
      sender: '@owner:test',
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'x'.repeat(200) },
    },
  ]);
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);

  await store.saveRoomEventsToCacheCommitted(session, 'room-focused', [
    {
      event_id: '$redact-small',
      room_id: 'room-focused',
      origin_server_ts: 2,
      sender: '@owner:test',
      type: 'm.room.redaction',
      redacts: '$small',
      content: {},
    },
  ]);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(evictionTraces(trace)).toHaveLength(1);
});

const attachmentKeyCursorCalls = (spy: { mock: { contexts: unknown[] } }) =>
  (spy.mock.contexts as IDBIndex[]).filter((index) => index.objectStore.name === 'attachments');

const seedRawAttachment = async (mxcUri: string, byteLength: number): Promise<void> => {
  const db = await store.openCacheStore(session);
  if (!db) throw new Error('cache store unavailable');
  await new Promise<void>((resolve, reject) => {
    const txn = db.transaction(ATTACHMENTS_STORE, 'readwrite');
    txn.objectStore(ATTACHMENTS_STORE).put({
      mxcUri,
      bytes: new ArrayBuffer(byteLength),
      mimeType: 'application/octet-stream',
      byteLength,
      essential: false,
      storedAt: 1,
      lastAccessedAt: 1,
    } satisfies CachedAttachmentRecord);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
};

it('admits repeated under-budget checks without rescanning attachments with a cursor', async () => {
  await save('a', 'room-a');
  await save('b', 'room-b');
  await saveAttachmentOwner(session, 'room-c', '$photo', 1, [
    { mxcUri: 'mxc://test/photo', essential: false },
  ]);
  await putCachedScaledPicture(
    session,
    { mxcUri: 'mxc://test/photo', bytes: new ArrayBuffer(1500), mimeType: 'image/jpeg' },
    { roomId: 'room-c', eventId: '$photo', revisionTs: 1 }
  );
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  const rawCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
  // First admission seeds the summary once; repeated checks and later puts avoid cursor scans.
  const first = await store.runCacheEvictionIfOverBudget(session);
  expect(first.underPressure).toBe(false);
  expect(first.bytesBefore).toBeGreaterThanOrEqual(5500);
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);

  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
      bytesBefore: first.bytesBefore,
      underPressure: false,
    });
  }
  await save('c', 'room-d');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: first.bytesBefore + 2000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);
  expect(rawCursor).not.toHaveBeenCalled();
});

it('seeds a persisted summary once for pre-existing rows and heals count mismatches', async () => {
  await seedRawAttachment('mxc://test/pre-1', 1200);
  await seedRawAttachment('mxc://test/pre-2', 800);
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ bytesBefore: 2000 });
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ bytesBefore: 2000 });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);

  await seedRawAttachment('mxc://test/pre-3', 500);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ bytesBefore: 2500 });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(2);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ bytesBefore: 2500 });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(2);
});

it('evicts accurately when adding bytes crosses budget or when the budget is lowered', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
  store.__setCacheStoreByteBudgetForTests(5000);
  await save('first', 'room-a');
  await save('second', 'room-b');
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 4000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);

  await save('third', 'room-c');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 6000,
    bytesAfter: 4000,
    evictedMxcUris: ['mxc://test/first'],
    underPressure: false,
  });
  const scansAfterFirstEviction = attachmentKeyCursorCalls(keyCursor).length;
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 4000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(scansAfterFirstEviction);

  store.__setCacheStoreByteBudgetForTests(3000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 4000,
    bytesAfter: 2000,
    evictedMxcUris: ['mxc://test/second'],
    underPressure: false,
  });
  const scansAfterSecondEviction = attachmentKeyCursorCalls(keyCursor).length;
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(scansAfterSecondEviction);
});

it('keeps summary accounting accurate across scaled overwrites, room clears, and redaction prunes', async () => {
  await saveAttachmentOwner(session, 'room-a', '$photo', 1, [
    { mxcUri: 'mxc://test/photo', essential: false },
  ]);
  const textOnly = (await store.runCacheEvictionIfOverBudget(session)).bytesBefore;
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/photo', bytes: new ArrayBuffer(2000), mimeType: 'image/png' },
    { roomId: 'room-a', eventId: '$photo', revisionTs: 1 }
  );
  await putCachedScaledPicture(
    session,
    { mxcUri: 'mxc://test/photo', bytes: new ArrayBuffer(1500), mimeType: 'image/jpeg' },
    { roomId: 'room-a', eventId: '$photo', revisionTs: 1 }
  );
  await putCachedScaledPicture(
    session,
    { mxcUri: 'mxc://test/photo', bytes: new ArrayBuffer(1800), mimeType: 'image/jpeg' },
    { roomId: 'room-a', eventId: '$photo', revisionTs: 1 }
  );
  await save('room-b-blob', 'room-b');
  await saveAttachmentOwner(session, 'room-b', '$missing', 1, [
    { mxcUri: 'mxc://test/never-saved', essential: false },
  ]);
  const roomBText =
    (await store.runCacheEvictionIfOverBudget(session)).bytesBefore - textOnly - 5800;

  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  expect(await store.clearRoomCachedContent(session, 'room-b')).toBe(2000 + roomBText);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: textOnly + 3800,
    underPressure: false,
  });
  await saveAttachmentOwner(session, 'room-a', '$photo', 2, [], undefined, { redacted: true });
  const afterRedact = await store.runCacheEvictionIfOverBudget(session);
  expect(afterRedact.bytesBefore).toBeLessThan(textOnly + 1000);
  expect(afterRedact.underPressure).toBe(false);
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(0);
});

it('returns the scanned total in one cursor walk when seeding the summary hits QuotaExceededError', async () => {
  await seedRawAttachment('mxc://test/quota-seed', 1500);
  const originalPut = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failSummary(
    this: IDBObjectStore,
    value,
    key
  ) {
    if (this.name === ATTACHMENTS_STORE)
      throw new DOMException('Storage full', 'QuotaExceededError');
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  });
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 1500,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(1);
});

it.each(['sync', 'async'] as const)(
  'frees room content when clearRoomCachedContent hits %s QuotaExceededError on summary put',
  async (mode) => {
    await saveText('room-a', 1);
    await save('a', 'room-a');
    await save('b', 'room-b');
    await store.runCacheEvictionIfOverBudget(session);

    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failQuota(
      this: IDBObjectStore,
      value: unknown,
      key
    ) {
      const mxcUri = (value as { mxcUri?: unknown } | null)?.mxcUri;
      if (this.name === ATTACHMENTS_STORE && mxcUri === ATTACHMENT_BYTES_SUMMARY_KEY) {
        if (mode === 'sync') throw new DOMException('Storage full', 'QuotaExceededError');
        // Trigger a real async IDBRequest error event on the existing summary key.
        const req = this.add(value);
        Object.defineProperty(req, 'error', {
          get: () => new DOMException('Storage full', 'QuotaExceededError'),
          set: () => undefined,
        });
        return req;
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    });
    const freed = await store.clearRoomCachedContent(session, 'room-a');
    putSpy.mockRestore();

    expect(freed).toBeGreaterThanOrEqual(2000);
    expect(await store.loadCachedAttachment(session, 'mxc://test/a')).toBeUndefined();
    expect(await hasText('room-a')).toBe(false);
    expect(await store.loadCachedAttachment(session, 'mxc://test/b')).toBeDefined();
    // The stale summary was deleted on quota failure, so the next check re-seeds accurately.
    expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
      bytesBefore: 2000,
      underPressure: false,
    });
  }
);

it('commits media eviction when reclaimOptionalMedia hits QuotaExceededError on summary put', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
  await save('old', 'room-a');
  await save('new', 'room-b');
  await store.runCacheEvictionIfOverBudget(session);

  const originalPut = IDBObjectStore.prototype.put;
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failSummary(
    this: IDBObjectStore,
    value: unknown,
    key
  ) {
    const mxcUri = (value as { mxcUri?: unknown } | null)?.mxcUri;
    if (this.name === ATTACHMENTS_STORE && mxcUri === ATTACHMENT_BYTES_SUMMARY_KEY) {
      throw new DOMException('Storage full', 'QuotaExceededError');
    }
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  });
  store.__setCacheStoreByteBudgetForTests(3000);
  const evicted = await store.runCacheEvictionIfOverBudget(session);
  putSpy.mockRestore();

  expect(evicted).toMatchObject({
    bytesBefore: 4000,
    bytesAfter: 2000,
    evictedMxcUris: ['mxc://test/old'],
    underPressure: false,
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/old')).toBeUndefined();
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
});

it('self-heals drifted summary bytes when reclaimOptionalMedia runs without evicting', async () => {
  await save('focused', 'room-focused');
  await store.runCacheEvictionIfOverBudget(session);
  const db = await store.openCacheStore(session);
  if (!db) throw new Error('cache store unavailable');
  await new Promise<void>((resolve, reject) => {
    const txn = db.transaction(ATTACHMENTS_STORE, 'readwrite');
    txn.objectStore(ATTACHMENTS_STORE).put({
      mxcUri: ATTACHMENT_BYTES_SUMMARY_KEY,
      totalBytes: 5000,
      count: 1,
    } satisfies CachedAttachmentBytesSummaryRecord);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedMxcUris: [],
    underPressure: true,
  });

  store.__setCacheStoreByteBudgetForTests(3000);
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
  expect(attachmentKeyCursorCalls(keyCursor)).toHaveLength(0);
});
