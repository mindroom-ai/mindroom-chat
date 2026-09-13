import { WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';
import { getActiveSession } from './sessions';
import { isRecord } from '../utils/isRecord';
import { getImperativeJotaiStore } from './jotaiStore';

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

let activeRecentThreadsPanelHeightAtom: RecentThreadsPanelHeightAtom | undefined;
const recentThreadsPanelHeightAtoms = new Map<string, RecentThreadsPanelHeightAtom>();

export const makeRecentThreadsPanelHeightAtom = (userId: string): RecentThreadsPanelHeightAtom => {
  const existingAtom = recentThreadsPanelHeightAtoms.get(userId);
  if (existingAtom) return existingAtom;

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

  recentThreadsPanelHeightAtoms.set(userId, recentThreadsPanelHeightAtom);
  return recentThreadsPanelHeightAtom;
};

export const registerRecentThreadsPanelHeightAtom = (
  recentThreadsPanelHeightAtom: RecentThreadsPanelHeightAtom
) => {
  activeRecentThreadsPanelHeightAtom = recentThreadsPanelHeightAtom;

  return () => {
    if (activeRecentThreadsPanelHeightAtom === recentThreadsPanelHeightAtom) {
      activeRecentThreadsPanelHeightAtom = undefined;
    }
  };
};

const getResolvedRecentThreadsPanelHeightAtom = (): RecentThreadsPanelHeightAtom | undefined => {
  if (activeRecentThreadsPanelHeightAtom) return activeRecentThreadsPanelHeightAtom;

  const userId = getActiveSession()?.userId;
  return userId ? makeRecentThreadsPanelHeightAtom(userId) : undefined;
};

export const setRecentThreadsPanelHeight = (height: number) => {
  const recentThreadsPanelHeightAtom = getResolvedRecentThreadsPanelHeightAtom();
  if (!recentThreadsPanelHeightAtom) return;

  getImperativeJotaiStore().set(recentThreadsPanelHeightAtom, height);
};

export const clearRecentThreadsPanelHeightStore = (userId: string) => {
  const recentThreadsPanelHeightAtom = recentThreadsPanelHeightAtoms.get(userId);
  if (activeRecentThreadsPanelHeightAtom === recentThreadsPanelHeightAtom) {
    activeRecentThreadsPanelHeightAtom = undefined;
  }

  recentThreadsPanelHeightAtoms.delete(userId);
  localStorage.removeItem(getStoreKey(userId));
};
