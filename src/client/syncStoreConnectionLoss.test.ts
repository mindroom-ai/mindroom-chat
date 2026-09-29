import {
  forceCloseDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
} from 'fake-indexeddb';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WebKit closes every IndexedDB connection when its networking process
 * exits: active and committing transactions abort, and each connection fires
 * `close`. The sync store must survive that without hanging or deleting the
 * persisted sync.
 */
describe('Matrix sync store after an IndexedDB connection loss', () => {
  let indexedDB: IDBFactory;
  const stores: IndexedDBStore[] = [];
  const clients: MatrixClient[] = [];

  beforeEach(() => {
    indexedDB = new IDBFactory();
    // The SDK reads the global for its out-of-band member queries.
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clients.splice(0).forEach((client) => client.stopClient());
    await Promise.all(stores.splice(0).map((store) => store.destroy()));
  });

  const startStore = async () => {
    const store = new IndexedDBStore({ indexedDB, dbName: 'connection-loss' });
    stores.push(store);
    // `startup` needs the store to be attached to a client.
    clients.push(
      createClient({ baseUrl: 'https://matrix.example', userId: '@alice:example', store })
    );
    await store.startup();
    return store;
  };

  const backendDatabase = (store: IndexedDBStore): IDBDatabase =>
    (store as unknown as { backend: { db: IDBDatabase } }).backend.db;

  const accumulate = (store: IndexedDBStore, nextBatch: string) =>
    store.setSyncData({ next_batch: nextBatch } as Parameters<IndexedDBStore['setSyncData']>[0]);

  const persistedToken = async () => {
    const reader = await startStore();
    return reader.getSavedSyncToken();
  };

  it('saves on a fresh connection after the browser closes the old one', async () => {
    const store = await startStore();
    const degraded = vi.fn();
    store.on('degraded', degraded);
    await accumulate(store, 'before-loss');
    await store.save(true);

    forceCloseDatabase(backendDatabase(store));
    await accumulate(store, 'after-loss');
    await store.save(true);

    expect(degraded).not.toHaveBeenCalled();
    await store.destroy();
    expect(await persistedToken()).toBe('after-loss');
  });

  it('settles a save whose commit is aborted and keeps the saved sync', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);

    // The server aborts the transaction after its write succeeded, so only
    // `abort` fires; nothing reports an error on a request.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function abortAfterPut(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await accumulate(store, 'aborted');
    const settled = await Promise.race([
      store.save(true).then(() => 'settled'),
      new Promise((resolve) => {
        setTimeout(() => resolve('pending'), 500);
      }),
    ]);
    expect(settled).toBe('settled');

    await accumulate(store, 'next');
    await store.save(true);
    await store.destroy();
    expect(await persistedToken()).toBe('next');
  });

  it('still clears the store after a failure that is not a lost connection', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Storage is full.', 'QuotaExceededError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(await persistedToken()).toBeUndefined();
  });

  it('keeps the persisted sync when a save fails because the connection was lost', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);

    const closed = vi.fn();
    store.on('closed', closed);
    // WebKit marks the connection as closing before it reports the failed
    // write; its `close` event only follows later.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function lose(
      this: IDBObjectStore
    ) {
      this.transaction.db.close();
      throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);
    expect(closed).toHaveBeenCalledOnce();
    // The failed save is retried after 30 s, not after five minutes.
    expect(store.wantsSave()).toBe(false);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 30_001);
    expect(store.wantsSave()).toBe(true);
    await accumulate(store, 'retried');
    await store.save();
    await store.destroy();

    expect(await persistedToken()).toBe('retried');
  });

  it('keeps the persisted sync when a read in flight fails because the connection was lost', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);

    const openCursor = IDBIndex.prototype.openCursor;
    vi.spyOn(IDBIndex.prototype, 'openCursor').mockImplementationOnce(function lose(
      this: IDBIndex,
      ...args: Parameters<IDBIndex['openCursor']>
    ) {
      const request = openCursor.apply(this, args);
      const { transaction } = this.objectStore;
      transaction.db.close();
      transaction.abort();
      return request;
    });
    expect(await store.getOutOfBandMembers('!room:example')).toBeNull();
    await store.destroy();

    expect(await persistedToken()).toBe('saved');
  });

  it('still clears the store after an unknown error on a working connection', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Internal error.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(await persistedToken()).toBeUndefined();
  });

  it('shares one reopen between concurrent operations', async () => {
    const store = await startStore();
    const open = vi.spyOn(indexedDB, 'open');
    forceCloseDatabase(backendDatabase(store));

    await accumulate(store, 'after-loss');
    await Promise.all([
      store.save(true),
      store.getOutOfBandMembers('!room:example'),
      store.getClientOptions(),
    ]);

    expect(open).toHaveBeenCalledOnce();
  });

  it('does not recreate a database deleted while its connection was closed', async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);
    forceCloseDatabase(backendDatabase(store));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('matrix-js-sdk:connection-loss');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await accumulate(store, 'after-delete');
    await store.save(true);

    expect((await indexedDB.databases()).map(({ name }) => name)).not.toContain(
      'matrix-js-sdk:connection-loss'
    );
  });

  it.each([
    ['destroy', 'saved'],
    ['deleteAllData', undefined],
  ] as const)(
    'does not reopen after %s, even while a reopen is in flight',
    async (close, remaining) => {
      const store = await startStore();
      await accumulate(store, 'saved');
      await store.save(true);
      forceCloseDatabase(backendDatabase(store));
      await accumulate(store, 'after-loss');
      const saving = store.save(true);
      await store[close]();
      await saving;

      expect(backendDatabase(store)).toBeUndefined();
      const open = vi.spyOn(indexedDB, 'open');
      await store.save(true);
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
      // Closing keeps the persisted sync; only deleting removes it.
      expect(await persistedToken()).toBe(remaining);
    }
  );

  it('does not reopen after another context deletes the database', async () => {
    const store = await startStore();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('matrix-js-sdk:connection-loss');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('the store blocked the deletion'));
    });

    const open = vi.spyOn(indexedDB, 'open');
    await accumulate(store, 'after-delete');
    await store.save(true);
    expect(open).not.toHaveBeenCalled();
  });
});
