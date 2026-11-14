import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { getActiveSession } from '../../matrix/session/sessions';
import { isRecord } from '../../lib/isRecord';
import { getImperativeJotaiStore } from '../../lib/state/jotaiStore';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { isEncryptedRoomOf } from '../../matrix/client/encryptedRoomTextOffDisk';

const RECENT_THREADS = 'recentThreads';
const RECENT_THREADS_STORE_VERSION = 1;
export const MAX_RECENT_THREADS = 50;

export type RecentThreadItem = {
  roomId: string;
  threadId: string;
  openedAt: number;
  summaryText?: string;
};

type RecentThreadsStore = {
  v: typeof RECENT_THREADS_STORE_VERSION;
  entries: RecentThreadItem[];
};

type RecentThreadsAction =
  | {
      type: 'BUMP';
      roomId: string;
      threadId: string;
      openedAt?: number;
      summaryText?: string;
    }
  | {
      type: 'REMOVE';
      roomId: string;
      threadId: string;
    }
  | {
      type: 'REKEY';
      roomId: string;
      threadId: string;
      nextThreadId: string;
    };

type RecentThreadsAtom = WritableAtom<RecentThreadItem[], [RecentThreadsAction], undefined>;

const isRecentThreadItem = (value: unknown): value is RecentThreadItem =>
  isRecord(value) &&
  typeof value.roomId === 'string' &&
  value.roomId.length > 0 &&
  isConfirmedMatrixEventId(value.threadId) &&
  typeof value.openedAt === 'number' &&
  Number.isFinite(value.openedAt) &&
  value.openedAt > 0 &&
  (value.summaryText === undefined || typeof value.summaryText === 'string');

const normalizeRecentThreadSummaryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sortRecentThreads = (entries: RecentThreadItem[]): RecentThreadItem[] =>
  [...entries].sort((left, right) => right.openedAt - left.openedAt);

const trimRecentThreads = (entries: RecentThreadItem[]): RecentThreadItem[] =>
  sortRecentThreads(entries).slice(0, MAX_RECENT_THREADS);

const sanitizeRecentThreads = (value: unknown): RecentThreadItem[] => {
  if (
    !isRecord(value) ||
    value.v !== RECENT_THREADS_STORE_VERSION ||
    !Array.isArray(value.entries)
  ) {
    return [];
  }

  const deduped = new Map<string, RecentThreadItem>();

  sortRecentThreads(value.entries.filter(isRecentThreadItem)).forEach((entry) => {
    const key = `${entry.roomId}|${entry.threadId}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  });

  return Array.from(deduped.values()).slice(0, MAX_RECENT_THREADS);
};

const serializeRecentThreads = (entries: RecentThreadItem[]): RecentThreadsStore => ({
  v: RECENT_THREADS_STORE_VERSION,
  entries,
});

// A thread of an encrypted room is stored without its text, which the list reads again from the
// thread's events (P2-e2ee-F011).
const withoutEncryptedRoomText = (
  userId: string,
  entries: RecentThreadItem[]
): RecentThreadItem[] =>
  entries.map((entry) =>
    entry.summaryText !== undefined && isEncryptedRoomOf(userId, entry.roomId)
      ? { roomId: entry.roomId, threadId: entry.threadId, openedAt: entry.openedAt }
      : entry
  );

const getStoreKey = (userId: string): string => `${RECENT_THREADS}:${userId}`;

const createRecentThreadsAtom = (userId: string): RecentThreadsAtom => {
  const storeKey = getStoreKey(userId);

  const baseRecentThreadsAtom = atomWithLocalStorage<RecentThreadItem[]>(
    storeKey,
    (key) => sanitizeRecentThreads(getLocalStorageItem<unknown | null>(key, null)),
    (key, value) =>
      setLocalStorageItem(key, serializeRecentThreads(withoutEncryptedRoomText(userId, value)))
  );

  const recentThreadsAtom = atom<RecentThreadItem[], [RecentThreadsAction], undefined>(
    (get) => get(baseRecentThreadsAtom),
    (get, set, action) => {
      const current = get(baseRecentThreadsAtom);

      if (action.type === 'REMOVE') {
        const next = current.filter(
          (entry) => entry.roomId !== action.roomId || entry.threadId !== action.threadId
        );
        if (next.length === current.length) return;
        set(baseRecentThreadsAtom, next);
        return;
      }

      if (action.type === 'REKEY') {
        if (!action.roomId || !action.threadId || !action.nextThreadId) return;
        if (!isConfirmedMatrixEventId(action.nextThreadId)) return;
        if (action.threadId === action.nextThreadId) return;

        const existingEntry = current.find(
          (entry) => entry.roomId === action.roomId && entry.threadId === action.threadId
        );
        if (!existingEntry) return;

        const canonicalEntry = current.find(
          (entry) => entry.roomId === action.roomId && entry.threadId === action.nextThreadId
        );
        const openedAt = Math.max(existingEntry.openedAt, canonicalEntry?.openedAt ?? 0);
        const next = current.filter(
          (entry) =>
            entry.roomId !== action.roomId ||
            (entry.threadId !== action.threadId && entry.threadId !== action.nextThreadId)
        );

        next.push({
          roomId: action.roomId,
          threadId: action.nextThreadId,
          openedAt,
          summaryText:
            normalizeRecentThreadSummaryText(existingEntry.summaryText) ??
            normalizeRecentThreadSummaryText(canonicalEntry?.summaryText),
        });

        set(baseRecentThreadsAtom, trimRecentThreads(next));
        return;
      }

      if (!action.roomId || !isConfirmedMatrixEventId(action.threadId)) return;

      const openedAt =
        typeof action.openedAt === 'number' &&
        Number.isFinite(action.openedAt) &&
        action.openedAt > 0
          ? action.openedAt
          : Date.now();
      const existingEntry = current.find(
        (entry) => entry.roomId === action.roomId && entry.threadId === action.threadId
      );
      const next = current.filter(
        (entry) => entry.roomId !== action.roomId || entry.threadId !== action.threadId
      );

      next.push({
        roomId: action.roomId,
        threadId: action.threadId,
        openedAt,
        summaryText:
          normalizeRecentThreadSummaryText(action.summaryText) ??
          normalizeRecentThreadSummaryText(existingEntry?.summaryText),
      });

      set(baseRecentThreadsAtom, trimRecentThreads(next));
    }
  );

  return recentThreadsAtom;
};

const recentThreadsRegistry = createUserScopedAtomRegistry<RecentThreadsAtom>({
  create: createRecentThreadsAtom,
  getStorageKey: getStoreKey,
});

export const makeRecentThreadsAtom = recentThreadsRegistry.getOrCreate;

const getResolvedRecentThreadsAtom = (): RecentThreadsAtom | undefined => {
  const userId = getActiveSession()?.userId;
  return recentThreadsRegistry.resolveActiveOrCreate(userId);
};

export const bumpRecentThread = (
  roomId: string,
  threadId: string,
  openedAt?: number,
  summaryText?: string
) => {
  const recentThreadsAtom = getResolvedRecentThreadsAtom();
  if (!recentThreadsAtom) return;

  getImperativeJotaiStore().set(recentThreadsAtom, {
    type: 'BUMP',
    roomId,
    threadId,
    openedAt,
    summaryText,
  });
};

export const removeRecentThread = (roomId: string, threadId: string) => {
  const recentThreadsAtom = getResolvedRecentThreadsAtom();
  if (!recentThreadsAtom) return;

  getImperativeJotaiStore().set(recentThreadsAtom, {
    type: 'REMOVE',
    roomId,
    threadId,
  });
};

export const rekeyRecentThread = (roomId: string, threadId: string, nextThreadId: string) => {
  const recentThreadsAtom = getResolvedRecentThreadsAtom();
  if (!recentThreadsAtom) return;

  getImperativeJotaiStore().set(recentThreadsAtom, {
    type: 'REKEY',
    roomId,
    threadId,
    nextThreadId,
  });
};

/** Deletes the text an older version stored for the threads of the account's encrypted rooms. */
export const forgetEncryptedRecentThreadText = (userId: string) => {
  const storeKey = getStoreKey(userId);
  const stored = sanitizeRecentThreads(getLocalStorageItem<unknown | null>(storeKey, null));
  const kept = withoutEncryptedRoomText(userId, stored);
  if (kept.every((entry, index) => entry === stored[index])) return;
  setLocalStorageItem(storeKey, serializeRecentThreads(kept));
};

export const clearRecentThreadsStore = (userId: string) => {
  recentThreadsRegistry.clear(userId);
};
