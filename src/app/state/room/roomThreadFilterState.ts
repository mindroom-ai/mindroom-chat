import { atomFamily } from 'jotai/utils';
import {
  createDefaultThreadFilterState,
  deserializeThreadFilterState,
  isDefaultThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from '../../mindroom/threads/roomThreadOverviewModel';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../utils/atomWithLocalStorage';

const ROOM_THREAD_FILTER = 'roomThreadFilter';
const trackedRoomThreadFilterStoreKeys = new Set<string>();

export const getRoomThreadFilterStorageKey = (userId: string, roomId: string): string =>
  `${ROOM_THREAD_FILTER}:${userId}:${roomId}`;

const baseRoomThreadFilterAtomFamily = atomFamily((storeKey: string) =>
  atomWithLocalStorage<ThreadFilterState>(
    storeKey,
    (key) => {
      const rawValue = getLocalStorageItem<unknown | null>(key, null);
      return rawValue === null
        ? createDefaultThreadFilterState()
        : deserializeThreadFilterState(rawValue);
    },
    (key, value) => {
      if (isDefaultThreadFilterState(value)) {
        localStorage.removeItem(key);
        return;
      }

      setLocalStorageItem(key, serializeThreadFilterState(value));
    }
  )
);

export const roomThreadFilterAtomFamily = (userId: string, roomId: string) => {
  const storeKey = getRoomThreadFilterStorageKey(userId, roomId);
  trackedRoomThreadFilterStoreKeys.add(storeKey);
  return baseRoomThreadFilterAtomFamily(storeKey);
};

export const clearRoomThreadFiltersStore = (userId: string) => {
  const keyPrefix = `${ROOM_THREAD_FILTER}:${userId}:`;
  const storageKeys = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index)
  )
    .filter((key): key is string => Boolean(key))
    .filter((key) => key.startsWith(keyPrefix));
  const cachedKeys = Array.from(trackedRoomThreadFilterStoreKeys).filter((key) =>
    key.startsWith(keyPrefix)
  );
  const keysToClear = new Set([...storageKeys, ...cachedKeys]);

  keysToClear.forEach((key) => {
    localStorage.removeItem(key);
    trackedRoomThreadFilterStoreKeys.delete(key);
    baseRoomThreadFilterAtomFamily.remove(key);
  });
};
