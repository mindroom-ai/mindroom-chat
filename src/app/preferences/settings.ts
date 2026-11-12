/**
 * Client preferences, stored on this device as one JSON object under the `settings` key.
 * Only the fields below belong here; MindRoom-specific preferences have their own store.
 * A few of them follow the account to every device (`roamingSettings.ts`): `settingsAtom` shows
 * the account's value for those, and `getSettings()` this device's own.
 */
import { atom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { isRecord } from '../lib/isRecord';
import {
  keepDeviceRoamingSettings,
  overlayRoamingSettings,
  pendingRoamingSettingsAtom,
  roamingAccountContentAtom,
  roamingEdits,
  savePendingRoamingSettings,
} from './roamingSettings';

const SETTINGS_STORAGE_KEY = 'settings';

/** How timeline messages are laid out; stored as the number. */
export enum MessageLayout {
  Modern = 0, // Avatar and name beside each group of messages.
  Compact = 1, // Time, name and body on one line.
  Bubble = 2, // Chat bubbles, own messages on the right.
}

/** Vertical gap between messages, as a folds space token. */
const MESSAGE_SPACINGS = ['0', '100', '200', '300', '400', '500'] as const;
export type MessageSpacing = (typeof MESSAGE_SPACINGS)[number];

/** Page zoom in percent. */
export const PAGE_ZOOM_MIN = 50;
export const PAGE_ZOOM_MAX = 150;
export const PAGE_ZOOM_DEFAULT = 100;

/** The on/off settings, in the order of the settings pages that show them. */
const BOOLEAN_SETTING_KEYS = [
  // Appearance
  'useSystemTheme', // Follow the operating system's light or dark preference.
  // Composer
  'isMarkdown', // Parse Markdown in sent messages.
  'enterForNewline', // Enter inserts a line break and Ctrl+Enter sends, instead of the reverse.
  // Privacy
  'hideActivity', // Send read receipts and typing notices privately.
  // Layout
  'isPeopleDrawer', // Whether the members drawer is open on wide screens.
  // Timeline
  'hideMembershipEvents', // Leave joins, leaves, invites and kicks out of the timeline.
  'hideNickAvatarEvents', // Leave display name and avatar changes out of the timeline.
  'showHiddenEvents', // Show events the timeline normally hides, for debugging.
  'mediaAutoLoad', // Load images and videos without a click.
  'urlPreview', // Show link previews in unencrypted rooms.
  'encUrlPreview', // Show link previews in encrypted rooms too; the homeserver then sees the links.
  'threadBannerCollapsed',
  'simpleThreadFilters', // The room's thread filter bar offers only the count, Unresolved and the sort.
  'hideThreadFilterBar', // The room header's filter button hid the thread filter bar.
  'showToolCalls', // Agent replies list the tools they ran; the room menu switches it too.
  // Keyboard
  'shortcutHints', // Holding Command or Ctrl for a second shows the shortcut keys on the buttons.
  // Notifications
  'showNotifications', // Desktop notifications for new messages.
  'isNotificationSounds', // Play a sound with each notification.
  // Developer
  'developerTools', // Developer options in the settings and message menus.
  // About
  'sendErrorReports', // Send error reports to the collector config.json names, if it names one.
] as const;

type BooleanSettingKey = (typeof BOOLEAN_SETTING_KEYS)[number];

/** `themeId` applies while `useSystemTheme` is off; the other two are the system's light and dark picks. */
type ThemePicks = Partial<Record<'themeId' | 'lightThemeId' | 'darkThemeId', string>>;

type MessageDisplay = { messageLayout: MessageLayout; messageSpacing: MessageSpacing };

export type Settings = Record<BooleanSettingKey, boolean> &
  ThemePicks &
  MessageDisplay & {
    /** Page zoom in percent, between `PAGE_ZOOM_MIN` and `PAGE_ZOOM_MAX`. */
    pageZoom: number;
    /** dayjs format for dates in the timeline. */
    dateFormatString: string;
    /**
     * Times as 13:00 instead of 1:00 PM; unset, times follow the app language's clock
     * (`useHour24Clock`).
     */
    hour24Clock?: boolean;
  };

/** The on/off settings that start on; every other one starts off. */
const ON_BY_DEFAULT: readonly BooleanSettingKey[] = [
  'useSystemTheme',
  'isMarkdown',
  'isPeopleDrawer',
  'hideNickAvatarEvents',
  'mediaAutoLoad',
  'urlPreview',
  'showNotifications',
  'isNotificationSounds',
  'simpleThreadFilters',
  'showToolCalls',
  'shortcutHints',
  'sendErrorReports',
];

const DEFAULT_BOOLEANS = Object.fromEntries(
  BOOLEAN_SETTING_KEYS.map((key) => [key, ON_BY_DEFAULT.includes(key)])
) as Record<BooleanSettingKey, boolean>;

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_BOOLEANS,
  pageZoom: PAGE_ZOOM_DEFAULT,
  messageLayout: MessageLayout.Modern,
  messageSpacing: '400',
  dateFormatString: 'D MMM YYYY',
};

/** A whole zoom percentage inside the supported range; anything not a finite number is the default. */
export const sanitizeZoom = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const percent = Math.round(value);
    if (percent < PAGE_ZOOM_MIN) return PAGE_ZOOM_MIN;
    return percent > PAGE_ZOOM_MAX ? PAGE_ZOOM_MAX : percent;
  }
  return PAGE_ZOOM_DEFAULT;
};

/** Optional string settings treat an empty string like an unset one. */
const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  return value;
};

const isMessageLayout = (value: unknown): value is MessageLayout =>
  value === MessageLayout.Modern ||
  value === MessageLayout.Compact ||
  value === MessageLayout.Bubble;

/** The settings in `value`, with defaults for missing or invalid fields and unknown fields dropped. */
const sanitizeSettings = (value: unknown): Settings => {
  const record = isRecord(value) ? value : {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    themeId: optionalString(record.themeId),
    lightThemeId: optionalString(record.lightThemeId),
    darkThemeId: optionalString(record.darkThemeId),
    pageZoom: sanitizeZoom(record.pageZoom),
    messageLayout: isMessageLayout(record.messageLayout)
      ? record.messageLayout
      : DEFAULT_SETTINGS.messageLayout,
    messageSpacing: MESSAGE_SPACINGS.includes(record.messageSpacing as MessageSpacing)
      ? (record.messageSpacing as MessageSpacing)
      : DEFAULT_SETTINGS.messageSpacing,
    dateFormatString:
      typeof record.dateFormatString === 'string'
        ? record.dateFormatString
        : DEFAULT_SETTINGS.dateFormatString,
    hour24Clock: typeof record.hour24Clock === 'boolean' ? record.hour24Clock : undefined,
  };
  // A stored value of another type counts by its truthiness, so `null` or `0` turns a setting off.
  BOOLEAN_SETTING_KEYS.forEach((key) => {
    const stored = record[key];
    if (stored !== undefined) settings[key] = Boolean(stored);
  });
  return settings;
};

/**
 * The stored settings. Until the clock followed the language, every device stored the 24-hour
 * clock as off by default, so a stored off is no choice; a choice made while signed in is the
 * account's (roamingSettings.ts), where off stays off.
 */
const readStoredSettings = (stored: unknown): Settings => {
  const settings = sanitizeSettings(stored);
  return settings.hour24Clock === false ? { ...settings, hour24Clock: undefined } : settings;
};

/** Reads the stored settings; never throws. */
export const getSettings = (): Settings => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), SETTINGS_STORAGE_KEY);
  if (raw === null) return sanitizeSettings(undefined);
  try {
    return readStoredSettings(JSON.parse(raw));
  } catch {
    return sanitizeSettings(undefined);
  }
};

/** Stores the settings; `false` when storage refused the write. */
export const setSettings = (settings: Settings): boolean =>
  setStorageItemSafe(
    getSafeLocalStorage(),
    SETTINGS_STORAGE_KEY,
    JSON.stringify(sanitizeSettings(settings))
  );

const NOT_LOADED = Symbol('not loaded');
const storedSettingsAtom = atom<Settings | typeof NOT_LOADED>(NOT_LOADED);

storedSettingsAtom.onMount = (setValue) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return undefined;
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SETTINGS_STORAGE_KEY) setValue(getSettings());
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', handleStorage);
    }
  };
};

/**
 * The settings the app applies: this device's, with the account's values and this device's unsent
 * edits over the roaming ones (`roamingSettings.ts`).
 */
export const settingsAtom = atom<Settings, [Settings], void>(
  (get) => {
    const stored = get(storedSettingsAtom);
    return overlayRoamingSettings(
      stored === NOT_LOADED ? getSettings() : stored,
      get(roamingAccountContentAtom),
      get(pendingRoamingSettingsAtom).values
    );
  },
  (get, set, settings) => {
    const next = sanitizeSettings(settings);
    const pending = get(pendingRoamingSettingsAtom);
    let device = next;
    // Signed in, a changed roaming setting becomes a pending edit of the account, and the device
    // keeps the value it had; signed out, every setting is this device's.
    if (pending.storageKey !== undefined) {
      const stored = get(storedSettingsAtom);
      device = keepDeviceRoamingSettings(next, stored === NOT_LOADED ? getSettings() : stored);
      const edits = roamingEdits(get(settingsAtom), next);
      if (Object.keys(edits).length > 0) {
        const values = { ...pending.values, ...edits };
        set(pendingRoamingSettingsAtom, { storageKey: pending.storageKey, values });
        savePendingRoamingSettings(pending.storageKey, values);
      }
    }
    set(storedSettingsAtom, device);
    setSettings(device);
  }
);
