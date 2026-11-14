import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../lib/state/userScopedAtomRegistry';

const STORE_PREFIX = 'quickCaptureRoom';

const storeKey = (userId: string): string => `${STORE_PREFIX}:${userId}`;

const readRoom = (key: string): string | null => {
  const stored = getLocalStorageItem<unknown>(key, null);
  return typeof stored === 'string' ? stored : null;
};

type QuickCaptureRoomAtom = WritableAtom<string | null, [string | null], void>;

const registry = createUserScopedAtomRegistry<QuickCaptureRoomAtom>({
  create: (userId) =>
    userId
      ? atomWithLocalStorage<string | null>(storeKey(userId), readRoom, (key, value) => {
          setLocalStorageItem(key, value ?? undefined);
        })
      : atom<string | null>(null),
  getStorageKey: storeKey,
  cacheEmptyUserId: false,
});

/** The room the quick capture widget posts into (none until chosen), kept per account. */
export const getQuickCaptureRoomAtom = registry.getOrCreate;

/** Forgets the account's quick capture room, in memory and in local storage. */
export const clearQuickCaptureRoomStore = (userId: string): void => registry.clear(userId);
