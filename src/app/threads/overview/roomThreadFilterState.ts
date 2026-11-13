import { atom, type SetStateAction, type WritableAtom } from 'jotai';
import {
  deserializeThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';

const STORAGE_KEY_PREFIX = 'mindroom.roomThreadFilter';

/** A room's stored thread filter; `null` until the reader sets one, so the room's default applies. */
export type RoomThreadFilterAtom = WritableAtom<
  ThreadFilterState | null,
  [SetStateAction<ThreadFilterState | null>],
  void
>;

const userKeyPrefix = (userId: string): string =>
  `${STORAGE_KEY_PREFIX}:${encodeURIComponent(userId)}:`;

/** localStorage key of one user's thread filter for one room. */
export const getRoomThreadFilterStorageKey = (userId: string, roomId: string): string =>
  `${userKeyPrefix(userId)}${encodeURIComponent(roomId)}`;

const getStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const readStoredFilter = (storageKey: string): ThreadFilterState | null => {
  const raw = getStorage()?.getItem(storageKey);
  if (!raw) return null;
  try {
    return deserializeThreadFilterState(JSON.parse(raw));
  } catch {
    return null;
  }
};

// A filter the reader set is kept even when it equals a default: the room's default can differ.
const writeStoredFilter = (storageKey: string, state: ThreadFilterState | null): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (!state) {
      storage.removeItem(storageKey);
    } else {
      storage.setItem(storageKey, JSON.stringify(serializeThreadFilterState(state)));
    }
  } catch {
    // Storage full or blocked: the filter still applies for this session.
  }
};

const createRoomThreadFilterAtom = (storageKey: string): RoomThreadFilterAtom => {
  const valueAtom = atom<ThreadFilterState | null>(readStoredFilter(storageKey));
  valueAtom.onMount = (setValue) => {
    // Pick up writes made between creating the atom and mounting it.
    setValue(readStoredFilter(storageKey));
    if (typeof window === 'undefined') return undefined;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      setValue(readStoredFilter(storageKey));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  };

  return atom(
    (get) => get(valueAtom),
    (get, set, update: SetStateAction<ThreadFilterState | null>) => {
      const next = typeof update === 'function' ? update(get(valueAtom)) : update;
      set(valueAtom, next);
      writeStoredFilter(storageKey, next);
    }
  );
};

const atomCache = new Map<string, RoomThreadFilterAtom>();

/** The persisted thread filter of `roomId` for `userId`; the same atom for the same pair. */
export const roomThreadFilterAtomFamily = (
  userId: string,
  roomId: string
): RoomThreadFilterAtom => {
  const storageKey = getRoomThreadFilterStorageKey(userId, roomId);
  let filterAtom = atomCache.get(storageKey);
  if (!filterAtom) {
    filterAtom = createRoomThreadFilterAtom(storageKey);
    atomCache.set(storageKey, filterAtom);
  }
  return filterAtom;
};

/** Forget every stored thread filter of `userId` (account removal or logout). */
export const clearRoomThreadFiltersStore = (userId: string): void => {
  const prefix = userKeyPrefix(userId);
  [...atomCache.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => atomCache.delete(key));

  const storage = getStorage();
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
};
