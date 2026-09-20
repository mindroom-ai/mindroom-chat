import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as store from '../index';

const session = 'retention';
const save = (mxcUri: string, roomId: string, essential = false) =>
  store.putCachedAttachment(
    session,
    {
      mxcUri,
      bytes: new Uint8Array(2000).buffer,
      mimeType: 'text/plain',
    },
    { roomId, essential }
  );

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store.resetCacheStoreForTesting();
  store.__resetEvictionForTests();
});
afterEach(() => store.__setCacheStoreByteBudgetForTests(undefined));

it('reclaims optional bytes while retaining room text and essential bodies', async () => {
  await store.saveRoomEventsToCacheCommitted(session, 'room-a', [
    {
      event_id: '$text',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { body: 'retained' },
    },
  ]);
  await save('mxc://test/body', 'room-a', true);
  await save('mxc://test/optional', 'room-b');
  store.__setCacheStoreByteBudgetForTests(3000);
  await store.runCacheEvictionIfOverBudget(session);
  expect(await store.loadCachedRoomEvent(session, 'room-a', '$text')).toMatchObject({
    content: { body: 'retained' },
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/body')).toBeDefined();
  expect(await store.loadCachedAttachment(session, 'mxc://test/optional')).toBeUndefined();
});

it('registers missing bodies and retires revisions without losing shared room bytes', async () => {
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$message', 1, [
    { mxcUri: 'mxc://test/body', essential: true },
  ]);
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    missingEssential: 1,
    saved: 0,
  });
  await save('mxc://test/body', 'room-a', true);
  await store.replaceCachedAttachmentReferences(session, 'room-b', '$other', 1, [
    { mxcUri: 'mxc://test/body', essential: true },
  ]);
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$message', 2, []);
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    missingEssential: 0,
    saved: 0,
  });
  await store.clearRoomCachedContent(session, 'room-a');
  expect(await store.loadCachedAttachment(session, 'mxc://test/body')).toBeDefined();
  await store.clearRoomCachedContent(session, 'room-b');
  expect(await store.loadCachedAttachment(session, 'mxc://test/body')).toBeUndefined();
});

it('protects pinned room media and reports pressure when nothing is reclaimable', async () => {
  await save('mxc://test/pinned', 'room-a');
  await store.setRoomAttachmentPinned(session, 'room-a', true);
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({ underPressure: true });
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    pinned: true,
    saved: 1,
    bytes: 2000,
  });
  await store.setRoomAttachmentPinned(session, 'room-a', false);
  await store.runCacheEvictionIfOverBudget(session);
  expect(await store.loadCachedAttachment(session, 'mxc://test/pinned')).toBeUndefined();
});

it('revokes room leases without canceling unrelated room writes', async () => {
  const lease = store.captureCacheStoreWriteLease(session, 'room-a');
  const other = store.captureCacheStoreWriteLease(session, 'room-b');
  await store.clearRoomCachedContent(session, 'room-a');
  const input = { mxcUri: 'mxc://test/late', bytes: new ArrayBuffer(1), mimeType: 'text/plain' };
  expect(
    await store.putCachedAttachment(session, input, { roomId: 'room-a', writeLease: lease })
  ).toBe('revoked');
  expect(
    await store.putCachedAttachment(session, input, { roomId: 'room-b', writeLease: other })
  ).toBe('committed');
});

it('preserves a room pin through event ledger updates', async () => {
  await store.setRoomAttachmentPinned(session, 'room-a', true);
  await store.saveRoomEventsToCacheCommitted(session, 'room-a', [
    { event_id: '$pinned', origin_server_ts: 1, type: 'm.room.message', content: { body: 'text' } },
  ]);
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({ pinned: true });
});

it('drops obsolete unshared streamed bodies and refuses their late writers', async () => {
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$stream', 1, [
    { mxcUri: 'mxc://test/old', essential: true },
  ]);
  await save('mxc://test/old', 'room-a', true);
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$stream', 2, [
    { mxcUri: 'mxc://test/new', essential: true },
  ]);
  expect(await store.loadCachedAttachment(session, 'mxc://test/old')).toBeUndefined();
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/old', bytes: new ArrayBuffer(1), mimeType: 'text/plain' },
    { roomId: 'room-a', eventId: '$stream', revisionTs: 1, essential: true }
  );
  expect(await store.loadCachedAttachment(session, 'mxc://test/old')).toBeUndefined();
});

it('keeps previous references when registering a replacement fails atomically', async () => {
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$message', 1, [
    { mxcUri: 'mxc://test/old', essential: true },
  ]);
  const original = IDBObjectStore.prototype.put;
  const { vi } = await import('vitest');
  const put = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function failReference(value, key) {
      if (this.name === 'attachment_references' && value.mxcUri === 'mxc://test/new')
        throw new Error('write failed');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
  expect(
    await store.replaceCachedAttachmentReferences(session, 'room-a', '$message', 2, [
      { mxcUri: 'mxc://test/new', essential: true },
    ])
  ).toBe('failed');
  put.mockRestore();
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    missingEssential: 1,
  });
});

it('rejects an older equal-time revision and keeps a redacted owner retired', async () => {
  await store.replaceCachedAttachmentReferences(
    session,
    'room-a',
    '$root',
    5,
    [{ mxcUri: 'mxc://test/new', essential: true }],
    undefined,
    { revisionId: '$z' }
  );
  expect(
    await store.replaceCachedAttachmentReferences(
      session,
      'room-a',
      '$root',
      5,
      [{ mxcUri: 'mxc://test/old', essential: true }],
      undefined,
      { revisionId: '$a' }
    )
  ).toBe('revoked');
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$root', 6, [], undefined, {
    redacted: true,
  });
  expect(
    await store.replaceCachedAttachmentReferences(session, 'room-a', '$root', 7, [
      { mxcUri: 'mxc://test/old', essential: true },
    ])
  ).toBe('revoked');
});
