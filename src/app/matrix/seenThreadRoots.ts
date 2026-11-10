import type { MatrixEvent } from 'matrix-js-sdk';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { isRecord } from '../lib/isRecord';

/**
 * Thread roots the user opened while other messages in the main timeline were still unread. A
 * root lives in the main timeline, and a main receipt would read every message there on the
 * server (see `getThreadRootReadAction`), so such a root counts as read on this device only, until
 * the user's receipts read it too. Kept in localStorage, per account: room ID to root event ID to
 * the root's timestamp.
 */
type SeenRoots = Record<string, Record<string, number>>;

const STORAGE_KEY_PREFIX = 'mindroom.seenThreadRoots:';
// A room keeps its newest roots; the oldest unread messages are the ones a main receipt reads.
const MAX_ROOTS_PER_ROOM = 200;

const storageKey = (userId: string): string => `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;

const parse = (raw: string | null): SeenRoots => {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    const roots: SeenRoots = {};
    Object.entries(value).forEach(([roomId, room]) => {
      if (!isRecord(room)) return;
      const entries = Object.entries(room).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      );
      if (entries.length > 0) roots[roomId] = Object.fromEntries(entries);
    });
    return roots;
  } catch {
    return {};
  }
};

/** The stored record; undefined without localStorage. */
const read = (userId: string, storage = getSafeLocalStorage()): SeenRoots | undefined =>
  storage ? parse(getStorageItemSafe(storage, storageKey(userId))) : undefined;

// Reads happen for every message the unread rules look at; writes, once per opened thread.
const cache = new Map<string, SeenRoots>();
let changes = 0;

/** A count of this device's changes to the records, for caches of what they decide. */
export const seenThreadRootsVersion = (): number => changes;

const cached = (userId: string): SeenRoots => {
  let roots = cache.get(userId);
  if (!roots) {
    roots = read(userId) ?? {};
    cache.set(userId, roots);
  }
  return roots;
};

/** Changes one room's record, starting from the stored one, which another tab may have written. */
const update = (
  userId: string,
  roomId: string,
  change: (room: Record<string, number>) => Record<string, number>
): void => {
  const storage = getSafeLocalStorage();
  const roots = read(userId, storage) ?? { ...cached(userId) };
  const room = change({ ...roots[roomId] });
  changes += 1;
  if (Object.keys(room).length > 0) roots[roomId] = room;
  else delete roots[roomId];
  cache.set(userId, roots);
  if (Object.keys(roots).length === 0) removeStorageItemSafe(storage, storageKey(userId));
  else setStorageItemSafe(storage, storageKey(userId), JSON.stringify(roots));
};

const withoutReadRoots = (room: Record<string, number>, readTs: number) =>
  Object.fromEntries(Object.entries(room).filter(([, ts]) => ts > readTs));

/** Whether the user opened this root's thread on this device (see the module comment). */
export const isSeenThreadRoot = (
  userId: string,
  roomId: string,
  eventId: string | undefined
): boolean => !!eventId && cached(userId)[roomId]?.[eventId] !== undefined;

/** How many roots seen in the room are newer than `ts`, the user's main-timeline read time. */
export const countSeenThreadRootsAfter = (userId: string, roomId: string, ts: number): number =>
  Object.values(cached(userId)[roomId] ?? {}).filter((rootTs) => rootTs > ts).length;

/**
 * Remembers that the user opened the thread of `root`, and forgets the roots their receipts have
 * read since: those older than `readTs`, when they last read the main timeline.
 */
export const rememberSeenThreadRoot = (
  userId: string,
  roomId: string,
  root: MatrixEvent,
  readTs: number
): void => {
  const eventId = root.getId();
  if (!eventId) return;
  update(userId, roomId, (room) => {
    const entries = Object.entries({ ...withoutReadRoots(room, readTs), [eventId]: root.getTs() });
    return Object.fromEntries(entries.sort(([, a], [, b]) => a - b).slice(-MAX_ROOTS_PER_ROOM));
  });
};

/** Forgets the roots the user's receipts have read: those older than `readTs`. */
export const forgetReadThreadRoots = (userId: string, roomId: string, readTs: number): void => {
  if (!cached(userId)[roomId]) return;
  update(userId, roomId, (room) => withoutReadRoots(room, readTs));
};

/** Forgets every root of an account, for sign-out. */
export const clearSeenThreadRoots = (userId: string): void => {
  changes += 1;
  cache.delete(userId);
  removeStorageItemSafe(getSafeLocalStorage(), storageKey(userId));
};
