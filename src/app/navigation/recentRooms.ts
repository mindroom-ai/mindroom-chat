import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { isRecord } from '../lib/isRecord';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { createUserScopedAtomRegistry } from '../lib/state/userScopedAtomRegistry';
import { getActiveSession } from '../matrix/session/sessions';

const RECENT_ROOMS = 'recentRooms';
const RECENT_ROOMS_STORE_VERSION = 1;
export const MAX_RECENT_ROOMS = 50;

export type RecentRoomItem = { roomId: string; openedAt: number };

type RecentRoomsStore = { v: typeof RECENT_ROOMS_STORE_VERSION; entries: RecentRoomItem[] };

/** The account's visited rooms, newest visit first; writing a room ID records a visit now. */
type RecentRoomsAtom = WritableAtom<RecentRoomItem[], [string], undefined>;

const isRecentRoomItem = (value: unknown): value is RecentRoomItem =>
  isRecord(value) &&
  typeof value.roomId === 'string' &&
  value.roomId.length > 0 &&
  typeof value.openedAt === 'number' &&
  Number.isFinite(value.openedAt) &&
  value.openedAt > 0;

/** Newest visit first, one entry per room, at most `MAX_RECENT_ROOMS`. */
const trimRecentRooms = (entries: RecentRoomItem[]): RecentRoomItem[] => {
  const seen = new Set<string>();
  return [...entries]
    .sort((left, right) => right.openedAt - left.openedAt)
    .filter((entry) => {
      if (seen.has(entry.roomId)) return false;
      seen.add(entry.roomId);
      return true;
    })
    .slice(0, MAX_RECENT_ROOMS);
};

const readRecentRooms = (key: string): RecentRoomItem[] => {
  const stored = getLocalStorageItem<unknown>(key, null);
  if (
    !isRecord(stored) ||
    stored.v !== RECENT_ROOMS_STORE_VERSION ||
    !Array.isArray(stored.entries)
  ) {
    return [];
  }
  return trimRecentRooms(stored.entries.filter(isRecentRoomItem));
};

const getStoreKey = (userId: string): string => `${RECENT_ROOMS}:${userId}`;

const createRecentRoomsAtom = (userId: string): RecentRoomsAtom => {
  const baseAtom = atomWithLocalStorage<RecentRoomItem[]>(
    getStoreKey(userId),
    readRecentRooms,
    (key, entries) => {
      const store: RecentRoomsStore = { v: RECENT_ROOMS_STORE_VERSION, entries };
      setLocalStorageItem(key, store);
    }
  );
  return atom<RecentRoomItem[], [string], undefined>(
    (get) => get(baseAtom),
    (get, set, roomId) => {
      if (!roomId) return;
      set(baseAtom, trimRecentRooms([{ roomId, openedAt: Date.now() }, ...get(baseAtom)]));
    }
  );
};

const recentRoomsRegistry = createUserScopedAtomRegistry<RecentRoomsAtom>({
  create: createRecentRoomsAtom,
  getStorageKey: getStoreKey,
});

/** The rooms the account opened last, newest first, kept in local storage per account. */
export const getRecentRoomsAtom = recentRoomsRegistry.getOrCreate;

/** Records that the signed-in account opened `roomId` now; does nothing while no one is signed in. */
export const bumpRecentRoom = (roomId: string) => {
  const userId = getActiveSession()?.userId;
  if (!userId) return;
  getImperativeJotaiStore().set(recentRoomsRegistry.getOrCreate(userId), roomId);
};

/** Forgets the account's visited rooms, in memory and in local storage. */
export const clearRecentRoomsStore = (userId: string) => {
  recentRoomsRegistry.clear(userId);
};
