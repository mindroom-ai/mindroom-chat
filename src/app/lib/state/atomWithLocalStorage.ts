import { atom, type WritableAtom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../safeLocalStorage';

/** Reads a JSON value from localStorage; a missing, unreadable, or malformed value gives `defaultValue`. */
export const getLocalStorageItem = <T>(key: string, defaultValue: T): T => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), key);
  if (raw === null) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
};

/** Writes a value as JSON (`undefined` removes the key); `false` when storage refused it. */
export const setLocalStorageItem = <T>(key: string, value: T): boolean => {
  const storage = getSafeLocalStorage();
  if (value === undefined) return removeStorageItemSafe(storage, key);
  return setStorageItemSafe(storage, key, JSON.stringify(value));
};

/**
 * An atom backed by one localStorage key. `getItem` reads (and sanitizes) the stored value when the
 * atom is created; every write goes through `setItem`. While mounted, the atom follows `storage`
 * events for its key, so other tabs' writes show up here, and when it mounts again it reads anew
 * if the stored text changed while it was not (another account showed in this tab, say).
 */
export const atomWithLocalStorage = <T>(
  key: string,
  getItem: (key: string) => T,
  setItem: (key: string, value: T) => void
): WritableAtom<T, [T], void> => {
  const readStored = () => getStorageItemSafe(getSafeLocalStorage(), key);
  // The stored text the value was last read from or written as. A value storage refused, or keeps
  // less of, stays as it is until the text changes.
  let seen: string | null = null;
  const read = (): T => {
    const value = getItem(key);
    seen = readStored();
    return value;
  };
  const valueAtom = atom<T>(read());

  valueAtom.onMount = (setValue) => {
    if (readStored() !== seen) setValue(read());
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      setValue(read());
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  };

  return atom<T, [T], void>(
    (get) => get(valueAtom),
    (_get, set, value) => {
      set(valueAtom, value);
      setItem(key, value);
      seen = readStored();
    }
  );
};
