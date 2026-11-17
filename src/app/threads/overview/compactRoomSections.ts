import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { isRecord } from '../../lib/isRecord';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { THREAD_SECTION_ORDER, type ThreadSectionId } from '../threadSections';
import type { ThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';

const COMPACT_ROOM_SECTIONS = 'compactRoomSections';

/** The filters Sections decide themselves: resolved, snoozed and idle threads have sections. */
export type SectionsFilters = Pick<ThreadFilterState, 'resolved' | 'snoozed' | 'idle'>;

/** What Sections apply of those filters: none, every such thread shows in its section. */
export const SECTIONS_SHOW_ALL: SectionsFilters = { resolved: 'any', snoozed: 'any', idle: 'any' };

/** `state` with the filters Sections decide taken from `from`. */
export const withSectionsFilters = (
  state: ThreadFilterState,
  from: SectionsFilters
): ThreadFilterState => ({
  ...state,
  resolved: from.resolved,
  snoozed: from.snoozed,
  idle: from.idle,
});

/**
 * Whether Compact rooms show their cards in sections (Working, Snoozed, Idle, Resolved), and
 * which sections are folded. One choice for the account in every room, where the sort the filter
 * bar sets is kept per room.
 */
export type CompactRoomSections = { on: boolean; folded: ThreadSectionId[] };

export type CompactRoomSectionsAction =
  | { type: 'SET_ON'; on: boolean }
  | { type: 'TOGGLE_FOLD'; id: ThreadSectionId };

type CompactRoomSectionsAtom = WritableAtom<CompactRoomSections, [CompactRoomSectionsAction], void>;

/** Off, as the cards always showed; Resolved starts folded, as in the sidebar. */
export const DEFAULT_COMPACT_ROOM_SECTIONS: CompactRoomSections = {
  on: false,
  folded: ['resolved'],
};

const storeKey = (userId: string): string => `${COMPACT_ROOM_SECTIONS}:${userId}`;

const isSectionId = (value: unknown): value is ThreadSectionId =>
  THREAD_SECTION_ORDER.some((id) => id === value);

const readSections = (key: string): CompactRoomSections => {
  const stored = getLocalStorageItem<unknown>(key, null);
  if (!isRecord(stored)) return DEFAULT_COMPACT_ROOM_SECTIONS;
  return {
    on: stored.on === true,
    folded: Array.isArray(stored.folded)
      ? [...new Set(stored.folded.filter(isSectionId))]
      : DEFAULT_COMPACT_ROOM_SECTIONS.folded,
  };
};

const reduce = (
  current: CompactRoomSections,
  action: CompactRoomSectionsAction
): CompactRoomSections => {
  if (action.type === 'SET_ON') return { ...current, on: action.on };
  const folded = current.folded.includes(action.id)
    ? current.folded.filter((id) => id !== action.id)
    : [...current.folded, action.id];
  return { ...current, folded };
};

const createSectionsAtom = (userId: string): CompactRoomSectionsAtom => {
  const valueAtom = userId
    ? atomWithLocalStorage<CompactRoomSections>(storeKey(userId), readSections, (key, value) => {
        setLocalStorageItem(key, value);
      })
    : atom(DEFAULT_COMPACT_ROOM_SECTIONS);
  return atom<CompactRoomSections, [CompactRoomSectionsAction], void>(
    (get) => get(valueAtom),
    (get, set, action) => set(valueAtom, reduce(get(valueAtom), action))
  );
};

const registry = createUserScopedAtomRegistry<CompactRoomSectionsAtom>({
  create: createSectionsAtom,
  getStorageKey: storeKey,
  cacheEmptyUserId: false,
});

/** The account's Sections choice for Compact rooms and its folded sections. */
export const getCompactRoomSectionsAtom = registry.getOrCreate;

/** Forgets the account's Sections choice, in memory and in local storage. */
export const clearCompactRoomSectionsStore = (userId: string): void => registry.clear(userId);
