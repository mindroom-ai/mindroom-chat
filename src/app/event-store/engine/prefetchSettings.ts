import { atom } from 'jotai';
import { setConfiguredCacheStoreByteBudget } from '../cache/db/cacheStoreSchema';
import {
  loadPrefetchSettings,
  savePrefetchSettings,
  sanitizePrefetchSettings,
  type PrefetchSettings,
} from './prefetchSettingsStorage';

export type { PrefetchSettings } from './prefetchSettingsStorage';

const initial = loadPrefetchSettings();
setConfiguredCacheStoreByteBudget(initial.cacheBudgetBytes);

const basePrefetchSettingsAtom = atom<PrefetchSettings>(initial);

export const prefetchSettingsAtom = atom<PrefetchSettings, [PrefetchSettings], undefined>(
  (get) => get(basePrefetchSettingsAtom),
  (_get, set, update) => {
    const next = sanitizePrefetchSettings(update);
    setConfiguredCacheStoreByteBudget(next.cacheBudgetBytes);
    set(basePrefetchSettingsAtom, next);
    savePrefetchSettings(next);
  }
);
