/**
 * The route each navigation section (home, direct, a Space ID) last showed, per user, so
 * returning to a section reopens where the user left it.
 */
import { atom, type WritableAtom } from 'jotai';
import type { Path } from 'react-router-dom';
import { isRecord } from '../lib/isRecord';
import { getSafeLocalStorage, removeStorageItemSafe } from '../lib/safeLocalStorage';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';

const NAV_TO_ACTIVE_PATH = 'navToActivePath';

export type NavToActivePath = Map<string, Path>;

export type NavToActivePathAction =
  | { type: 'PUT'; navId: string; path: Path }
  | { type: 'DELETE'; navId: string };

export type NavToActivePathAtom = WritableAtom<NavToActivePath, [NavToActivePathAction], void>;

const getStoreKey = (userId: string): string => `${NAV_TO_ACTIVE_PATH}${userId}`;

const toPath = (value: unknown): Path | undefined => {
  if (!isRecord(value) || typeof value.pathname !== 'string') return undefined;
  return {
    pathname: value.pathname,
    search: typeof value.search === 'string' ? value.search : '',
    hash: typeof value.hash === 'string' ? value.hash : '',
  };
};

const readNavToActivePath = (key: string): NavToActivePath => {
  const stored = getLocalStorageItem<unknown>(key, {});
  const paths: NavToActivePath = new Map();
  if (!isRecord(stored)) return paths;
  Object.entries(stored).forEach(([navId, value]) => {
    const path = toPath(value);
    if (path) paths.set(navId, path);
  });
  return paths;
};

const writeNavToActivePath = (key: string, paths: NavToActivePath) => {
  setLocalStorageItem(
    key,
    Object.fromEntries(
      Array.from(paths, ([navId, { pathname, search, hash }]) => [
        navId,
        { pathname, search, hash },
      ])
    )
  );
};

/** The saved routes of a user, read directly from storage. */
export const getStoredNavToActivePath = (userId: string): NavToActivePath =>
  readNavToActivePath(getStoreKey(userId));

export const makeNavToActivePathAtom = (userId: string): NavToActivePathAtom => {
  const pathsAtom = atomWithLocalStorage<NavToActivePath>(
    getStoreKey(userId),
    readNavToActivePath,
    writeNavToActivePath
  );

  return atom<NavToActivePath, [NavToActivePathAction], void>(
    (get) => get(pathsAtom),
    (get, set, action) => {
      const current = get(pathsAtom);
      const next = new Map(current);
      if (action.type === 'PUT') {
        const { pathname, search, hash } = action.path;
        const existing = current.get(action.navId);
        if (
          existing &&
          existing.pathname === pathname &&
          existing.search === search &&
          existing.hash === hash
        ) {
          return;
        }
        next.set(action.navId, { pathname, search, hash });
      } else {
        if (!current.has(action.navId)) return;
        next.delete(action.navId);
      }
      set(pathsAtom, next);
    }
  );
};

export const clearNavToActivePathStore = (userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), getStoreKey(userId));
};
