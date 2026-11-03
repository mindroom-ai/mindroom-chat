import { atom, type WritableAtom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';

/** Pixel heights of the sidebar's resizable Recently Opened panel. */
export const DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT = 320;
export const MIN_RECENTLY_OPENED_PANEL_HEIGHT = 120;
export const MAX_RECENTLY_OPENED_PANEL_HEIGHT = 960;
/** Sidebar height the panel always leaves to the header and lists above it. */
export const RECENTLY_OPENED_PANEL_RESERVED_HEIGHT = 140;

const STORE_PREFIX = 'recentlyOpenedPanelHeight';

export const getRecentlyOpenedPanelHeightStoreKey = (userId: string): string =>
  `${STORE_PREFIX}:${userId}`;

/**
 * A stored or requested height as a whole pixel count inside the allowed range. Anything that is
 * not a positive finite number means "no preference" and gives the default.
 */
export const normalizeRecentlyOpenedPanelHeight = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT;
  }
  return Math.min(
    MAX_RECENTLY_OPENED_PANEL_HEIGHT,
    Math.max(MIN_RECENTLY_OPENED_PANEL_HEIGHT, Math.round(value))
  );
};

const readStoredHeight = (key: string): number => {
  const stored = getStorageItemSafe(getSafeLocalStorage(), key);
  return normalizeRecentlyOpenedPanelHeight(stored === null ? undefined : Number(stored));
};

type PanelHeightAtom = WritableAtom<number, [number], void>;

const createPanelHeightAtom = (userId: string): PanelHeightAtom => {
  const key = getRecentlyOpenedPanelHeightStoreKey(userId);
  const heightAtom = atom(readStoredHeight(key));
  return atom(
    (get) => get(heightAtom),
    (_get, set, next: number) => {
      const height = normalizeRecentlyOpenedPanelHeight(next);
      set(heightAtom, height);
      setStorageItemSafe(getSafeLocalStorage(), key, String(height));
    }
  );
};

const registry = createUserScopedAtomRegistry<PanelHeightAtom>({
  create: createPanelHeightAtom,
  getStorageKey: getRecentlyOpenedPanelHeightStoreKey,
});

/** The account's preferred panel height, kept in localStorage; one atom per account. */
export const makeRecentlyOpenedPanelHeightAtom = registry.getOrCreate;

/** Forgets the account's preference, in memory and in localStorage (sign-out, account removal). */
export const clearRecentlyOpenedPanelHeightStore = (userId: string): void => {
  registry.clear(userId);
};
