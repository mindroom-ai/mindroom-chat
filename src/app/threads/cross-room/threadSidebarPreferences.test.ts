import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCrossRoomThreadIndexKey } from './crossRoomThreadIndex';
import {
  clearThreadSidebarPreferencesStore,
  getThreadSidebarPreferencesStoreKey,
  makeThreadSidebarPreferencesAtom,
  sanitizeThreadSidebarPreferences,
} from './threadSidebarPreferences';

const USER_ID = '@alice:example.org';
const THREAD_KEY = getCrossRoomThreadIndexKey('!room:example.org', '$thread');
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  clearThreadSidebarPreferencesStore(USER_ID);
});

afterEach(() => {
  clearThreadSidebarPreferencesStore(USER_ID);
  vi.unstubAllGlobals();
});

describe('thread sidebar preferences', () => {
  it('sanitizes corrupt state and de-duplicates valid pinned thread keys', () => {
    expect(
      sanitizeThreadSidebarPreferences({
        v: 1,
        pinnedThreadKeys: [THREAD_KEY, 'invalid', THREAD_KEY],
      })
    ).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
    });
    expect(sanitizeThreadSidebarPreferences({ v: 2 })).toEqual({
      pinnedThreadKeys: [],
      layout: 'recent',
    });
  });

  it('keeps the pins of stored preferences from before the layout, in the Recent layout', () => {
    storage.set(
      getThreadSidebarPreferencesStoreKey(USER_ID),
      JSON.stringify({ v: 1, pinnedThreadKeys: [THREAD_KEY] })
    );

    expect(createStore().get(makeThreadSidebarPreferencesAtom(USER_ID))).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
    });
  });

  it('reads an unknown layout as Recent', () => {
    expect(sanitizeThreadSidebarPreferences({ v: 1, layout: 'sections' }).layout).toBe('sections');
    expect(sanitizeThreadSidebarPreferences({ v: 1, layout: 'grid' }).layout).toBe('recent');
    expect(sanitizeThreadSidebarPreferences({ v: 1, layout: 3 }).layout).toBe('recent');
  });

  it('persists the chosen layout beside the pins', () => {
    const store = createStore();
    const preferencesAtom = makeThreadSidebarPreferencesAtom(USER_ID);
    store.set(preferencesAtom, { type: 'TOGGLE_PIN', threadKey: THREAD_KEY });

    store.set(preferencesAtom, { type: 'SET_LAYOUT', layout: 'sections' });

    expect(JSON.parse(storage.get(getThreadSidebarPreferencesStoreKey(USER_ID)) ?? '{}')).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'sections',
      v: 1,
    });
  });

  it('persists pin toggles per account', () => {
    const store = createStore();
    const preferencesAtom = makeThreadSidebarPreferencesAtom(USER_ID);

    store.set(preferencesAtom, { type: 'TOGGLE_PIN', threadKey: THREAD_KEY });

    expect(store.get(preferencesAtom)).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
    });
    expect(JSON.parse(storage.get(getThreadSidebarPreferencesStoreKey(USER_ID)) ?? '{}')).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
      v: 1,
    });

    store.set(preferencesAtom, { type: 'TOGGLE_PIN', threadKey: THREAD_KEY });
    expect(store.get(preferencesAtom).pinnedThreadKeys).toEqual([]);
  });
});
