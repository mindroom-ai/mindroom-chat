import { atom, type WritableAtom } from 'jotai';
import { type Settings, settingsAtom } from '../../state/settings';
import {
  DEFAULT_PREFETCH_SCOPE,
  type PrefetchScope,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from '../engine/prefetchPolicy';

// CINNY-207 P6.1 / D4 (Commit 4): the legacy `paginationLimit` field is
// gone from the MindRoom settings shape. `prefetchScope` and
// `prefetchDepth` are the new user-facing settings; stored legacy
// values are dropped (`dropLegacyMindroomSettings` scrub, imported from
// the app entry BEFORE state/settings.ts initializes) rather than
// mapped onto `prefetchDepth` — the two settings have incompatible
// semantics (the old one was an eager preload target of any positive
// integer, the new one is a clamped [200, 10000] scrollback depth
// with a different default) and the safer thing is to drop.
export type MindroomSettings = Settings & {
  prefetchScope: PrefetchScope;
  prefetchDepth: number;
};

type SettingsWithMindroomValues = Settings & {
  prefetchScope?: unknown;
  prefetchDepth?: unknown;
  paginationLimit?: unknown;
};

export const withMindroomSettings = (settings: Settings): MindroomSettings => {
  // Destructure-omit the legacy key: even if it survived somewhere in
  // an in-memory Settings snapshot (a plugin, a stale test fixture),
  // we never propagate it forward. The stored-value scrub below covers
  // the persistence side.
  const { paginationLimit: _dropped, ...rest } = settings as SettingsWithMindroomValues;
  void _dropped;
  const raw = rest as SettingsWithMindroomValues;
  return {
    ...rest,
    prefetchScope: sanitizePrefetchScope(raw.prefetchScope ?? DEFAULT_PREFETCH_SCOPE),
    prefetchDepth: sanitizePrefetchDepth(raw.prefetchDepth),
  } as MindroomSettings;
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

// CINNY-207 P6.1 / D4 (Commit 4): `dropLegacyMindroomSettings` lives
// in `mindroomSettingsBootstrap.ts` — a leaf module with NO transitive
// import of `state/settings.ts` — so the app entry can call it BEFORE
// the settings atom initializes.
