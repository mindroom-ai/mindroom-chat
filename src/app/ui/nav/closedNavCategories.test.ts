import { createStore } from 'jotai';
import { enableMapSet } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from '../../sidebar/threads/recentlyOpenedCategory';
import { makeClosedNavCategoriesAtom } from './closedNavCategories';

const USER_ID = '@alice:example.org';
const STORE_KEY = `closedNavCategories${USER_ID}`;
const INITIALIZED_STORE_KEY = `initializedNavCategories${USER_ID}`;
const storage = new Map<string, string>();

enableMapSet();

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
});
