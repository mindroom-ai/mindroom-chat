/**
 * Device-wide client preferences, stored as one JSON object under the `settings` key.
 * Only the fields below belong here; MindRoom-specific preferences have their own store.
 */
import { atom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';
import { isRecord } from '../utils/isRecord';

const SETTINGS_STORAGE_KEY = 'settings';

/** How timeline messages are laid out; stored as the number. */




}

/** Vertical gap between messages, as a folds space token. */
export type MessageSpacing = '0' | '100' | '200' | '300' | '400' | '500';

const MESSAGE_SPACINGS: readonly MessageSpacing[] = ['0', '100', '200', '300', '400', '500'];

/** Page zoom in percent. */
export const PAGE_ZOOM_MIN = 50;
export const PAGE_ZOOM_MAX = 150;
export const PAGE_ZOOM_DEFAULT = 100;

export type Settings = {
  /** Theme used when `useSystemTheme` is off. */









  /** Send read receipts and typing notices privately. */
  hideActivity: boolean;
  /** Whether the members drawer is open on wide screens. */











  /** dayjs format for dates in the timeline. */
  dateFormatString: string;
  threadBannerCollapsed: boolean;





};

const DEFAULT_SETTINGS: Settings = {




  pageZoom: PAGE_ZOOM_DEFAULT,







  messageLayout: MessageLayout.Modern,









  threadBannerCollapsed: false,





};

type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const BOOLEAN_SETTING_KEYS: readonly BooleanSettingKey[] = [
  'useSystemTheme',
  'twitterEmoji',
  'isMarkdown',
  'enterForNewline',
  'hideActivity',
  'isPeopleDrawer',
  'hideMembershipEvents',
  'hideNickAvatarEvents',
  'showHiddenEvents',
  'mediaAutoLoad',
  'urlPreview',
  'encUrlPreview',
  'hour24Clock',
  'threadBannerCollapsed',
  'showNotifications',
  'isNotificationSounds',
  'developerTools',
];

const sanitizeZoom = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PAGE_ZOOM_DEFAULT;
  return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, Math.round(value)));
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isMessageLayout = (value: unknown): value is MessageLayout =>
  value === MessageLayout.Modern ||
  value === MessageLayout.Compact ||
  value === MessageLayout.Bubble;

/** The settings in `value`, with defaults for missing or invalid fields and unknown fields dropped. */
export const sanitizeSettings = (value: unknown): Settings => {
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
  };
  // A stored value of another type counts by its truthiness, so `null` or `0` turns a setting off.
  BOOLEAN_SETTING_KEYS.forEach((key) => {
    const stored = record[key];
    if (stored !== undefined) settings[key] = Boolean(stored);
  });
  return settings;
};

/** Reads the stored settings; never throws. */
export const getSettings = (): Settings => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), SETTINGS_STORAGE_KEY);
  if (raw === null) return sanitizeSettings(undefined);
  try {
    return sanitizeSettings(JSON.parse(raw));
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

export const settingsAtom = atom<Settings, [Settings], void>(
  (get) => {
    const settings = get(storedSettingsAtom);
    return settings === NOT_LOADED ? getSettings() : settings;
  },
  (_get, set, settings) => {
    const next = sanitizeSettings(settings);
    set(storedSettingsAtom, next);
    setSettings(next);
  }
);
