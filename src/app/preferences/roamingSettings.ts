/**
 * The app settings that follow the account to every device. They are stored in the account's
 * `io.mindroom.client.settings` account data; every other app setting stays in this device's
 * `settings` entry (`settings.ts`).
 *
 * For each roaming setting, `settingsAtom` shows the first value it finds among: an edit made on
 * this device that the homeserver has not confirmed yet (pending, saved per account and device),
 * the account's value, and this device's stored value. Changing a roaming setting writes only
 * the pending edit. The device entry keeps the value it held before the setting roamed: an
 * account without a value gets it on the first sync (`matrix/hooks/useBindRoamingSettings.ts`),
 * and every account on this device sees it until its own account has one.
 *
 * The event belongs to this client alone. `io.mindroom.settings` is written by other MindRoom
 * clients too, which may replace its content whole. The content is flat: `version`, the
 * `Settings` keys below, and `rev` and `base_rev`: each write's revision and the revision of the
 * content it patched (`matrix/hooks/useBindRoamingSettings.ts`).
 * - Readers take only those keys, each with its exact type, and only from content of their own
 *   version.
 * - Writers put a patch over the stored content, so keys from a later build survive, and leave
 *   content of a later version alone.
 *
 * Nothing outside React reads a roaming setting: `getSettings()` (the theme before sign-in, the
 * error reporter) returns this device's own values.
 */
import { atom } from 'jotai';
import type { Settings } from './settings';
import { isRecord } from '../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  getStorageKeysSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';

export const ROAMING_SETTINGS_EVENT_TYPE = 'io.mindroom.client.settings';

/** The content format. A change that readers of this one must not read takes a higher number. */
export const ROAMING_SETTINGS_VERSION = 1;

/** The longest date format the account stores. */
export const DATE_FORMAT_MAX_LENGTH = 100;

/**
 * The roaming settings: the settings registry id of each one's tile, and its key in `Settings`
 * and in the event. Never add an endpoint, a token, a URL, an opt-in that sends more to a server
 * (`encUrlPreview`), or a setting read before sign-in (the theme, `sendErrorReports`).
 */
export const ROAMING_SETTINGS = {
  markdown: 'isMarkdown',
  enterForNewline: 'enterForNewline',
  hideMembershipEvents: 'hideMembershipEvents',
  hideNickAvatarEvents: 'hideNickAvatarEvents',
  urlPreview: 'urlPreview',
  hideActivity: 'hideActivity',
  hour24Clock: 'hour24Clock',
  dateFormat: 'dateFormatString',
} as const satisfies Record<string, keyof Settings>;

type RoamingKey = (typeof ROAMING_SETTINGS)[keyof typeof ROAMING_SETTINGS];

export type RoamingSettings = Pick<Settings, RoamingKey>;

export const ROAMING_KEYS: readonly RoamingKey[] = Object.values(ROAMING_SETTINGS);

const isRoamingValue = (key: RoamingKey, value: unknown): boolean =>
  key === 'dateFormatString'
    ? typeof value === 'string' && value !== '' && value.length <= DATE_FORMAT_MAX_LENGTH
    : typeof value === 'boolean';

/** The entries of `values` whose key passes `keep`, in the order of `ROAMING_KEYS`. */
const pick = (
  values: Readonly<Record<string, unknown>>,
  keep: (key: RoamingKey) => boolean
): Partial<RoamingSettings> =>
  Object.fromEntries(
    ROAMING_KEYS.filter((key) => key in values && keep(key)).map((key) => [key, values[key]])
  ) as Partial<RoamingSettings>;

/** The roaming values in `record`, each of the exact type it takes; anything else is left out. */
const pickRoamingSettings = (record: Readonly<Record<string, unknown>>): Partial<RoamingSettings> =>
  pick(record, (key) => isRoamingValue(key, record[key]));

/** The account's roaming values in the event's `content`; none from content of another version. */
export const readRoamingSettings = (content: unknown): Partial<RoamingSettings> =>
  isRecord(content) && content.version === ROAMING_SETTINGS_VERSION
    ? pickRoamingSettings(content)
    : {};

/**
 * The content to store: `patch` over `content`, whose other keys stay, at this version.
 * `undefined` over content of a later version, which this client leaves alone.
 */
export const mergeRoamingSettings = (
  content: unknown,
  patch: Partial<RoamingSettings>
): Record<string, unknown> | undefined => {
  const stored = isRecord(content) ? content : {};
  if (typeof stored.version === 'number' && stored.version > ROAMING_SETTINGS_VERSION) {
    return undefined;
  }
  return { ...stored, ...patch, version: ROAMING_SETTINGS_VERSION };
};

/** `device` with the account's values over it, and this device's unsent edits over those. */
export const overlayRoamingSettings = (
  device: Settings,
  accountContent: unknown,
  pending: Partial<RoamingSettings>
): Settings => ({ ...device, ...readRoamingSettings(accountContent), ...pending });

/** `next` with the roaming values of `device`: what the device entry stores after a write. */
export const keepDeviceRoamingSettings = (next: Settings, device: Settings): Settings => ({
  ...next,
  ...pick(device, () => true),
});

/**
 * The roaming values of `next` that differ from `shown`: what a settings write changes for the
 * account. A value the account cannot store (a date format over the length cap) is left out.
 */
export const roamingEdits = (shown: Settings, next: Settings): Partial<RoamingSettings> => {
  const valid = pickRoamingSettings(next);
  return pick(valid, (key) => !Object.is(valid[key], shown[key]));
};

/** The `pending` edits whose value the account does not hold yet. */
export const unconfirmedRoamingEdits = (
  pending: Partial<RoamingSettings>,
  account: Partial<RoamingSettings>
): Partial<RoamingSettings> => pick(pending, (key) => !Object.is(pending[key], account[key]));

/** The `pending` edits left once the account holds `sent`: those changed since they were sent. */
export const remainingRoamingEdits = (
  pending: Partial<RoamingSettings>,
  sent: Partial<RoamingSettings>
): Partial<RoamingSettings> =>
  pick(pending, (key) => !(key in sent) || !Object.is(pending[key], sent[key]));

/**
 * What the first live sync of each session uploads: each of this device's values that the
 * account lacks and that differs from the default. Only non-default values go up, and every
 * privacy setting's default is its less private choice (receipts sent, link previews shown), so
 * the upload can only make other devices more private.
 */
export const roamingMigration = (
  account: Partial<RoamingSettings>,
  device: Settings,
  defaults: Settings
): Partial<RoamingSettings> => {
  const valid = pickRoamingSettings(device);
  return pick(valid, (key) => !(key in account) && !Object.is(valid[key], defaults[key]));
};

/**
 * The raw `io.mindroom.client.settings` content of the signed-in account as sync last delivered
 * it; `undefined` while unknown or when the account has none. Readers go through
 * `readRoamingSettings`.
 */
export const roamingAccountContentAtom = atom<unknown>(undefined);

/** Roaming edits of the signed-in account on this device that the homeserver has not confirmed. */
export type PendingRoamingSettings = {
  /** The localStorage key of the account and device; unset while no account is bound. */
  storageKey?: string;
  values: Partial<RoamingSettings>;
};

export const pendingRoamingSettingsAtom = atom<PendingRoamingSettings>({ values: {} });

const PENDING_KEY_PREFIX = 'roamingSettingsPending:';

/** The start of the keys of the account's pending edits, one per device. */
export const pendingRoamingSettingsKeyPrefix = (userId: string): string =>
  `${PENDING_KEY_PREFIX}${userId}:`;

/** A new login gets a new device ID, so an edit left by an earlier login never reaches a later one. */
export const pendingRoamingSettingsKey = (userId: string, deviceId: string): string =>
  `${pendingRoamingSettingsKeyPrefix(userId)}${deviceId}`;

/** The edits saved under `storageKey`, without keys that no longer roam or values of the wrong type. */
export const loadPendingRoamingSettings = (storageKey: string): Partial<RoamingSettings> => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), storageKey);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? pickRoamingSettings(parsed) : {};
  } catch {
    return {};
  }
};

export const savePendingRoamingSettings = (
  storageKey: string,
  values: Partial<RoamingSettings>
): void => {
  const storage = getSafeLocalStorage();
  if (Object.keys(values).length === 0) removeStorageItemSafe(storage, storageKey);
  else setStorageItemSafe(storage, storageKey, JSON.stringify(values));
};

/**
 * Deletes the edits saved for logins this browser no longer keeps (signed out, removed);
 * `keep` holds the storage keys of the logins it does keep. Their unsent edits are dropped.
 */
export const forgetOrphanedPendingRoamingSettings = (keep: readonly string[]): void => {
  const storage = getSafeLocalStorage();
  getStorageKeysSafe(storage)
    .filter((key) => key.startsWith(PENDING_KEY_PREFIX) && !keep.includes(key))
    .forEach((key) => removeStorageItemSafe(storage, key));
};
