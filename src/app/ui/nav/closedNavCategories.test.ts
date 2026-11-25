import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from '../../sidebar/threads/recentlyOpenedCategory';
import { makeClosedNavCategoriesAtom } from './closedNavCategories';

const USER_ID = '@alice:example.org';
const STORE_KEY = `closedNavCategories${USER_ID}`;
const INITIALIZED_STORE_KEY = `initializedNavCategories${USER_ID}`;
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('closed navigation categories', () => {
  it('reads the old Snoozed fold as Later and keeps it open after expanding and reloading', () => {
    storage.set(STORE_KEY, JSON.stringify(['mindroom|threads|snoozed', 'home|room']));
    const store = createStore();
    const categories = makeClosedNavCategoriesAtom(USER_ID);
    expect(store.get(categories)).toEqual(new Set(['mindroom|threads|later', 'home|room']));
    store.set(categories, { type: 'DELETE', categoryId: 'mindroom|threads|later' });
    expect(createStore().get(makeClosedNavCategoriesAtom(USER_ID))).toEqual(new Set(['home|room']));
  });

  it('initializes supplied categories even when unrelated state has been stored', () => {
    storage.set(STORE_KEY, JSON.stringify(['home|room']));
    const store = createStore();
    const atom = makeClosedNavCategoriesAtom(USER_ID, [RECENTLY_OPENED_NAV_CATEGORY_ID]);

    expect(store.get(atom)).toEqual(new Set(['home|room', RECENTLY_OPENED_NAV_CATEGORY_ID]));
    expect(JSON.parse(storage.get(STORE_KEY) ?? '[]')).toEqual([
      'home|room',
      RECENTLY_OPENED_NAV_CATEGORY_ID,
    ]);
    expect(JSON.parse(storage.get(INITIALIZED_STORE_KEY) ?? '[]')).toEqual([
      RECENTLY_OPENED_NAV_CATEGORY_ID,
    ]);

    const refreshedStore = createStore();
    const refreshedAtom = makeClosedNavCategoriesAtom(USER_ID, [RECENTLY_OPENED_NAV_CATEGORY_ID]);
    expect(refreshedStore.get(refreshedAtom)).toEqual(
      new Set(['home|room', RECENTLY_OPENED_NAV_CATEGORY_ID])
    );
  });

  it('preserves an explicitly expanded category when the atom is recreated', () => {
    createStore().get(makeClosedNavCategoriesAtom(USER_ID, [RECENTLY_OPENED_NAV_CATEGORY_ID]));
    const refreshedStore = createStore();
    const refreshedAtom = makeClosedNavCategoriesAtom(USER_ID, [RECENTLY_OPENED_NAV_CATEGORY_ID]);

    refreshedStore.set(refreshedAtom, {
      type: 'DELETE',
      categoryId: RECENTLY_OPENED_NAV_CATEGORY_ID,
    });
    expect(storage.get(STORE_KEY)).toBe('[]');

    const secondRefreshStore = createStore();
    const secondRefreshAtom = makeClosedNavCategoriesAtom(USER_ID, [
      RECENTLY_OPENED_NAV_CATEGORY_ID,
    ]);
    expect(secondRefreshStore.get(secondRefreshAtom)).toEqual(new Set());
  });

  it('applies INIT_CLOSED once per category and respects prior or subsequent manual toggles', () => {
    const store = createStore();
    const categories = makeClosedNavCategoriesAtom(USER_ID);

    // A manual toggle before INIT_CLOSED records the category as initialized so INIT_CLOSED
    // never overrides the user's explicit open choice.
    store.set(categories, { type: 'PUT', categoryId: 'home|space|!manual' });
    store.set(categories, { type: 'DELETE', categoryId: 'home|space|!manual' });

    store.set(categories, {
      type: 'INIT_CLOSED',
      categoryIds: ['home|space|!manual', 'home|space|!work', 'home|space|!garden'],
    });
    expect(store.get(categories)).toEqual(new Set(['home|space|!work', 'home|space|!garden']));
    expect(JSON.parse(storage.get(INITIALIZED_STORE_KEY) ?? '[]')).toEqual([
      'home|space|!manual',
      'home|space|!work',
      'home|space|!garden',
    ]);

    // Expanding Work persists across reload and subsequent INIT_CLOSED with a new space only
    // closes the brand-new space.
    store.set(categories, { type: 'DELETE', categoryId: 'home|space|!work' });

    const reloadedStore = createStore();
    const reloaded = makeClosedNavCategoriesAtom(USER_ID);
    reloadedStore.set(reloaded, {
      type: 'INIT_CLOSED',
      categoryIds: ['home|space|!work', 'home|space|!garden', 'home|space|!fresh'],
    });
    expect(reloadedStore.get(reloaded)).toEqual(
      new Set(['home|space|!garden', 'home|space|!fresh'])
    );
  });
});
