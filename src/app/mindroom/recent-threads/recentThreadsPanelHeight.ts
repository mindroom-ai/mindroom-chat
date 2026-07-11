import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { isRecord } from '../../utils/isRecord';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';

const RECENT_THREADS_PANEL_HEIGHT = 'recentThreadsPanelHeight';
const RECENT_THREADS_PANEL_HEIGHT_STORE_VERSION = 1;

export const RECENT_THREADS_PANEL_DEFAULT_HEIGHT = 200;
export const RECENT_THREADS_PANEL_MIN_HEIGHT = 80;
export const RECENT_THREADS_PANEL_COLLAPSED_HEIGHT = 32;

type RecentThreadsPanelHeightStore = {
  v: typeof RECENT_THREADS_PANEL_HEIGHT_STORE_VERSION;
  height: number;
};

type RecentThreadsPanelHeightAtom = WritableAtom<number, [number], undefined>;

const normalizePanelHeight = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return RECENT_THREADS_PANEL_DEFAULT_HEIGHT;
  }

  return Math.round(value);
};

const sanitizeStoredPanelHeight = (value: unknown): number => {
  if (!isRecord(value) || value.v !== RECENT_THREADS_PANEL_HEIGHT_STORE_VERSION) {
    return RECENT_THREADS_PANEL_DEFAULT_HEIGHT;
  }

  return normalizePanelHeight(value.height);
};

const serializePanelHeight = (height: number): RecentThreadsPanelHeightStore => ({
  v: RECENT_THREADS_PANEL_HEIGHT_STORE_VERSION,
  height,
});

const getStoreKey = (userId: string): string => `${RECENT_THREADS_PANEL_HEIGHT}:${userId}`;

const createRecentThreadsPanelHeightAtom = (userId: string): RecentThreadsPanelHeightAtom => {
  const storeKey = getStoreKey(userId);

  const baseRecentThreadsPanelHeightAtom = atomWithLocalStorage<number>(
    storeKey,
    (key) => sanitizeStoredPanelHeight(getLocalStorageItem<unknown | null>(key, null)),
    (key, value) => setLocalStorageItem(key, serializePanelHeight(normalizePanelHeight(value)))
  );

  const recentThreadsPanelHeightAtom = atom<number, [number], undefined>(
    (get) => get(baseRecentThreadsPanelHeightAtom),
    (_get, set, nextHeight) => {
      set(baseRecentThreadsPanelHeightAtom, normalizePanelHeight(nextHeight));
    }
  );

  return recentThreadsPanelHeightAtom;
};

const recentThreadsPanelHeightRegistry = createUserScopedAtomRegistry<RecentThreadsPanelHeightAtom>(
  {
    create: createRecentThreadsPanelHeightAtom,
    getStorageKey: getStoreKey,
  }
);

export const makeRecentThreadsPanelHeightAtom = recentThreadsPanelHeightRegistry.getOrCreate;

export const clearRecentThreadsPanelHeightStore = (userId: string) => {
  recentThreadsPanelHeightRegistry.clear(userId);
};
