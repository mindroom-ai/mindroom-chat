import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { isRecord } from '../../lib/isRecord';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import {
  COMPACT_THREAD_SECTION_ORDER,
  normalizeCompactSectionOrder,
  type CompactThreadSectionId,
} from './compactThreadSections';

const COMPACT_ROOM_SECTIONS = 'compactRoomSections';
const COMPACT_ROOM_SECTIONS_VERSION = 3;

/**
 * Whether Compact rooms show their cards in sections (Needs you, Working, Later, Quiet, Done),
 * whether wide views transpose those sections into columns, which sections are folded, and their
 * display order. One choice for the account in every room, where the filters and the sort the
 * filter bar sets are kept per room.
 */
export type CompactRoomSections = {
  on: boolean;
  columns: boolean;
  folded: CompactThreadSectionId[];
  order: CompactThreadSectionId[];
};

export type CompactRoomSectionsAction =
  | { type: 'SET_ON'; on: boolean }
  | { type: 'SET_COLUMNS'; columns: boolean }
  | { type: 'TOGGLE_FOLD'; id: CompactThreadSectionId }
  | { type: 'REORDER_SECTIONS'; order: readonly CompactThreadSectionId[] };

type CompactRoomSectionsAtom = WritableAtom<CompactRoomSections, [CompactRoomSectionsAction], void>;

/** Off, as the cards always showed; Quiet and Done start folded, as in the sidebar. */
export const DEFAULT_COMPACT_ROOM_SECTIONS: CompactRoomSections = {
  on: false,
  columns: false,
  folded: ['quiet', 'done'],
  order: [...COMPACT_THREAD_SECTION_ORDER],
};

const storeKey = (userId: string): string => `${COMPACT_ROOM_SECTIONS}:${userId}`;

const isSectionId = (value: unknown): value is CompactThreadSectionId =>
  COMPACT_THREAD_SECTION_ORDER.some((id) => id === value);

const readSections = (key: string): CompactRoomSections => {
  const stored = getLocalStorageItem<unknown>(key, null);
  if (!isRecord(stored)) return DEFAULT_COMPACT_ROOM_SECTIONS;
  const validFolded = Array.isArray(stored.folded)
    ? stored.folded.filter(isSectionId)
    : DEFAULT_COMPACT_ROOM_SECTIONS.folded;
  // v2 introduced explicit Quiet folding; v1 storage folds Quiet by default on migration.
  const version = typeof stored.v === 'number' ? stored.v : 1;
  const folded =
    version >= 2
      ? [...new Set(validFolded)]
      : [...new Set<CompactThreadSectionId>(['quiet', ...validFolded])];
  const on = stored.on === true;
  return {
    on,
    columns: on && stored.columns === true,
    folded,
    order: normalizeCompactSectionOrder(stored.order),
  };
};

const reduce = (
  current: CompactRoomSections,
  action: CompactRoomSectionsAction
): CompactRoomSections => {
  if (action.type === 'SET_ON') return { ...current, on: action.on, columns: false };
  if (action.type === 'SET_COLUMNS') {
    return action.columns
      ? { ...current, on: true, columns: true }
      : { ...current, on: false, columns: false };
  }
  if (action.type === 'REORDER_SECTIONS') {
    return { ...current, order: normalizeCompactSectionOrder(action.order) };
  }
  const folded = current.folded.includes(action.id)
    ? current.folded.filter((id) => id !== action.id)
    : [...current.folded, action.id];
  return { ...current, folded };
};

const createSectionsAtom = (userId: string): CompactRoomSectionsAtom => {
  const valueAtom = userId
    ? atomWithLocalStorage<CompactRoomSections>(storeKey(userId), readSections, (key, value) => {
        setLocalStorageItem(key, { v: COMPACT_ROOM_SECTIONS_VERSION, ...value });
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
