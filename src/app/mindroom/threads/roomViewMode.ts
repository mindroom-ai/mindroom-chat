import { atomFamily } from 'jotai/utils';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';

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

export const getRoomViewModeStorageKey = (roomId: string): string => `${ROOM_VIEW_MODE}:${roomId}`;

export const getRoomViewMode = (roomId: string): RoomViewMode =>
  typeof globalThis.localStorage?.getItem === 'function'
    ? sanitizeRoomViewMode(
        getLocalStorageItem<unknown>(getRoomViewModeStorageKey(roomId), DEFAULT_ROOM_VIEW_MODE)
      )
    : DEFAULT_ROOM_VIEW_MODE;

const getStoredRoomViewMode = (key: string): RoomViewMode =>
  typeof globalThis.localStorage?.getItem === 'function'
    ? sanitizeRoomViewMode(getLocalStorageItem<unknown>(key, DEFAULT_ROOM_VIEW_MODE))
    : DEFAULT_ROOM_VIEW_MODE;

const setStoredRoomViewMode = (key: string, value: RoomViewMode) => {
  if (typeof globalThis.localStorage?.setItem !== 'function') return;
  setLocalStorageItem(key, value);
};

export const roomViewModeAtomFamily = atomFamily((roomId: string) =>
  atomWithLocalStorage<RoomViewMode>(
    getRoomViewModeStorageKey(roomId),
    getStoredRoomViewMode,
    setStoredRoomViewMode
  )
);
