import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../lib/safeLocalStorage';
import { isRecord } from '../../lib/isRecord';
import {
  DEFAULT_PREFETCH_SCOPE,
  type PrefetchScope,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from './prefetchPolicy';

const MINDROOM_SETTINGS_STORAGE_KEY = 'mindroomSettings';

const LEGACY_SETTINGS_STORAGE_KEY = 'settings';
const MINDROOM_SETTINGS_STORE_VERSION = 2;

export type PrefetchSettings = {
  prefetchScope: PrefetchScope;
  prefetchDepth: number;
};

type PrefetchSettingsStore = PrefetchSettings & {
  v: typeof MINDROOM_SETTINGS_STORE_VERSION;
};

const DEFAULT_MINDROOM_SETTINGS: PrefetchSettings = {
  prefetchScope: DEFAULT_PREFETCH_SCOPE,
  prefetchDepth: sanitizePrefetchDepth(undefined),
};

export const sanitizePrefetchSettings = (value: unknown): PrefetchSettings => {
  const record = isRecord(value) ? value : {};
  return {
    prefetchScope: sanitizePrefetchScope(record.prefetchScope),
    prefetchDepth: sanitizePrefetchDepth(record.prefetchDepth),
  };
};

const parseRecord = (raw: string | null): Record<string, unknown> | undefined => {
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const isNewerPrefetchSettingsStore = (raw: string | null): boolean => {
  const current = parseRecord(raw);
  return (
    raw !== null &&
    current !== undefined &&
    typeof current.v === 'number' &&
    current.v > MINDROOM_SETTINGS_STORE_VERSION
  );
};

const serializePrefetchSettings = (settings: PrefetchSettings): string =>
  JSON.stringify({
    v: MINDROOM_SETTINGS_STORE_VERSION,
    ...sanitizePrefetchSettings(settings),
  } satisfies PrefetchSettingsStore);

/**
 * Reads the versioned MindRoom-owned store. Until the explicit app bootstrap
 * migration runs, installations upgrading from the shared client `settings`
 * blob still hydrate the two legacy extension fields from that blob.
 */
export const loadPrefetchSettings = (
  storage: Storage | undefined = getSafeLocalStorage()
): PrefetchSettings => {
  const currentRaw = getStorageItemSafe(storage, MINDROOM_SETTINGS_STORAGE_KEY);
  if (currentRaw !== null) {
    const current = parseRecord(currentRaw);
    if (current?.v !== 1 && current?.v !== MINDROOM_SETTINGS_STORE_VERSION)
      return DEFAULT_MINDROOM_SETTINGS;
    return sanitizePrefetchSettings(current);
  }

  const legacy = parseRecord(getStorageItemSafe(storage, LEGACY_SETTINGS_STORAGE_KEY));
  return sanitizePrefetchSettings(legacy);
};

export const savePrefetchSettings = (
  settings: PrefetchSettings,
  storage: Storage | undefined = getSafeLocalStorage()
): boolean => {
  if (isNewerPrefetchSettingsStore(getStorageItemSafe(storage, MINDROOM_SETTINGS_STORAGE_KEY))) {
    return false;
  }
  return setStorageItemSafe(
    storage,
    MINDROOM_SETTINGS_STORAGE_KEY,
    serializePrefetchSettings(settings)
  );
};

const LEGACY_MINDROOM_KEYS = new Set(['paginationLimit', 'prefetchScope', 'prefetchDepth']);

/**
 * Moves fork-local settings out of the client's unversioned `settings` blob. This
 * is called explicitly during app bootstrap: importing settings modules never
 * mutates storage. A newer store version is left untouched on downgrade.
 *
 * The migration itself cleans the legacy blob only after the versioned value
 * is durably stored. Later generic client settings writes still replace their
 * owned snapshot; blocked-storage recovery remains best effort, matching the
 * fork-wide policy documented in FORK_CHANGES.md.
 */
export const migratePrefetchSettingsStorage = (
  storage: Storage | undefined = getSafeLocalStorage()
): boolean => {
  if (!storage) return false;

  if (!savePrefetchSettings(loadPrefetchSettings(storage), storage)) return false;

  const legacyRaw = getStorageItemSafe(storage, LEGACY_SETTINGS_STORAGE_KEY);
  const legacy = parseRecord(legacyRaw);
  if (!legacy || !Object.keys(legacy).some((key) => LEGACY_MINDROOM_KEYS.has(key))) return true;

  const cleaned = Object.fromEntries(
    Object.entries(legacy).filter(([key]) => !LEGACY_MINDROOM_KEYS.has(key))
  );
  setStorageItemSafe(storage, LEGACY_SETTINGS_STORAGE_KEY, JSON.stringify(cleaned));
  return true;
};
