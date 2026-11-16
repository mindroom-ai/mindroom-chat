import { type WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { isRecord } from '../../lib/isRecord';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { parseCrossRoomThreadIndexKey } from './crossRoomThreadIndex';

const THREAD_SIDEBAR_PREFERENCES = 'threadSidebarPreferences';
const THREAD_SIDEBAR_PREFERENCES_VERSION = 1;
const MAX_PINNED_SIDEBAR_THREADS = 50;

/** Recent: one list by latest activity. Sections: Working, Snoozed, Idle and Resolved. */
export type ThreadSidebarLayout = 'recent' | 'sections';

export type ThreadSidebarPreferences = {
  pinnedThreadKeys: string[];
  layout: ThreadSidebarLayout;
};

type ThreadSidebarPreferencesStore = ThreadSidebarPreferences & {
  v: typeof THREAD_SIDEBAR_PREFERENCES_VERSION;
};

export type ThreadSidebarPreferencesAction =
  | { type: 'TOGGLE_PIN'; threadKey: string }
  | { type: 'SET_LAYOUT'; layout: ThreadSidebarLayout };

type ThreadSidebarPreferencesAtom = WritableAtom<
  ThreadSidebarPreferences,
  [ThreadSidebarPreferencesAction],
  undefined
>;

export const DEFAULT_THREAD_SIDEBAR_PREFERENCES: ThreadSidebarPreferences = {
  pinnedThreadKeys: [],
  layout: 'recent',
};

const isValidThreadKey = (value: unknown): value is string =>
  typeof value === 'string' && parseCrossRoomThreadIndexKey(value) !== undefined;

export const sanitizeThreadSidebarPreferences = (value: unknown): ThreadSidebarPreferences => {
  if (!isRecord(value) || value.v !== THREAD_SIDEBAR_PREFERENCES_VERSION) {
    return DEFAULT_THREAD_SIDEBAR_PREFERENCES;
  }

  const pinnedThreadKeys = Array.isArray(value.pinnedThreadKeys)
    ? Array.from(new Set(value.pinnedThreadKeys.filter(isValidThreadKey))).slice(
        0,
        MAX_PINNED_SIDEBAR_THREADS
      )
    : [];

  return {
    pinnedThreadKeys,
    // Preferences stored before the layout existed read as Recent, the list they showed.
    layout: value.layout === 'sections' ? 'sections' : 'recent',
  };
};

const serializeThreadSidebarPreferences = (
  preferences: ThreadSidebarPreferences
): ThreadSidebarPreferencesStore => ({
  ...preferences,
  v: THREAD_SIDEBAR_PREFERENCES_VERSION,
});

export const getThreadSidebarPreferencesStoreKey = (userId: string): string =>
  `${THREAD_SIDEBAR_PREFERENCES}:${userId}`;

const createThreadSidebarPreferencesAtom = (userId: string): ThreadSidebarPreferencesAtom => {
  const storeKey = getThreadSidebarPreferencesStoreKey(userId);
  const persistedAtom = atomWithLocalStorage<ThreadSidebarPreferences>(
    storeKey,
    (key) => sanitizeThreadSidebarPreferences(getLocalStorageItem<unknown | null>(key, null)),
    (key, preferences) => setLocalStorageItem(key, serializeThreadSidebarPreferences(preferences))
  );

  return atom<ThreadSidebarPreferences, [ThreadSidebarPreferencesAction], undefined>(
    (get) => get(persistedAtom),
    (get, set, action) => {
      const current = get(persistedAtom);
      if (action.type === 'SET_LAYOUT') {
        set(persistedAtom, { ...current, layout: action.layout });
        return;
      }

      if (!isValidThreadKey(action.threadKey)) return;
      const isPinned = current.pinnedThreadKeys.includes(action.threadKey);
      const pinnedThreadKeys = isPinned
        ? current.pinnedThreadKeys.filter((threadKey) => threadKey !== action.threadKey)
        : [action.threadKey, ...current.pinnedThreadKeys].slice(0, MAX_PINNED_SIDEBAR_THREADS);
      set(persistedAtom, { ...current, pinnedThreadKeys });
    }
  );
};

const threadSidebarPreferencesRegistry = createUserScopedAtomRegistry<ThreadSidebarPreferencesAtom>(
  {
    create: createThreadSidebarPreferencesAtom,
    getStorageKey: getThreadSidebarPreferencesStoreKey,
  }
);

export const makeThreadSidebarPreferencesAtom = threadSidebarPreferencesRegistry.getOrCreate;

export const clearThreadSidebarPreferencesStore = (userId: string): void => {
  threadSidebarPreferencesRegistry.clear(userId);
};
