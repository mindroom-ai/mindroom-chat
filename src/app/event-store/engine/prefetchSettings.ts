import { atom } from 'jotai';
import {
  loadMindroomSettings,
  saveMindroomSettings,
  sanitizeMindroomSettings,
  type MindroomSettings,
} from './prefetchSettingsStorage';

export type { MindroomSettings } from './prefetchSettingsStorage';

const baseMindroomSettingsAtom = atom<MindroomSettings>(loadMindroomSettings());

export const mindroomSettingsAtom = atom<MindroomSettings, [MindroomSettings], undefined>(
  (get) => get(baseMindroomSettingsAtom),
  (_get, set, update) => {
    const next = sanitizeMindroomSettings(update);
    set(baseMindroomSettingsAtom, next);
    saveMindroomSettings(next);
  }
);
