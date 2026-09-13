import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageRecord = Record<string, unknown>;

let storageValue: string | null = null;

describe('mindroom settings', () => {
  beforeEach(() => {
    vi.resetModules();
    storageValue = null;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => storageValue),
      setItem: vi.fn((_key: string, value: string) => {
        storageValue = value;
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates pagination limits from the existing generic settings localStorage key', async () => {
    storageValue = JSON.stringify({ paginationLimit: 120 });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    expect(store.get(mindroomSettingsAtom).paginationLimit).toBe(120);
  });

  it('sanitizes malformed pagination limits with the MindRoom preload defaults', async () => {
    storageValue = JSON.stringify({ paginationLimit: 12 });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    expect(store.get(mindroomSettingsAtom).paginationLimit).toBe(50);
  });

  it('persists pagination limits back to the existing settings object for compatibility', async () => {
    storageValue = JSON.stringify({ pageZoom: 90, paginationLimit: 120 });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    store.set(mindroomSettingsAtom, {
      ...store.get(mindroomSettingsAtom),
      paginationLimit: 75,
    });

    const saved = JSON.parse(storageValue ?? '{}') as StorageRecord;
    expect(saved.pageZoom).toBe(90);
    expect(saved.paginationLimit).toBe(75);
  });
});
