import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    } as unknown as Storage);
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

    expect(snapshot).toEqual({ prefetchScope: 'all-rooms', prefetchDepth: 2500 });
    expect(snapshot).not.toHaveProperty('paginationLimit');
  });

  it('defaults invalid values in the versioned store', async () => {
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'invalid', prefetchDepth: 'many' })
    );
    const { prefetchSettingsAtom } = await import('./prefetchSettings');

    expect(createStore().get(prefetchSettingsAtom)).toEqual({
      prefetchScope: 'current-room-only',
      prefetchDepth: 10000,
    });
  });

  it('writes only the versioned MindRoom-owned store', async () => {
    values.set('settings', JSON.stringify({ pageZoom: 90 }));
    const { prefetchSettingsAtom } = await import('./prefetchSettings');
    const store = createStore();

    store.set(prefetchSettingsAtom, {
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
    });

    expect(JSON.parse(values.get('mindroomSettings') ?? '{}')).toEqual({
      v: 2,
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
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
    });

    expect(values.get('mindroomSettings')).toBe(future);
  });
});
