import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CacheStoreWriteLease } from '../cacheStoreDb';

const sessionId = 'cross-runtime-clear';
const roomId = '!clear:example.org';
const rawEvent = {
  event_id: '$late',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { body: 'late', msgtype: 'm.text' },
};
const connections: IDBDatabase[] = [];

const createRuntime = async () => {
  vi.resetModules();
  const store = await import('../index');
  const meta = await import('../cacheStoreMeta');
  const dbTools = await import('../cacheStoreDb');
  const probe = await import('../../cacheProbe');
  const db = (await store.openCacheStore(sessionId))!;
  connections.push(db);
  return { ...store, ...meta, ...dbTools, ...probe, db };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});
afterEach(() => {
  connections.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});

it.each(['room', 'thread', 'attachment', 'progress'] as const)(
  'rejects a pending %s write after another runtime clears the room',
  async (kind) => {
    const writer = await createRuntime();
    const clearer = await createRuntime();
    const lease = writer.captureCacheStoreWriteLease(sessionId, roomId);
    await clearer.clearRoomCachedContent(sessionId, roomId);
    if (kind === 'room') {
      expect(
        await writer.saveRoomEventsToCacheCommitted(
          sessionId,
          roomId,
          [rawEvent],
          undefined,
          'partial',
          lease
        )
      ).toBe(false);
      expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
    } else if (kind === 'thread') {
      expect(
        await writer.saveThreadEventsToCacheCommitted(
          sessionId,
          roomId,
          '$root',
          [rawEvent],
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
      expect(
        (await writer.loadLatestCachedThreadEvents(sessionId, roomId, '$root', 10)).events
      ).toEqual([]);
    } else if (kind === 'attachment') {
      expect(
        await writer.putCachedAttachment(
          sessionId,
          {
            mxcUri: 'mxc://example.org/late',
            bytes: new ArrayBuffer(1),
            mimeType: 'text/plain',
          },
          { roomId, writeLease: lease }
        )
      ).toBe('revoked');
      expect(
        await writer.loadCachedAttachment(sessionId, 'mxc://example.org/late')
      ).toBeUndefined();
    } else {
      expect(
        await writer.updateRoomOfflineProgress(sessionId, roomId, { savedEvents: 1 }, lease)
      ).toBe(false);
      expect(await writer.readRoomOfflineProgress(sessionId, roomId)).toEqual({});
    }
    expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
  }
);

it('learns a remote clear only for new leases and leaves other rooms writable', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  const stale = writer.captureCacheStoreWriteLease(sessionId, roomId);
  const other = writer.captureCacheStoreWriteLease(sessionId, '!other:example.org');
  await clearer.clearRoomCachedContent(sessionId, roomId);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      stale
    )
  ).toBe(false);
  const fresh = writer.captureCacheStoreWriteLease(sessionId, roomId);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      fresh
    )
  ).toBe(true);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      stale
    )
  ).toBe(false);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      '!other:example.org',
      [rawEvent],
      undefined,
      'partial',
      other
    )
  ).toBe(true);
});

const writeGuarded = (
  runtime: Awaited<ReturnType<typeof createRuntime>>,
  lease: CacheStoreWriteLease = runtime.captureCacheStoreWriteLease(sessionId, roomId)
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const transaction = runtime.createCacheStoreWriteTransaction(runtime.db, 'events', lease);
    transaction.objectStore('events').put({
      cacheKey: roomId + '||$late',
      roomId,
      scope: '',
      eventId: '$late',
      ts: 1,
      rawEvent,
      approxBytes: 100,
    });
    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () => resolve(false);
    transaction.onerror = () => {
      if (runtime.isCacheStoreWriteLeaseCurrent(lease)) reject(transaction.error);
    };
  });

it('checks a queued writer after the preceding clear transaction commits', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  const lease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  const clearing = clearer.clearRoomCachedContent(sessionId, roomId);
  await Promise.resolve();
  expect(writer.isCacheStoreWriteLeaseCurrent(lease)).toBe(true);
  const writing = writeGuarded(writer, lease);
  await clearing;
  expect(await writing).toBe(false);
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
});

it('drops an unknown epoch after restart without renewing that lease', async () => {
  const clearer = await createRuntime();
  await clearer.clearRoomCachedContent(sessionId, roomId);
  const writer = await createRuntime();
  const unknown = writer.captureCacheStoreWriteLease(sessionId, roomId);
  expect(await writeGuarded(writer, unknown)).toBe(false);
  expect(await writeGuarded(writer)).toBe(true);
  expect(await writeGuarded(writer, unknown)).toBe(false);
});

it('retains the durable fence across repeated clears', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  await clearer.clearRoomCachedContent(sessionId, roomId);
  expect(await writeGuarded(writer)).toBe(false);
  const beforeSecondClear = writer.captureCacheStoreWriteLease(sessionId, roomId);
  expect(await writeGuarded(writer, beforeSecondClear)).toBe(true);
  await clearer.clearRoomCachedContent(sessionId, roomId);
  expect(await writeGuarded(writer, beforeSecondClear)).toBe(false);
  expect(await writeGuarded(writer)).toBe(true);
});

it('clears a writer transaction that precedes the clear', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  const writing = writeGuarded(writer);
  const clearing = clearer.clearRoomCachedContent(sessionId, roomId);
  expect(await writing).toBe(true);
  await clearing;
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
});

it('rolls back a failed clear but keeps its local cancellation', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  expect(await writeGuarded(writer)).toBe(true);
  const oldLocalLease = clearer.captureCacheStoreWriteLease(sessionId, roomId);
  const put = FakeIDBObjectStore.prototype.put;
  const fault = vi
    .spyOn(FakeIDBObjectStore.prototype, 'put')
    .mockImplementation(function abortEpoch(value, key) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.name === 'meta' && typeof value.epoch === 'number') {
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      }
      return request;
    });
  await expect(clearer.clearRoomCachedContent(sessionId, roomId)).rejects.toBeDefined();
  fault.mockRestore();
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(await writeGuarded(writer)).toBe(true);
  expect(clearer.isCacheStoreWriteLeaseCurrent(oldLocalLease)).toBe(false);
  expect(await writeGuarded(clearer, oldLocalLease)).toBe(false);
  expect(await writeGuarded(clearer)).toBe(true);
});

it('does not recreate a summary when clear is queued before its write', async () => {
  const writer = await createRuntime();
  const clearer = await createRuntime();
  await Promise.all([
    clearer.clearRoomCachedContent(sessionId, roomId),
    writer.saveCachedThreadSummary(sessionId, roomId, '$root', { summaryText: 'old summary' }),
  ]);
  expect(await writer.loadCachedThreadSummaries(sessionId, roomId)).toEqual(new Map());
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('does not persist encrypted history when another runtime clears during decryption', async () => {
  const writer = await createRuntime();
  const { persistRoomChunkWithPreferLive } = await import('../../eventRepository');
  const { createClient, Room } = await import('matrix-js-sdk');
  const clearer = await createRuntime();
  const userId = '@writer:example.org';
  const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const decrypting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mx.decryptEventIfNeeded = async (event) => {
    entered();
    await gate;
    event.setClearData({
      clearEvent: {
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'old preview',
          url: 'mxc://example.org/late',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      },
    });
  };
  const saving = persistRoomChunkWithPreferLive({
    mx,
    sessionId,
    room,
    chunk: [
      {
        ...rawEvent,
        room_id: roomId,
        sender: userId,
        type: 'm.room.encrypted',
        content: { ciphertext: 'encrypted-wire' },
      },
    ],
  }).catch(() => undefined);
  await decrypting;
  await clearer.clearRoomCachedContent(sessionId, roomId);
  release();
  await saving;
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
  expect(
    (await writer.loadLatestCachedThreadEvents(sessionId, roomId, '$root', 10)).events
  ).toEqual([]);
  expect(await writer.readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
    saved: 0,
    missing: 0,
  });
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it.each(['settle', 'prepare'] as const)(
  'stops %s when its lease is revoked while continuation admission finishes',
  async (phase) => {
    const writer = await createRuntime();
    const { scanThreadRelations, DEFAULT_CONTINUATION_STORE } = await import(
      '../../../engine/reconcilerScan'
    );
    const { createClient, Room, MatrixEvent } = await import('matrix-js-sdk');
    const userId = '@writer:example.org';
    const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
    const room = new Room(roomId, mx, userId);
    mx.fetchRelations = async (_room, _thread, _relation, _type, options) => {
      if (options?.from) throw new Error('history temporarily unavailable');
      return { chunk: [{ ...rawEvent, room_id: roomId, sender: userId }], next_batch: 'older' };
    };
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const scan = await scanThreadRelations({
      mx,
      sessionId,
      room,
      roomId,
      threadId: '$root',
      cachedPage: undefined,
      cachedEventIds: new Set(),
      signal: new AbortController().signal,
      debugTraceId: undefined,
      preferLive: (raw) => new MatrixEvent(raw),
      continuationStore: {
        ...DEFAULT_CONTINUATION_STORE,
        begin: async (...args) => {
          const marker = await DEFAULT_CONTINUATION_STORE.begin(...args);
          entered();
          await gate;
          return marker;
        },
      },
    });
    expect(scan.scanComplete).toBe(false);
    const result =
      phase === 'settle' ? scan.settleWithoutRepair() : scan.prepareRepairPersistence();
    await admitting;
    writer.revokeRoomCacheStoreWrites(sessionId, roomId);
    release();
    if (phase === 'prepare') expect(await result).toBe(false);
    else {
      await result;
      expect(
        (await writer.loadThreadReconcileContinuation(sessionId, roomId, '$root'))?.nextToken
      ).toBeUndefined();
    }
  }
);

it('permits fresh writes after deleting and recreating the session database', async () => {
  const writer = await createRuntime();
  await writer.clearRoomCachedContent(sessionId, roomId);
  const oldLease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  await writer.deleteCacheStoreDb(sessionId);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      oldLease
    )
  ).toBe(false);
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('recovers after another runtime deletes the database without reviving old session leases', async () => {
  const writer = await createRuntime();
  await writer.clearRoomCachedContent(sessionId, roomId);
  const otherSession = 'independent-session';
  await writer.clearRoomCachedContent(otherSession, roomId);
  connections.push((await writer.openCacheStore(otherSession))!);
  const oldRoomLease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  const oldOtherRoomLease = writer.captureCacheStoreWriteLease(sessionId, '!untouched:example.org');
  const independentLease = writer.captureCacheStoreWriteLease(otherSession, roomId);
  const remover = await createRuntime();
  await remover.deleteCacheStoreDb(sessionId);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  connections.push((await writer.openCacheStore(sessionId))!);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      oldRoomLease
    )
  ).toBe(false);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      '!untouched:example.org',
      [rawEvent],
      undefined,
      'partial',
      oldOtherRoomLease
    )
  ).toBe(false);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      otherSession,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      independentLease
    )
  ).toBe(true);
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('does not relearn an epoch from a clear that finishes after connection invalidation', async () => {
  const writer = await createRuntime();
  const remover = await createRuntime();
  let invalidated = false;
  writer.db.addEventListener('versionchange', () => {
    invalidated = true;
  });
  const transaction = writer.db.transaction.bind(writer.db);
  vi.spyOn(writer.db, 'transaction').mockImplementation((...args) => {
    const pending = transaction(...args);
    if (args[1] === 'readwrite') {
      const keepAlive = () => {
        const request = pending.objectStore('meta').get('keep-clear-active');
        request.onsuccess = () => {
          if (!invalidated) keepAlive();
        };
      };
      keepAlive();
    }
    return pending;
  });
  const clearing = writer.clearRoomCachedContent(sessionId, roomId);
  await Promise.resolve();
  await Promise.all([clearing, remover.deleteCacheStoreDb(sessionId)]);
  expect(invalidated).toBe(true);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  connections.push((await writer.openCacheStore(sessionId))!);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});
