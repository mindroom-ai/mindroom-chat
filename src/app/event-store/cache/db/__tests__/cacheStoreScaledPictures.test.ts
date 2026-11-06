import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveAttachmentOwner } from '../../__tests__/attachmentFixtures';
import * as store from '../index';
import { loadCachedScaledPicture, putCachedScaledPicture } from '../cacheStoreScaledPictures';

// The homeserver's scaled copy of a picture lives as long as the picture's references, and the
// cache's byte budget evicts it with the other media.
const session = 'scaled-pictures';
const photo = 'mxc://test/photo';
const owner = { roomId: 'room-a', eventId: '$photo', revisionTs: 1 };

const ownPhoto = (roomId = owner.roomId, eventId = owner.eventId, revisionTs = 1) =>
  saveAttachmentOwner(session, roomId, eventId, revisionTs, [{ mxcUri: photo, essential: false }]);
const saveScaled = (byteLength = 1500, who = owner) =>
  putCachedScaledPicture(
    session,
    { mxcUri: photo, bytes: new ArrayBuffer(byteLength), mimeType: 'image/jpeg' },
    who
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

it('saves a scaled copy only for a revision that still shows the picture', async () => {
  expect(await saveScaled()).toBe(false);
  await ownPhoto();
  expect(await saveScaled(1500, { ...owner, revisionTs: 2 })).toBe(false);
  expect(await saveScaled(1500, { ...owner, eventId: '$other' })).toBe(false);
  expect(await loadCachedScaledPicture(session, photo)).toBeUndefined();

  expect(await saveScaled()).toBe(true);
  expect(await loadCachedScaledPicture(session, photo)).toMatchObject({
    byteLength: 1500,
    mimeType: 'image/jpeg',
    essential: false,
  });
  // The picture's own bytes are still missing: the copy is no saved original.
  expect(await store.loadCachedAttachment(session, photo)).toBeUndefined();
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    saved: 0,
    missing: 1,
  });
});

it('drops the copy when the last revision showing the picture goes', async () => {
  await ownPhoto();
  await ownPhoto('room-b', '$forward');
  await saveScaled();
  // An edit replaces the picture in one room; another still shows it.
  await saveAttachmentOwner(session, 'room-a', '$photo', 2, []);
  expect(await loadCachedScaledPicture(session, photo)).toBeDefined();
  // A redaction retires the last one.
  await saveAttachmentOwner(session, 'room-b', '$forward', 3, [], undefined, { redacted: true });
  expect(await loadCachedScaledPicture(session, photo)).toBeUndefined();
});

it('clears the copy with its room and counts its bytes as freed', async () => {
  await ownPhoto();
  await saveScaled(1500);
  const freed = await store.clearRoomCachedContent(session, 'room-a');
  expect(await loadCachedScaledPicture(session, photo)).toBeUndefined();
  expect(freed).toBeGreaterThanOrEqual(1500);
});

it('evicts an old copy like other media, leaving the saved original and its references', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
  await ownPhoto();
  await saveScaled(1500);
  await store.putCachedAttachment(
    session,
    { mxcUri: photo, bytes: new ArrayBuffer(2000), mimeType: 'image/png' },
    { ...owner }
  );
  store.__setCacheStoreByteBudgetForTests(3000);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual([`${photo}#scaled`]);
  expect(await loadCachedScaledPicture(session, photo)).toBeUndefined();
  expect(await store.loadCachedAttachment(session, photo)).toBeDefined();
  expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
    saved: 1,
    missing: 0,
  });
});

it("keeps the copy of a pinned room's picture under pressure", async () => {
  await ownPhoto();
  await saveScaled(1500);
  await store.setRoomAttachmentPinned(session, 'room-a', true);
  store.__setCacheStoreByteBudgetForTests(500);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual([]);
  expect(await loadCachedScaledPicture(session, photo)).toBeDefined();
});
