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
      involvedOnly: true,
    });
    expect(sanitizeThreadSidebarPreferences({ v: 2 })).toEqual({
      pinnedThreadKeys: [],
      layout: 'recent',
      involvedOnly: true,
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
      involvedOnly: true,
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
      involvedOnly: true,
      v: 1,
    });
  });

  it('loads v1 Sections preferences missing For me as on, keeping the pins', () => {
    storage.set(
      getThreadSidebarPreferencesStoreKey(USER_ID),
      JSON.stringify({ v: 1, pinnedThreadKeys: [THREAD_KEY], layout: 'sections' })
    );

    expect(createStore().get(makeThreadSidebarPreferencesAtom(USER_ID))).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'sections',
      involvedOnly: true,
    });
  });

  it('defaults For me to on for a new account', () => {
    expect(createStore().get(makeThreadSidebarPreferencesAtom(USER_ID)).involvedOnly).toBe(true);
  });

  it('defaults a non-boolean For me preference to on', () => {
    expect(sanitizeThreadSidebarPreferences({ v: 1, involvedOnly: 'false' }).involvedOnly).toBe(
      true
    );
  });

  it('round-trips For me on and off beside the existing preferences', () => {
    const key = getThreadSidebarPreferencesStoreKey(USER_ID);
    storage.set(key, JSON.stringify({ v: 1, pinnedThreadKeys: [THREAD_KEY], layout: 'sections' }));
    const store = createStore();
    const preferences = makeThreadSidebarPreferencesAtom(USER_ID);

    store.set(preferences, { type: 'SET_INVOLVED_ONLY', involvedOnly: true });
    const saved = () => sanitizeThreadSidebarPreferences(JSON.parse(storage.get(key) ?? '{}'));
    expect(saved()).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'sections',
      involvedOnly: true,
    });
    expect(store.get(preferences)).toEqual(saved());

    store.set(preferences, { type: 'SET_INVOLVED_ONLY', involvedOnly: false });
    expect(saved().involvedOnly).toBe(false);
    clearThreadSidebarPreferencesStore(USER_ID);
    expect(createStore().get(makeThreadSidebarPreferencesAtom(USER_ID))).toEqual(saved());
  });

  it('persists pin toggles per account', () => {
    const store = createStore();
    const preferencesAtom = makeThreadSidebarPreferencesAtom(USER_ID);

    store.set(preferencesAtom, { type: 'TOGGLE_PIN', threadKey: THREAD_KEY });

    expect(store.get(preferencesAtom)).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
      involvedOnly: true,
    });
    expect(JSON.parse(storage.get(getThreadSidebarPreferencesStoreKey(USER_ID)) ?? '{}')).toEqual({
      pinnedThreadKeys: [THREAD_KEY],
      layout: 'recent',
      involvedOnly: true,
      v: 1,
    });

    store.set(preferencesAtom, { type: 'TOGGLE_PIN', threadKey: THREAD_KEY });
    expect(store.get(preferencesAtom).pinnedThreadKeys).toEqual([]);
  });
});
