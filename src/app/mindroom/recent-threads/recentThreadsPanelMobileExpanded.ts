import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { isRecord } from '../../utils/isRecord';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';

const RECENT_THREADS_PANEL_MOBILE_EXPANDED = 'recentThreadsPanelMobileExpanded';
const RECENT_THREADS_PANEL_MOBILE_EXPANDED_STORE_VERSION = 1;

type RecentThreadsPanelMobileExpandedStore = {
  expanded: boolean;
  v: typeof RECENT_THREADS_PANEL_MOBILE_EXPANDED_STORE_VERSION;
};

type RecentThreadsPanelMobileExpandedAtom = WritableAtom<boolean, [boolean], undefined>;

const normalizePanelMobileExpanded = (value: unknown): boolean => value === true;

const sanitizeStoredPanelMobileExpanded = (value: unknown): boolean => {
  if (!isRecord(value) || value.v !== RECENT_THREADS_PANEL_MOBILE_EXPANDED_STORE_VERSION) {
    return false;
  }

  return normalizePanelMobileExpanded(value.expanded);
};

const serializePanelMobileExpanded = (
  expanded: boolean
): RecentThreadsPanelMobileExpandedStore => ({
  expanded,
  v: RECENT_THREADS_PANEL_MOBILE_EXPANDED_STORE_VERSION,
});

const getStoreKey = (userId: string): string => `${RECENT_THREADS_PANEL_MOBILE_EXPANDED}:${userId}`;

const createRecentThreadsPanelMobileExpandedAtom = (
  userId: string
): RecentThreadsPanelMobileExpandedAtom => {
  const storeKey = getStoreKey(userId);

  const baseRecentThreadsPanelMobileExpandedAtom = atomWithLocalStorage<boolean>(
    storeKey,
    (key) => sanitizeStoredPanelMobileExpanded(getLocalStorageItem<unknown | null>(key, null)),
    (key, value) =>
      setLocalStorageItem(key, serializePanelMobileExpanded(normalizePanelMobileExpanded(value)))
  );

  const recentThreadsPanelMobileExpandedAtom = atom<boolean, [boolean], undefined>(
    (get) => get(baseRecentThreadsPanelMobileExpandedAtom),
    (_get, set, nextExpanded) => {
      set(baseRecentThreadsPanelMobileExpandedAtom, normalizePanelMobileExpanded(nextExpanded));
    }
  );

  return recentThreadsPanelMobileExpandedAtom;
};

const recentThreadsPanelMobileExpandedRegistry =
  createUserScopedAtomRegistry<RecentThreadsPanelMobileExpandedAtom>({
    create: createRecentThreadsPanelMobileExpandedAtom,
    getStorageKey: getStoreKey,
  });

export const makeRecentThreadsPanelMobileExpandedAtom =
  recentThreadsPanelMobileExpandedRegistry.getOrCreate;

export const clearRecentThreadsPanelMobileExpandedStore = (userId: string) => {
  recentThreadsPanelMobileExpandedRegistry.clear(userId);
};
