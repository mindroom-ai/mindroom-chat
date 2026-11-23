import { atom } from 'jotai';
import { getSafeLocalStorage, getStorageItemSafe } from '../../lib/safeLocalStorage';
import { setConfiguredCacheStoreByteBudget } from '../cache/db/cacheStoreSchema';
import {
  MINDROOM_SETTINGS_STORAGE_KEY,
  loadPrefetchSettings,
  savePrefetchSettings,
  sanitizePrefetchSettings,
  type PrefetchSettings,
} from './prefetchSettingsStorage';

export type { PrefetchSettings } from './prefetchSettingsStorage';

const readStoredRaw = (): string | null =>
  getStorageItemSafe(getSafeLocalStorage(), MINDROOM_SETTINGS_STORAGE_KEY);

// Raw stored text last read or written by this tab, so mounting avoids
// clobbering an in-memory value that storage refused to persist.
let seenRaw: string | null = null;

const readAndSync = (): PrefetchSettings => {
  const next = loadPrefetchSettings();
  seenRaw = readStoredRaw();
  setConfiguredCacheStoreByteBudget(next.cacheBudgetBytes);
  return next;
};

const basePrefetchSettingsAtom = atom<PrefetchSettings>(readAndSync());

basePrefetchSettingsAtom.onMount = (setValue) => {
  if (readStoredRaw() !== seenRaw) {
    setValue(readAndSync());
  }
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return undefined;
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MINDROOM_SETTINGS_STORAGE_KEY) return;
    if (event.storageArea && event.storageArea !== getSafeLocalStorage()) return;
    setValue(readAndSync());
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', handleStorage);
    }
  };
};

export const prefetchSettingsAtom = atom<PrefetchSettings, [PrefetchSettings], undefined>(
  (get) => get(basePrefetchSettingsAtom),
  (_get, set, update) => {
    const next = sanitizePrefetchSettings(update);
    setConfiguredCacheStoreByteBudget(next.cacheBudgetBytes);
    set(basePrefetchSettingsAtom, next);
    savePrefetchSettings(next);
    seenRaw = readStoredRaw();
  }
);
