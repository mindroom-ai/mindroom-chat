import {
  forceCloseDatabase as forceCloseFakeDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
} from 'fake-indexeddb';
import { ClientEvent, createClient, MatrixEvent, User, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realPut = IDBObjectStore.prototype.put;

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

  /** The types of the account data events in the database. */
  const persistedAccountData = async () => {
    const reader = await startStore();
    return (await reader.getSavedSync())?.accountData.map((event) => event.type);
  };

  const accumulateWithAccountData = (store: IndexedDBStore, nextBatch: string) =>
    store.setSyncData({
      next_batch: nextBatch,
      account_data: { events: [{ type: 'm.direct', content: {} }] },
    } as Parameters<IndexedDBStore['setSyncData']>[0]);

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
        transaction.abort();
        // The `abort` event comes in a later task; a browser's own abort has set the error by then.
        if (errorName !== undefined) {
          Object.defineProperty(transaction, 'error', { value: new DOMException('', errorName) });
        }
      });
      return request;
    });
  };

  /**
   * The next write fails as a browser reports it on the request: the request's `error` event
   * reaches the transaction, which has no error of its own yet, and the transaction then aborts.
   */
  function failRequest(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const request = realPut.apply(this, args);
    const { transaction } = this;
    request.addEventListener('success', () => {
      const error = new DOMException('Storage is full.', 'QuotaExceededError');
      Object.defineProperty(request, 'error', { value: error });
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: request });
      transaction.onerror?.(event);
      transaction.abort();
    });
    return request;
  }

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
    await accumulateWithAccountData(store, 'aborted');
    await store.save(true);

    expect(await persistedToken()).toBe('saved');
    expect(await persistedAccountData()).toEqual([]);
  });

  it('writes no part of a save whose last write throws', async () => {
    const store = await savedStore();

    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function throwOnSync(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'sync') throw new DOMException('Not clonable.', 'DataCloneError');
      return put.apply(this, args);
    });
    await accumulateWithAccountData(store, 'thrown');
    await store.save(true);

    expect(await persistedAccountData()).toEqual([]);
    expect(await persistedToken()).toBe('saved');
  });

  it('saves a user again whose presence a failed save did not write', async () => {
    const store = await savedStore();
    const user = new User('@bob:example');
    user.setPresenceEvent(
      new MatrixEvent({ type: 'm.presence', sender: user.userId, content: { presence: 'online' } })
    );
    store.storeUser(user);

    abortNextSave('UnknownError');
    await store.save(true);
    await store.save(true);

    const reader = await startStore();
    expect(reader.getUser(user.userId)?.events.presence?.getContent()).toEqual({
      presence: 'online',
    });
  });

  // The members of a room that was left stay stored. With a saved token from before the leave,
  // the next start gets the leave again.
  it('stops saving after a clear of stored members that failed, and keeps the persisted sync', async () => {
    const roomId = '!left:example';
    const member = { room_id: roomId, state_key: '@bob:example', type: 'm.room.member' };
    const store = await savedStore();
    const failed = vi.fn();
    const degraded = vi.fn();
    store.on('failed', failed);
    store.on('degraded', degraded);
    await store.setOutOfBandMembers(roomId, [member] as Parameters<
      IndexedDBStore['setOutOfBandMembers']
    >[1]);

    // The rows are deleted, and the browser then aborts the transaction.
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function abortAfterDelete(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['delete']>
    ) {
      const request = remove.apply(this, args);
      const { transaction } = this;
      request.addEventListener('success', () => transaction.abort());
      return request;
    });
    await store.clearOutOfBandMembers(roomId);
    await accumulate(store, 'after-leave');
    await store.save(true);

    expect(await (await startStore()).getOutOfBandMembers(roomId)).toHaveLength(1);
    expect(await persistedToken()).toBe('saved');
    expect(store.wantsSave()).toBe(false);
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
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

  it('waits twice as long after each further failed save, and reports the first only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = await savedStore();
    const failed = vi.fn();
    store.on('failed', failed);
    const failAfter = async (ms: number) => {
      vi.setSystemTime(Date.now() + ms - 1);
      expect(store.wantsSave()).toBe(false);
      vi.setSystemTime(Date.now() + 2);
      expect(store.wantsSave()).toBe(true);
      abortNextSave('UnknownError');
      await store.save();
    };

    abortNextSave('UnknownError');
    await store.save(true);
    await failAfter(10_000);
    await failAfter(20_000);
    await failAfter(40_000);
    expect(failed).toHaveBeenCalledTimes(1);

    // A save that succeeds ends the streak: the next failure is reported and retried soon.
    await store.save(true);
    abortNextSave('UnknownError');
    await store.save(true);
    expect(failed).toHaveBeenCalledTimes(2);
    await failAfter(10_000);

    // The wait never exceeds the usual five minutes.
    for (let failure = 0; failure < 8; failure += 1) {
      abortNextSave('UnknownError');
      await store.save(true);
    }
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(store.wantsSave()).toBe(true);
  });

  it('keeps the persisted sync after an internal error on a working connection', async () => {
    const store = await savedStore();

    // Thrown before the save wrote or waited for anything.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Internal error.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(await persistedToken()).toBe('saved');

    // The next save is a new one, not the failed one again.
    await store.save(true);
    expect(await persistedToken()).toBe('failed');
  });

  // A batch the accumulator could not take, or took in part, is missing from every later save,
  // whose token is past it: the server would never send it again.
  it('stops saving after a sync batch it could not take, and keeps the persisted sync', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = await savedStore();
    const failed = vi.fn();
    const degraded = vi.fn();
    store.on('failed', failed);
    store.on('degraded', degraded);

    const { syncAccumulator } = (
      store as unknown as { backend: { syncAccumulator: { accumulate: () => void } } }
    ).backend;
    const lost = new Error('bad batch');
    vi.spyOn(syncAccumulator, 'accumulate').mockImplementationOnce(() => {
      throw lost;
    });
    await accumulate(store, 'lost');
    await accumulate(store, 'later');
    await store.save(true);
    expect(await persistedToken()).toBe('saved');

    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(store.wantsSave()).toBe(false);
    await store.save();
    expect(await persistedToken()).toBe('saved');
    expect(degraded.mock.calls).toEqual([[lost]]);
    expect(failed).not.toHaveBeenCalled();
  });

  // A full disk: deleting the saved sync frees space, and the store then works from memory.
  it.each([
    [
      'thrown by the write',
      () => {
        throw new DOMException('Storage is full.', 'QuotaExceededError');
      },
    ],
    ['reported on the request', failRequest],
    ['reported as the transaction commits', undefined],
  ])('clears the store when the storage is full (%s), and stops saving', async (_how, put) => {
    const store = await savedStore();
    const failed = vi.fn();
    const degraded = vi.fn();
    store.on('failed', failed);
    store.on('degraded', degraded);

    if (put) vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(put);
    else abortNextSave('QuotaExceededError');
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

    // Deleting all data still deletes the database, which another tab may have written since.
    const other = await startStore();
    await accumulate(other, 'other');
    await other.save(true);
    await store.deleteAllData();
    expect(await persistedToken()).toBeUndefined();
  });

  it('degrades once when two operations in flight both find the storage full', async () => {
    const store = await savedStore();
    const failed = vi.fn();
    const degraded = vi.fn();
    store.on('failed', failed);
    store.on('degraded', degraded);
    const clearDatabase = vi.spyOn(store.backend, 'clearDatabase');

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(failRequest);
    await accumulate(store, 'failed');
    await Promise.all([store.save(true), store.setOutOfBandMembers('!room:example', [])]);

    expect(degraded).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(clearDatabase).toHaveBeenCalledTimes(1);
  });

  // The first sync request asks for the changes since the saved sync that is replayed.
  describe('the first sync request', () => {
    const startSyncing = async (store: IndexedDBStore, replayFailure?: Error) => {
      const syncRequests: URL[] = [];
      const answer = (body: object) => Promise.resolve(new Response(JSON.stringify(body)));
      const fetchFn = vi.fn<typeof fetch>((input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith('/sync')) {
          syncRequests.push(url);
          return new Promise(() => {
            // The server holds the request.
          });
        }
        if (url.pathname.endsWith('/versions')) return answer({ versions: ['v1.11'] });
        if (url.pathname.endsWith('/filter')) return answer({ filter_id: 'filter' });
        return answer({});
      });
      const client = createClient({
        baseUrl: 'https://matrix.example',
        userId: '@alice:example',
        accessToken: 'token',
        store,
        fetchFn,
      });
      clients.push(client);
      const unexpected = vi.fn();
      client.on(ClientEvent.SyncUnexpectedError, unexpected);
      if (replayFailure) {
        client.once(ClientEvent.AccountData, () => {
          throw replayFailure;
        });
      }
      await store.startup();
      await client.startClient();
      await vi.waitFor(() => expect(syncRequests).toHaveLength(1));
      if (replayFailure) await vi.waitFor(() => expect(unexpected).toHaveBeenCalled());
      // Time for a second request, which must not come.
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      const since = syncRequests.map((url) => url.searchParams.get('since'));
      return { since, unexpected: unexpected.mock.calls };
    };

    const unstartedStore = () => {
      const store = new IndexedDBStore({ indexedDB, dbName: 'connection-loss' });
      stores.push(store);
      return store;
    };

    it('asks for the changes since the saved sync it replays', async () => {
      await savedStore();

      expect(await startSyncing(unstartedStore())).toEqual({ since: ['saved'], unexpected: [] });
    });

    it('asks for everything when the saved sync could not be read', async () => {
      await savedStore();
      const store = unstartedStore();
      vi.spyOn(store.backend, 'getSavedSync').mockRejectedValueOnce(new Error('unreadable'));

      expect(await startSyncing(store)).toEqual({ since: [null], unexpected: [] });
    });

    it('goes on from a saved sync whose replay threw, and reports the error', async () => {
      const saved = await startStore();
      await accumulateWithAccountData(saved, 'saved');
      await saved.save(true);
      const error = new Error('replay failed');

      expect(await startSyncing(unstartedStore(), error)).toEqual({
        since: ['saved'],
        unexpected: [[error, true]],
      });
    });
  });
});
