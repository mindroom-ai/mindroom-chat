import { atom } from 'jotai';
import {
  loadPrefetchSettings,
  savePrefetchSettings,
  sanitizePrefetchSettings,
  type PrefetchSettings,
} from './prefetchSettingsStorage';

export type { PrefetchSettings } from './prefetchSettingsStorage';

const basePrefetchSettingsAtom = atom<PrefetchSettings>(loadPrefetchSettings());

export const prefetchSettingsAtom = atom<PrefetchSettings, [PrefetchSettings], undefined>(
  (get) => get(basePrefetchSettingsAtom),
  (_get, set, update) => {
    const next = sanitizePrefetchSettings(update);
    set(basePrefetchSettingsAtom, next);
    savePrefetchSettings(next);
  }
);
