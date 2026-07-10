import { atomFamily } from 'jotai/utils';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  getStorageKeysSafe,
  removeStorageItemSafe,
} from '../../utils/safeLocalStorage';

const ROOM_VIEW_MODE = 'roomViewMode';

export type RoomViewMode = 'compact' | 'threaded' | 'classic';

export const DEFAULT_ROOM_VIEW_MODE: RoomViewMode = 'compact';

export const sanitizeRoomViewMode = (value: unknown): RoomViewMode => {
  // Legacy 'normal' (pre 2026-05-10 rename) intentionally falls through to the
  // default: it was the storage default at the time and the old two-state
  // toggle materialized it on any round trip, so it does not encode a real
  // per-room choice of the threaded view.
  if (value === 'compact' || value === 'threaded' || value === 'classic') return value;
  return DEFAULT_ROOM_VIEW_MODE;
};

const getLegacyRoomViewModeStorageKey = (roomId: string): string => `${ROOM_VIEW_MODE}:${roomId}`;

export const getRoomViewModeStorageKey = (sessionId: string, roomId: string): string =>
  `${ROOM_VIEW_MODE}:${sessionId}:${roomId}`;

const getStoredRoomViewMode = (key: string, legacyKey: string): RoomViewMode => {
  const storage = getSafeLocalStorage();
  if (getStorageItemSafe(storage, key) !== null) {
    return sanitizeRoomViewMode(getLocalStorageItem<unknown>(key, DEFAULT_ROOM_VIEW_MODE));
  }
  if (getStorageItemSafe(storage, legacyKey) === null) return DEFAULT_ROOM_VIEW_MODE;

  const migrated = sanitizeRoomViewMode(
    getLocalStorageItem<unknown>(legacyKey, DEFAULT_ROOM_VIEW_MODE)
  );
  if (setLocalStorageItem(key, migrated)) removeStorageItemSafe(storage, legacyKey);
  return migrated;
};

const setStoredRoomViewMode = (key: string, value: RoomViewMode) => {
  setLocalStorageItem(key, value);
};

const createRoomViewModeAtomFamily = (sessionId: string) =>
  atomFamily((roomId: string) => {
    const storageKey = getRoomViewModeStorageKey(sessionId, roomId);
    return atomWithLocalStorage<RoomViewMode>(
      storageKey,
      (key) => getStoredRoomViewMode(key, getLegacyRoomViewModeStorageKey(roomId)),
      setStoredRoomViewMode
    );
  });

const roomViewModeAtomFamilies = new Map<string, ReturnType<typeof createRoomViewModeAtomFamily>>();

export const roomViewModeAtomFamily = (sessionId: string, roomId: string) => {
  let family = roomViewModeAtomFamilies.get(sessionId);
  if (!family) {
    family = createRoomViewModeAtomFamily(sessionId);
    roomViewModeAtomFamilies.set(sessionId, family);
  }
  return family(roomId);
};

export const clearRoomViewModeStore = (
  sessionId: string,
  storage: Storage | undefined = getSafeLocalStorage()
): void => {
  const storagePrefix = `${ROOM_VIEW_MODE}:${sessionId}:`;
  getStorageKeysSafe(storage)
    .filter((key) => key.startsWith(storagePrefix))
    .forEach((key) => removeStorageItemSafe(storage, key));
  roomViewModeAtomFamilies.delete(sessionId);
};
