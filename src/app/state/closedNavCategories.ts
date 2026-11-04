/**
 * Collapsed sidebar categories, per user. A category passed as initially closed starts collapsed
 * the first time it appears for a user; once the user expands it, it stays expanded.
 */
import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';

const CLOSED_NAV_CATEGORIES = 'closedNavCategories';
const INITIALIZED_NAV_CATEGORIES = 'initializedNavCategories';

type ClosedNavCategoriesAction =
  | { type: 'PUT'; categoryId: string }
  | { type: 'DELETE'; categoryId: string };

export type ClosedNavCategoriesAtom = WritableAtom<Set<string>, [ClosedNavCategoriesAction], void>;

/** A category ID from its parts, for example `makeNavCategoryId('home', 'rooms')`. */
export const makeNavCategoryId = (...parts: string[]): string => parts.join('|');

const readStringArray = (key: string): string[] => {
  const value = getLocalStorageItem<unknown>(key, []);
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
};

const initializeCategories = (closedKey: string, initializedKey: string, categoryIds: string[]) => {
  const initialized = readStringArray(initializedKey);
  const pending = categoryIds.filter((categoryId) => !initialized.includes(categoryId));
  if (pending.length === 0) return;

  const closed = readStringArray(closedKey);
  setLocalStorageItem(closedKey, Array.from(new Set([...closed, ...pending])));
  setLocalStorageItem(initializedKey, [...initialized, ...pending]);
};

export const makeClosedNavCategoriesAtom = (
  userId: string,
  initiallyClosedCategoryIds: string[] = []
): ClosedNavCategoriesAtom => {
  const closedKey = `${CLOSED_NAV_CATEGORIES}${userId}`;
  initializeCategories(
    closedKey,
    `${INITIALIZED_NAV_CATEGORIES}${userId}`,
    Array.from(new Set(initiallyClosedCategoryIds))
  );

  const closedAtom = atomWithLocalStorage<Set<string>>(
    closedKey,
    (key) => new Set(readStringArray(key)),
    (key, categories) => setLocalStorageItem(key, Array.from(categories))
  );

  return atom<Set<string>, [ClosedNavCategoriesAction], void>(
    (get) => get(closedAtom),
    (get, set, { type, categoryId }) => {
      const current = get(closedAtom);
      if ((type === 'PUT') === current.has(categoryId)) return;
      const next = new Set(current);
      if (type === 'PUT') next.add(categoryId);
      else next.delete(categoryId);
      set(closedAtom, next);
    }
  );
};
