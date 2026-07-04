import { atom, type WritableAtom } from 'jotai';
import { type Settings, settingsAtom } from '../../state/settings';
import { DEFAULT_PAGINATION_LIMIT, sanitizePaginationLimit } from '../threads/preloadSettings';
import {
  DEFAULT_PREFETCH_SCOPE,
  type PrefetchScope,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from '../engine/prefetchPolicy';

// CINNY-207 P6.1: transitional settings shape. `paginationLimit` is the
// legacy field being retired (D4); `prefetchScope` and `prefetchDepth`
// are the D4-native replacements. Both sets coexist for exactly one
// commit so the surrounding tree stays green while consumers migrate;
// Commit 4 removes paginationLimit + adds a one-time localStorage
// scrub so no stored value survives the upgrade.
export type MindroomSettings = Settings & {
  paginationLimit: number;
  prefetchScope: PrefetchScope;
  prefetchDepth: number;
};

type SettingsWithMindroomValues = Settings & {
  paginationLimit?: unknown;
  prefetchScope?: unknown;
  prefetchDepth?: unknown;
};

export const withMindroomSettings = (settings: Settings): MindroomSettings => {
  const raw = settings as SettingsWithMindroomValues;
  return {
    ...settings,
    paginationLimit: sanitizePaginationLimit(raw.paginationLimit ?? DEFAULT_PAGINATION_LIMIT),
    prefetchScope: sanitizePrefetchScope(raw.prefetchScope ?? DEFAULT_PREFETCH_SCOPE),
    prefetchDepth: sanitizePrefetchDepth(raw.prefetchDepth),
  };
};

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
