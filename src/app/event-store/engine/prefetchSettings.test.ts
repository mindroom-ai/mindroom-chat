// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_BUDGET = 1_073_741_824;
const values = new Map<string, string>();

describe('MindRoom local settings storage', () => {
  beforeEach(() => {
    vi.resetModules();
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => values.delete(key)),
      clear: vi.fn(() => values.clear()),
      length: 0,
      key: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates v1 implicit homeserver scope while preserving explicit all-room opt-in', async () => {
    const { loadPrefetchSettings, migratePrefetchSettingsStorage } = await import(
      './prefetchSettingsStorage'
    );
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'my-server', prefetchDepth: 2000 })
    );
    expect(loadPrefetchSettings().prefetchScope).toBe('current-room-only');
    expect(loadPrefetchSettings().cacheBudgetBytes).toBe(DEFAULT_BUDGET);
    expect(migratePrefetchSettingsStorage()).toBe(true);
    expect(JSON.parse(values.get('mindroomSettings')!).v).toBe(2);
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'all-rooms', prefetchDepth: 2000 })
    );
    expect(loadPrefetchSettings().prefetchScope).toBe('all-rooms');
  });

  it('hydrates legacy extension fields without mapping the deleted pagination limit', async () => {
    values.set(
      'settings',
      JSON.stringify({ paginationLimit: 120, prefetchScope: 'all-rooms', prefetchDepth: 2500 })
    );
    const { prefetchSettingsAtom } = await import('./prefetchSettings');
    const snapshot = createStore().get(prefetchSettingsAtom);

    expect(snapshot).toEqual({
      prefetchScope: 'all-rooms',
      prefetchDepth: 2500,
      cacheBudgetBytes: DEFAULT_BUDGET,
    });
    expect(snapshot).not.toHaveProperty('paginationLimit');
  });

  it('defaults invalid values in the versioned store', async () => {
    values.set(
      'mindroomSettings',
      JSON.stringify({
        v: 1,
        prefetchScope: 'invalid',
        prefetchDepth: 'many',
        cacheBudgetBytes: 999,
      })
    );
    const { prefetchSettingsAtom } = await import('./prefetchSettings');

    expect(createStore().get(prefetchSettingsAtom)).toEqual({
      prefetchScope: 'current-room-only',
      prefetchDepth: 10000,
      cacheBudgetBytes: DEFAULT_BUDGET,
    });
  });

  it('writes only the versioned MindRoom-owned store', async () => {
    values.set('settings', JSON.stringify({ pageZoom: 90 }));
    const { prefetchSettingsAtom } = await import('./prefetchSettings');
    const store = createStore();

    store.set(prefetchSettingsAtom, {
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
      cacheBudgetBytes: 4 * DEFAULT_BUDGET,
    });

    expect(JSON.parse(values.get('mindroomSettings') ?? '{}')).toEqual({
      v: 2,
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
      cacheBudgetBytes: 4 * DEFAULT_BUDGET,
    });
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({ pageZoom: 90 });
  });

  it('migrates legacy fields explicitly and preserves client settings', async () => {
    values.set(
      'settings',
      JSON.stringify({
        pageZoom: 90,
        paginationLimit: 120,
        prefetchScope: 'all-rooms',
        prefetchDepth: 2000,
      })
    );
    const { migratePrefetchSettingsStorage } = await import('./prefetchSettingsStorage');

    expect(migratePrefetchSettingsStorage()).toBe(true);
    expect(JSON.parse(values.get('mindroomSettings') ?? '{}')).toEqual({
      v: 2,
      prefetchScope: 'all-rooms',
      prefetchDepth: 2000,
      cacheBudgetBytes: DEFAULT_BUDGET,
    });
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({ pageZoom: 90 });
  });

  it('does not mutate storage merely by importing or reading settings', async () => {
    const legacy = JSON.stringify({ pageZoom: 90, paginationLimit: 120 });
    values.set('settings', legacy);
    const { loadPrefetchSettings } = await import('./prefetchSettingsStorage');

    expect(loadPrefetchSettings()).toEqual({
      prefetchScope: 'current-room-only',
      prefetchDepth: 10000,
      cacheBudgetBytes: DEFAULT_BUDGET,
    });
    expect(values.get('settings')).toBe(legacy);
    expect(values.has('mindroomSettings')).toBe(false);
  });

  it('keeps legacy values when the versioned store cannot be written', async () => {
    values.set(
      'settings',
      JSON.stringify({ pageZoom: 90, prefetchScope: 'all-rooms', prefetchDepth: 2000 })
    );
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { migratePrefetchSettingsStorage } = await import('./prefetchSettingsStorage');

    expect(migratePrefetchSettingsStorage()).toBe(false);
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({
      pageZoom: 90,
      prefetchScope: 'all-rooms',
      prefetchDepth: 2000,
    });
  });

  it('does not overwrite a newer versioned store on downgrade', async () => {
    const future = JSON.stringify({ v: 3, prefetchScope: 'future', prefetchDepth: 42 });
    values.set('mindroomSettings', future);
    const { migratePrefetchSettingsStorage } = await import('./prefetchSettingsStorage');

    expect(migratePrefetchSettingsStorage()).toBe(false);
    expect(values.get('mindroomSettings')).toBe(future);
  });

  it('does not overwrite a newer store through an ordinary atom write', async () => {
    const future = JSON.stringify({ v: 3, prefetchScope: 'future', prefetchDepth: 42 });
    values.set('mindroomSettings', future);
    const { prefetchSettingsAtom } = await import('./prefetchSettings');
    const store = createStore();

    store.set(prefetchSettingsAtom, {
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
      cacheBudgetBytes: DEFAULT_BUDGET,
    });

    expect(values.get('mindroomSettings')).toBe(future);
  });

  it('sanitizes cacheBudgetBytes and syncs the runtime budget before subscribers', async () => {
    values.set(
      'mindroomSettings',
      JSON.stringify({
        v: 2,
        prefetchScope: 'current-room-only',
        prefetchDepth: 10000,
        cacheBudgetBytes: 2 * DEFAULT_BUDGET,
      })
    );
    const {
      CACHE_BYTE_BUDGET_BYTES,
      CACHE_BYTE_BUDGET_PRESETS,
      __setCacheStoreByteBudgetForTests,
      getCacheStoreByteBudget,
      sanitizeCacheStoreByteBudget,
    } = await import('../cache/db/cacheStoreSchema');
    const { prefetchSettingsAtom } = await import('./prefetchSettings');

    expect(getCacheStoreByteBudget()).toBe(2 * DEFAULT_BUDGET);
    CACHE_BYTE_BUDGET_PRESETS.forEach((preset) => {
      expect(sanitizeCacheStoreByteBudget(preset)).toBe(preset);
    });
    for (const invalid of [0, 1234, '2GB', null, undefined, Number.NaN]) {
      expect(sanitizeCacheStoreByteBudget(invalid)).toBe(CACHE_BYTE_BUDGET_BYTES);
    }

    const store = createStore();
    let seenBySubscriber: number | undefined;
    const unsubscribe = store.sub(prefetchSettingsAtom, () => {
      seenBySubscriber = getCacheStoreByteBudget();
    });
    const largest = CACHE_BYTE_BUDGET_PRESETS[4];
    store.set(prefetchSettingsAtom, {
      ...store.get(prefetchSettingsAtom),
      cacheBudgetBytes: largest,
    });
    unsubscribe();

    expect(seenBySubscriber).toBe(largest);
    expect(getCacheStoreByteBudget()).toBe(largest);

    __setCacheStoreByteBudgetForTests(123);
    expect(getCacheStoreByteBudget()).toBe(123);
    __setCacheStoreByteBudgetForTests(undefined);
    expect(getCacheStoreByteBudget()).toBe(largest);
  });

  it('syncs cross-tab storage updates before subscribers and keeps them on writes', async () => {
    const { getCacheStoreByteBudget } = await import('../cache/db/cacheStoreSchema');
    const { MINDROOM_SETTINGS_STORAGE_KEY } = await import('./prefetchSettingsStorage');
    const { prefetchSettingsAtom } = await import('./prefetchSettings');

    const store = createStore();
    const observedBudgets: number[] = [];
    const unsubscribe = store.sub(prefetchSettingsAtom, () => {
      observedBudgets.push(getCacheStoreByteBudget());
    });
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: MINDROOM_SETTINGS_STORAGE_KEY,
          storageArea: window.sessionStorage,
        })
      );
      expect(observedBudgets).toEqual([]);

      values.set(
        MINDROOM_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          v: 2,
          prefetchScope: 'current-room-only',
          prefetchDepth: 10000,
          cacheBudgetBytes: 4 * DEFAULT_BUDGET,
        })
      );
      window.dispatchEvent(new StorageEvent('storage', { key: MINDROOM_SETTINGS_STORAGE_KEY }));

      expect(observedBudgets).toEqual([4 * DEFAULT_BUDGET]);
      expect(store.get(prefetchSettingsAtom).cacheBudgetBytes).toBe(4 * DEFAULT_BUDGET);
      expect(getCacheStoreByteBudget()).toBe(4 * DEFAULT_BUDGET);
      expect(localStorage.setItem).not.toHaveBeenCalled();

      store.set(prefetchSettingsAtom, {
        ...store.get(prefetchSettingsAtom),
        prefetchScope: 'all-rooms',
      });

      expect(JSON.parse(values.get(MINDROOM_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
        v: 2,
        prefetchScope: 'all-rooms',
        prefetchDepth: 10000,
        cacheBudgetBytes: 4 * DEFAULT_BUDGET,
      });
      expect(getCacheStoreByteBudget()).toBe(4 * DEFAULT_BUDGET);
    } finally {
      unsubscribe();
    }

    // Listener is removed on unmount, and a later mount picks up unseen storage writes.
    values.set(
      MINDROOM_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        v: 2,
        prefetchScope: 'all-rooms',
        prefetchDepth: 10000,
        cacheBudgetBytes: 8 * DEFAULT_BUDGET,
      })
    );
    window.dispatchEvent(new StorageEvent('storage', { key: MINDROOM_SETTINGS_STORAGE_KEY }));
    expect(observedBudgets).toHaveLength(2);
    expect(getCacheStoreByteBudget()).toBe(4 * DEFAULT_BUDGET);

    const remount = store.sub(prefetchSettingsAtom, () => undefined);
    remount();
    expect(store.get(prefetchSettingsAtom).cacheBudgetBytes).toBe(8 * DEFAULT_BUDGET);
    expect(getCacheStoreByteBudget()).toBe(8 * DEFAULT_BUDGET);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });
});
