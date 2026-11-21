import {
  forceCloseDatabase as forceCloseFakeDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
} from 'fake-indexeddb';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fake-indexeddb declares the parameter as the database class; it takes an open connection.
const forceCloseDatabase = forceCloseFakeDatabase as unknown as (db: IDBDatabase) => void;

/**
 * WebKit closes every IndexedDB connection when its networking process
 * exits: it marks each connection as closing, aborts active and committing
 * transactions, and only then fires `close`. The sync store must not hang or
 * delete the persisted sync; the page reload restores the connection.
 *
 * WebKit also aborts the transactions in flight when iOS suspends the app, on
 * a connection that stays open. The sync store keeps the persisted sync then
 * too, and saves again soon. Only a full disk deletes it.
 */
describe('Matrix sync store after an IndexedDB failure', () => {
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
    vi.useRealTimers();
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

  const savedStore = async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);
    return store;
  };

  it('settles a save whose commit is aborted by a lost connection', async () => {
    const store = await savedStore();

    // The write succeeds, then the lost server aborts the committing
    // transaction: only `abort` fires, nothing reports an error on a request.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function abortAfterPut(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => {
        this.transaction.db.close();
        this.transaction.abort();
      });
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
    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when a save fails because the connection was lost', async () => {
    const store = await savedStore();
    const degraded = vi.fn();
    store.on('degraded', degraded);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function lose(
      this: IDBObjectStore
    ) {
      this.transaction.db.close();
      throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(degraded).not.toHaveBeenCalled();
    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when operations run after the browser closed the connection', async () => {
    const store = await savedStore();
    forceCloseDatabase(backendDatabase(store));
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    await accumulate(store, 'after-loss');
    await store.save(true);
    // Reads fall back to memory instead of failing.
    expect(await store.getOutOfBandMembers('!room:example')).toBeNull();

    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when a read in flight fails because the connection was lost', async () => {
    const store = await savedStore();

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
    expect(await persistedToken()).toBe('saved');
  });

  // What WebKit does when iOS suspends the app: it aborts the transactions in flight and
  // reports that once the app runs again, as an UnknownError or as an abort without an error.
  // The connection stays open and works.
  const abortNextSave = (errorName: string | undefined) => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function abortAfterPut(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args);
      const { transaction } = this;
      request.addEventListener('success', () => {
        if (errorName === undefined) transaction.abort();
        // fake-indexeddb's own abort, which takes the name of the transaction's error.
        else (transaction as unknown as { _abort: (name: string) => void })._abort(errorName);
      });
      return request;
    });
  };

  it.each([['UnknownError'], [undefined]])(
    'keeps the persisted sync when a save is aborted on an open connection (%s)',
    async (errorName) => {
      const store = await savedStore();
      const failed = vi.fn();
      const degraded = vi.fn();
      store.on('failed', failed);
      store.on('degraded', degraded);

      abortNextSave(errorName);
      await accumulate(store, 'aborted');
      await store.save(true);

      expect(await persistedToken()).toBe('saved');
      expect(degraded).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledTimes(1);
      expect((failed.mock.calls[0]?.[0] as Error).name).toBe(errorName ?? 'AbortError');

      // The store still saves: the next save writes what the aborted one held.
      await store.save(true);
      expect(await persistedToken()).toBe('aborted');
    }
  );

  // Kept after a failed save, the saved sync must never hold a new batch beside older account
  // data: the server sends the changes between them only once.
  it('writes no part of a save that is aborted part-way', async () => {
    const store = await savedStore();

    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function abortAccountData(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args);
      const { transaction } = this;
      if (this.name === 'accountData')
        request.addEventListener('success', () => transaction.abort());
      return request;
    });
    await store.setSyncData({
      next_batch: 'aborted',
      account_data: { events: [{ type: 'm.direct', content: {} }] },
    } as Parameters<IndexedDBStore['setSyncData']>[0]);
    await store.save(true);

    expect(await persistedToken()).toBe('saved');
  });

  it('saves again soon after a failed save, not after the usual five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = await savedStore();
    expect(store.wantsSave()).toBe(false);

    abortNextSave('UnknownError');
    await store.save(true);
    expect(store.wantsSave()).toBe(false);

    vi.setSystemTime(Date.now() + 10_001);
    expect(store.wantsSave()).toBe(true);
    await accumulate(store, 'retried');
    await store.save();
    expect(store.wantsSave()).toBe(false);
    expect(await persistedToken()).toBe('retried');
  });

  it('keeps the persisted sync after an internal error on a working connection', async () => {
    const store = await savedStore();

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Internal error.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(await persistedToken()).toBe('saved');
  });

  // A full disk: deleting the saved sync frees space, and the store then works from memory.
  it.each([
    [
      'thrown by the write',
      () => {
        throw new DOMException('Storage is full.', 'QuotaExceededError');
      },
    ],
    [
      // Browsers report it on the request: its error event reaches the transaction before the
      // transaction has an error of its own.
      'reported on the request',
      function failRequest(this: IDBObjectStore) {
        const fail = () => {
          throw new DOMException('Storage is full.', 'QuotaExceededError');
        };
        type Internals = { _execRequestAsync: (work: object) => IDBRequest<IDBValidKey> };
        return (this.transaction as unknown as Internals)._execRequestAsync({
          source: this,
          operation: fail,
        });
      },
    ],
  ])('clears the store when the storage is full (%s), and stops saving', async (_how, put) => {
    const store = await savedStore();
    const failed = vi.fn();
    const degraded = vi.fn();
    store.on('failed', failed);
    store.on('degraded', degraded);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(put);
    await accumulate(store, 'failed');
    await store.save(true);

    expect(degraded).toHaveBeenCalledTimes(1);
    expect(await persistedToken()).toBeUndefined();

    // Later saves and reads use memory only.
    await store.save(true);
    expect(await store.getOutOfBandMembers('!room:example')).toBeNull();
    expect(store.wantsSave()).toBe(false);
    expect(failed).not.toHaveBeenCalled();
    expect(await persistedToken()).toBeUndefined();
  });
});
