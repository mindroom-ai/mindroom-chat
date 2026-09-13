import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { getActiveSession } from '../../state/sessions';
import { isRecord } from '../../utils/isRecord';
import { getImperativeJotaiStore } from '../../state/jotaiStore';

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

let activeRecentThreadsPanelMobileExpandedAtom: RecentThreadsPanelMobileExpandedAtom | undefined;
const recentThreadsPanelMobileExpandedAtoms = new Map<string, RecentThreadsPanelMobileExpandedAtom>();

export const makeRecentThreadsPanelMobileExpandedAtom = (
  userId: string
): RecentThreadsPanelMobileExpandedAtom => {
  const existingAtom = recentThreadsPanelMobileExpandedAtoms.get(userId);
  if (existingAtom) return existingAtom;

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

  recentThreadsPanelMobileExpandedAtoms.set(userId, recentThreadsPanelMobileExpandedAtom);
  return recentThreadsPanelMobileExpandedAtom;
};

export const registerRecentThreadsPanelMobileExpandedAtom = (
  recentThreadsPanelMobileExpandedAtom: RecentThreadsPanelMobileExpandedAtom
) => {
  activeRecentThreadsPanelMobileExpandedAtom = recentThreadsPanelMobileExpandedAtom;

  return () => {
    if (activeRecentThreadsPanelMobileExpandedAtom === recentThreadsPanelMobileExpandedAtom) {
      activeRecentThreadsPanelMobileExpandedAtom = undefined;
    }
  };
};

const getResolvedRecentThreadsPanelMobileExpandedAtom = ():
  | RecentThreadsPanelMobileExpandedAtom
  | undefined => {
  if (activeRecentThreadsPanelMobileExpandedAtom) {
    return activeRecentThreadsPanelMobileExpandedAtom;
  }

  const userId = getActiveSession()?.userId;
  return userId ? makeRecentThreadsPanelMobileExpandedAtom(userId) : undefined;
};

export const setRecentThreadsPanelMobileExpanded = (expanded: boolean) => {
  const recentThreadsPanelMobileExpandedAtom = getResolvedRecentThreadsPanelMobileExpandedAtom();
  if (!recentThreadsPanelMobileExpandedAtom) return;

  getImperativeJotaiStore().set(recentThreadsPanelMobileExpandedAtom, expanded);
};

export const clearRecentThreadsPanelMobileExpandedStore = (userId: string) => {
  const recentThreadsPanelMobileExpandedAtom = recentThreadsPanelMobileExpandedAtoms.get(userId);
  if (activeRecentThreadsPanelMobileExpandedAtom === recentThreadsPanelMobileExpandedAtom) {
    activeRecentThreadsPanelMobileExpandedAtom = undefined;
  }

  recentThreadsPanelMobileExpandedAtoms.delete(userId);
  localStorage.removeItem(getStoreKey(userId));
};
