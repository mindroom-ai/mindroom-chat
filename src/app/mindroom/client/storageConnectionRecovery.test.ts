import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStorageConnectionState,
  registerStorageRecoveryBlocker,
  registerStorageRecoveryPreparation,
  reloadAfterStorageLoss,
  resetStorageConnectionRecoveryForTesting,
  startStorageConnectionSentinel,
  STORAGE_RECOVERY_RELOAD_KEY,
  STORAGE_RECOVERY_REPEAT_WINDOW_MS,
  STORAGE_SENTINEL_DB_NAME,
  subscribeStorageConnectionState,
} from './storageConnectionRecovery';

class MemoryStorage {
  readonly values = new Map<string, string>();

  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

/** Minimal IndexedDB host: WebKit dispatches `error` then `close` on server loss. */
const createIndexedDB = () => {
  const databases: EventTarget[] = [];
  const opened: string[] = [];
  const indexedDB = {
    open: (name: string) => {
      opened.push(name);
      const request = new EventTarget() as EventTarget & {
        result?: EventTarget;
        onsuccess: ((event: Event) => void) | null;
      };
      request.onsuccess = null;
      queueMicrotask(() => {
        const database = new EventTarget();
        databases.push(database);
        request.result = database;
        request.onsuccess?.(new Event('success'));
      });
      return request;
    },
  };
  return {
    indexedDB: indexedDB as unknown as IDBFactory,
    opened,
    loseConnection: () => {
      databases.forEach((database) => {
        database.dispatchEvent(new Event('error'));
        database.dispatchEvent(new Event('close'));
      });
    },
  };
};

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const createVisibility = (initial: DocumentVisibilityState) => {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = initial;
  return {
    document: target as unknown as Document,
    set: (visibilityState: DocumentVisibilityState) => {
      target.visibilityState = visibilityState;
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
};

const start = (
  options: { now?: number; storage?: MemoryStorage; visibility?: DocumentVisibilityState } = {}
) => {
  const host = createIndexedDB();
  const storage = options.storage ?? new MemoryStorage();
  const visibility = createVisibility(options.visibility ?? 'visible');
  const reload = vi.fn();
  const record = vi.fn();
  const now = options.now ?? 1_000_000;
  const stop = startStorageConnectionSentinel({
    indexedDB: host.indexedDB,
    sessionStorage: storage as unknown as Storage,
    document: visibility.document,
    now: () => now,
    reload,
    record,
  });
  return { ...host, storage, reload, record, stop, setVisibility: visibility.set };
};

afterEach(() => {
  resetStorageConnectionRecoveryForTesting();
});

describe('storage connection recovery', () => {
  it('opens a dedicated sentinel connection and stays healthy until it closes', async () => {
    const host = start();
    await settle();

    expect(host.opened).toEqual([STORAGE_SENTINEL_DB_NAME]);
    expect(getStorageConnectionState()).toBe('healthy');
    expect(host.record).not.toHaveBeenCalled();
  });

  it('reports a lost connection once and notifies subscribers', async () => {
    const host = start();
    await settle();
    const listener = vi.fn();
    subscribeStorageConnectionState(listener);

    host.loseConnection();
    host.loseConnection();

    expect(getStorageConnectionState()).toBe('lost');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.record).toHaveBeenCalledWith('lifecycle.storage_connection_lost', {
      automatic_recovery: true,
    });
  });

  it('records the reload before navigating', async () => {
    const host = start();
    await settle();
    host.loseConnection();

    expect(reloadAfterStorageLoss({ automatic: true })).toBe(true);

    expect(host.storage.getItem(STORAGE_RECOVERY_RELOAD_KEY)).toBe('1000000');
    expect(host.record).toHaveBeenLastCalledWith('lifecycle.storage_recovery_reload', {
      automatic: true,
    });
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('stops automatic recovery when storage fails again soon after a recovery reload', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_RECOVERY_RELOAD_KEY, String(1_000_000));
    const host = start({ now: 1_000_000 + STORAGE_RECOVERY_REPEAT_WINDOW_MS - 1, storage });
    await settle();

    host.loseConnection();

    expect(getStorageConnectionState()).toBe('manual');
    expect(host.record).toHaveBeenCalledWith('lifecycle.storage_connection_lost', {
      automatic_recovery: false,
    });
    expect(reloadAfterStorageLoss({ automatic: true })).toBe(false);
    expect(host.reload).not.toHaveBeenCalled();

    expect(reloadAfterStorageLoss({ automatic: false })).toBe(true);
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('allows automatic recovery again after the repeat window', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_RECOVERY_RELOAD_KEY, String(1_000_000));
    const host = start({ now: 1_000_000 + STORAGE_RECOVERY_REPEAT_WINDOW_MS, storage });
    await settle();

    host.loseConnection();

    expect(getStorageConnectionState()).toBe('lost');
  });

  it('falls back to manual recovery when the reload guard cannot be stored', async () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const host = start({ storage });
    await settle();
    host.loseConnection();

    expect(reloadAfterStorageLoss({ automatic: true })).toBe(false);

    expect(getStorageConnectionState()).toBe('manual');
    expect(host.reload).not.toHaveBeenCalled();
    expect(reloadAfterStorageLoss({ automatic: false })).toBe(true);
    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a page that lost storage is hidden', async () => {
    const host = start();
    await settle();
    host.loseConnection();
    expect(host.reload).not.toHaveBeenCalled();

    host.setVisibility('hidden');

    expect(host.reload).toHaveBeenCalledTimes(1);
    expect(host.storage.getItem(STORAGE_RECOVERY_RELOAD_KEY)).toBe('1000000');
  });

  it('reloads immediately when storage is lost while hidden', async () => {
    const host = start({ visibility: 'hidden' });
    await settle();

    host.loseConnection();

    expect(host.reload).toHaveBeenCalledTimes(1);
  });

  it('waits for unsaved in-memory work before reloading', async () => {
    const host = start();
    await settle();
    let unsaved = true;
    const unregister = registerStorageRecoveryBlocker(() => unsaved);
    host.loseConnection();

    host.setVisibility('hidden');
    expect(host.reload).not.toHaveBeenCalled();

    unsaved = false;
    host.setVisibility('visible');
    expect(host.reload).not.toHaveBeenCalled();
    host.setVisibility('hidden');
    expect(host.reload).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('does not reload automatically when recovery is manual', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_RECOVERY_RELOAD_KEY, String(1_000_000));
    const host = start({ now: 1_000_001, storage });
    await settle();
    host.loseConnection();

    host.setVisibility('hidden');

    expect(host.reload).not.toHaveBeenCalled();
  });

  it('prepares before reloading and survives a failing preparation', async () => {
    const host = start();
    await settle();
    const order: string[] = [];
    registerStorageRecoveryPreparation(() => {
      throw new Error('draft storage full');
    });
    registerStorageRecoveryPreparation(() => order.push('prepared'));
    host.reload.mockImplementation(() => order.push('reloaded'));
    host.loseConnection();

    expect(reloadAfterStorageLoss({ automatic: false })).toBe(true);

    expect(order).toEqual(['prepared', 'reloaded']);
  });

  it('never reloads while storage is healthy', async () => {
    const host = start();
    await settle();
    host.setVisibility('hidden');

    expect(reloadAfterStorageLoss({ automatic: true })).toBe(false);
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('ignores the connection after it is stopped', async () => {
    const host = start();
    await settle();
    host.stop();

    host.loseConnection();
    host.setVisibility('hidden');

    expect(getStorageConnectionState()).toBe('healthy');
    expect(host.reload).not.toHaveBeenCalled();
  });

  it('does nothing without IndexedDB', () => {
    const stop = startStorageConnectionSentinel({ indexedDB: undefined });

    expect(getStorageConnectionState()).toBe('healthy');
    stop();
  });
});
