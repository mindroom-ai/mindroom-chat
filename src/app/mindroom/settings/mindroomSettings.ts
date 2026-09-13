import { atom, type WritableAtom } from 'jotai';
import { type Settings, settingsAtom } from '../../state/settings';
import { DEFAULT_PAGINATION_LIMIT, sanitizePaginationLimit } from '../threads/preloadSettings';

export type MindroomSettings = Settings & {
  paginationLimit: number;
};

type SettingsWithMindroomValues = Settings & {
  paginationLimit?: unknown;
};

export const withMindroomSettings = (settings: Settings): MindroomSettings => ({
  ...settings,
  paginationLimit: sanitizePaginationLimit(
    (settings as SettingsWithMindroomValues).paginationLimit ?? DEFAULT_PAGINATION_LIMIT
  ),
});

const genericSettingsAtom = settingsAtom as unknown as WritableAtom<
  MindroomSettings,
  [MindroomSettings],
  undefined
>;

export const mindroomSettingsAtom = atom<MindroomSettings, [MindroomSettings], undefined>(
  (get) => withMindroomSettings(get(settingsAtom)),
  (_get, set, update) => {
    set(genericSettingsAtom, withMindroomSettings(update));
  }
);
