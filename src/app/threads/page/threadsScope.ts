import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import type { ThreadsScope } from './threadGroups';

const THREADS_SCOPE = 'threadsScope';
const SCOPES: readonly ThreadsScope[] = ['mine', 'following', 'all'];
export const DEFAULT_THREADS_SCOPE: ThreadsScope = 'following';

const storeKey = (userId: string): string => `${THREADS_SCOPE}:${userId}`;

const readScope = (key: string): ThreadsScope => {
  const stored = getLocalStorageItem<unknown>(key, DEFAULT_THREADS_SCOPE);
  return SCOPES.find((scope) => scope === stored) ?? DEFAULT_THREADS_SCOPE;
};

type ThreadsScopeAtom = WritableAtom<ThreadsScope, [ThreadsScope], void>;

const registry = createUserScopedAtomRegistry<ThreadsScopeAtom>({
  create: (userId) =>
    userId
      ? atomWithLocalStorage<ThreadsScope>(storeKey(userId), readScope, (key, value) => {
          setLocalStorageItem(key, value);
        })
      : atom<ThreadsScope>(DEFAULT_THREADS_SCOPE),
  getStorageKey: storeKey,
  cacheEmptyUserId: false,
});

/** Which threads the Threads page lists for the account (Following by default), kept per account. */
export const getThreadsScopeAtom = registry.getOrCreate;

/** Forgets the account's Threads scope, in memory and in local storage. */
export const clearThreadsScopeStore = (userId: string): void => registry.clear(userId);
