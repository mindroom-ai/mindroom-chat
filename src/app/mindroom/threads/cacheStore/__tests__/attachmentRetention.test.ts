import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

it('rejects delayed event writes carrying a cleared room lease', async () => {
  const lease = store.captureCacheStoreWriteLease(session, 'room-a');
  await store.clearRoomCachedContent(session, 'room-a');
  const events = [
    { event_id: '$late', type: 'm.room.message', origin_server_ts: 1, content: { body: 'late' } },
  ];
  expect(
    await store.saveRoomEventsToCacheCommitted(
      session,
      'room-a',
      events,
      undefined,
      'partial',
      lease
    )
  ).toBe(false);
  expect(
    await store.saveThreadEventsToCacheCommitted(
      session,
      'room-a',
      '$root',
      events,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'partial',
      lease
    )
  ).toBe(false);
  expect(await store.loadCachedRoomEvent(session, 'room-a', '$late')).toBeUndefined();
  expect((await store.loadLatestCachedThreadEvents(session, 'room-a', '$root', 10)).events).toEqual(
    []
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  store.__setCacheStoreByteBudgetForTests(undefined);
});

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
  // eslint-disable-next-line no-console
  const originalWarn = console.warn;
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (!String(args[0]).startsWith('[mindroom-cache:attachment.references]'))
      originalWarn(...args);
  });
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
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('[mindroom-cache:attachment.references]'),
    expect.objectContaining({ message: 'write failed' })
  );
  warn.mockRestore();
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

it.each([
  ['$a-body', '$z-file'],
  ['$z-body', '$a-file'],
])(
  'keeps missing essential coverage independent of optional owner order (%s)',
  async (bodyId, fileId) => {
    const mxcUri = 'mxc://test/shared';
    await store.replaceCachedAttachmentReferences(session, 'room-a', bodyId, 1, [
      { mxcUri, essential: true },
    ]);
    await store.putCachedAttachment(session, {
      mxcUri,
      bytes: new TextEncoder().encode('invalid json').buffer,
      mimeType: 'application/json',
    });
    await store.replaceCachedAttachmentReferences(session, 'room-a', fileId, 1, [
      { mxcUri, essential: false },
    ]);
    expect(await store.readRoomAttachmentStorage(session, 'room-a')).toMatchObject({
      bytes: 12,
      saved: 0,
      missing: 1,
      missingEssential: 1,
    });
  }
);

it('authoritatively retracts edits while preserving durable retired IDs and root tombstones', async () => {
  const refs = (name: string) => [{ mxcUri: `mxc://test/${name}`, essential: true }];
  const register = (ts: number, revisionId: string, retractedRevisionIds?: string[]) =>
    store.replaceCachedAttachmentReferences(
      session,
      'room-a',
      '$root',
      ts,
      refs(revisionId || 'root'),
      undefined,
      { revisionId, retractedRevisionIds }
    );
  expect(await register(1, '')).toBe('committed');
  expect(await register(0, '', [''])).toBe('revoked');
  expect(await register(2, '$edit-a')).toBe('committed');
  expect(await register(3, '$edit-b')).toBe('committed');
  expect(await register(2, '$edit-a')).toBe('revoked');
  expect(await register(2, '$edit-a', ['$unrelated'])).toBe('revoked');
  expect(await register(2, '$edit-a', ['$edit-b'])).toBe('committed');
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/$edit-b', bytes: new ArrayBuffer(1), mimeType: 'text/plain' },
    { roomId: 'room-a', eventId: '$root', revisionTs: 3, revisionId: '$edit-b', essential: true }
  );
  expect(await store.loadCachedAttachment(session, 'mxc://test/$edit-b')).toBeUndefined();
  store.resetCacheStoreForTesting();
  expect(await register(3, '$edit-b')).toBe('revoked');
  expect(await register(1, '', ['$edit-a'])).toBe('committed');
  expect(await register(4, '$edit-c')).toBe('committed');
  expect(await register(1, '', ['$edit-c'])).toBe('committed');
  store.resetCacheStoreForTesting();
  expect(await register(2, '$edit-a')).toBe('revoked');
  expect(await register(3, '$edit-b')).toBe('revoked');
  expect(await register(4, '$edit-c')).toBe('revoked');
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$root', 5, [], undefined, {
    redacted: true,
  });
  expect(await register(1, '', ['$edit-c'])).toBe('revoked');
});

it('replaces legacy room references by key and preserves another room sharing the blob', async () => {
  await save('mxc://test/legacy', 'room-a', true);
  await save('mxc://test/legacy', 'room-b', true);
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$owner', 1, [
    { mxcUri: 'mxc://test/legacy', essential: true, validated: true },
  ]);
  const metadata = await store.getCachedAttachmentMetadata(session, 'mxc://test/legacy');
  expect(metadata?.references.map((row) => [row.roomId, row.eventId]).sort()).toEqual([
    ['room-a', '$owner'],
    ['room-b', undefined],
  ]);
  await store.replaceCachedAttachmentReferences(session, 'room-a', '$owner', 2, []);
  expect(await store.loadCachedAttachment(session, 'mxc://test/legacy')).toBeDefined();
  expect(
    (await store.getCachedAttachmentMetadata(session, 'mxc://test/legacy'))?.references
  ).toHaveLength(1);
});

it.each(['unchanged', 'timestamp', 'revision-id', 'mxc', 'bound', 'optional'] as const)(
  'preserves essential validation only for the unchanged bounded owner (%s)',
  async (change) => {
    const mxcUri = 'mxc://test/proof';
    await store.replaceCachedAttachmentReferences(
      session,
      'room-a',
      '$owner',
      1,
      [{ mxcUri, essential: change !== 'optional' }],
      undefined,
      { revisionId: '$revision' }
    );
    await store.putCachedAttachment(
      session,
      { mxcUri, bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
      {
        roomId: 'room-a',
        eventId: '$owner',
        revisionTs: 1,
        revisionId: '$revision',
        essential: change !== 'optional',
      }
    );
    const nextUri = change === 'mxc' ? 'mxc://test/different' : mxcUri;
    if (change === 'mxc') await save(nextUri, 'room-a', true);
    await store.replaceCachedAttachmentReferences(
      session,
      'room-a',
      '$owner',
      change === 'timestamp' ? 2 : 1,
      [{ mxcUri: nextUri, essential: true, maxBytes: change === 'bound' ? 1 : 3000 }],
      undefined,
      { revisionId: change === 'revision-id' ? '$revision-new' : '$revision' }
    );
    const reference = (await store.getCachedAttachmentMetadata(session, nextUri))?.references.find(
      (row) => row.eventId === '$owner'
    );
    expect(reference?.status).toBe(change === 'unchanged' ? 'cached' : 'missing');
  }
);
