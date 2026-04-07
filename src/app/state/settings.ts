import { atom } from 'jotai';

const STORAGE_KEY = 'settings';

export const DEFAULT_PAGINATION_LIMIT = 10000;
export const MIN_PAGINATION_LIMIT = 50;
export const THREAD_BATCH_SIZE = 200;
export const PAGE_ZOOM_MIN = 50;
export const PAGE_ZOOM_MAX = 150;
export const PAGE_ZOOM_DEFAULT = 100;

export const sanitizePaginationLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGINATION_LIMIT;
  return Math.max(Math.trunc(value), MIN_PAGINATION_LIMIT);
};

const sanitizeStoredPageZoom = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PAGE_ZOOM_DEFAULT;
  return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, Math.round(value)));
};

export type DateFormat = 'D MMM YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY/MM/DD' | '';
export type MessageSpacing = '0' | '100' | '200' | '300' | '400' | '500';
export enum MessageLayout {
  Modern = 0,
  Compact = 1,
  Bubble = 2,
}

export interface Settings {
  themeId?: string;
  useSystemTheme: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
  monochromeMode?: boolean;
  isMarkdown: boolean;
  editorToolbar: boolean;
  twitterEmoji: boolean;
  pageZoom: number;
  hideActivity: boolean;

  isPeopleDrawer: boolean;
  memberSortFilterIndex: number;
  enterForNewline: boolean;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  mediaAutoLoad: boolean;
  urlPreview: boolean;
  encUrlPreview: boolean;
  showHiddenEvents: boolean;
  legacyUsernameColor: boolean;

  showNotifications: boolean;
  isNotificationSounds: boolean;

  hour24Clock: boolean;
  dateFormatString: string;

  paginationLimit: number;

  developerTools: boolean;
}

const defaultSettings: Settings = {
  themeId: undefined,
  useSystemTheme: true,
  lightThemeId: undefined,
  darkThemeId: undefined,
  monochromeMode: false,
  isMarkdown: true,
  editorToolbar: false,
  twitterEmoji: false,
  pageZoom: PAGE_ZOOM_DEFAULT,
  hideActivity: false,

  isPeopleDrawer: true,
  memberSortFilterIndex: 0,
  enterForNewline: false,
  messageLayout: 0,
  messageSpacing: '400',
  hideMembershipEvents: false,
  hideNickAvatarEvents: true,
  mediaAutoLoad: true,
  urlPreview: true,
  encUrlPreview: false,
  showHiddenEvents: false,
  legacyUsernameColor: false,

  showNotifications: true,
  isNotificationSounds: true,

  hour24Clock: false,
  dateFormatString: 'D MMM YYYY',

  paginationLimit: DEFAULT_PAGINATION_LIMIT,

  developerTools: false,
};

export const getSettings = () => {
  if (typeof localStorage === 'undefined') return defaultSettings;
  if (typeof localStorage.getItem !== 'function') return defaultSettings;

  const settings = localStorage.getItem(STORAGE_KEY);
  if (settings === null) return defaultSettings;
  const merged = {
    ...defaultSettings,
    ...(JSON.parse(settings) as Settings),
  };
  merged.pageZoom = sanitizeStoredPageZoom(merged.pageZoom);
  merged.paginationLimit = sanitizePaginationLimit(merged.paginationLimit);
  return merged;
};

export const setSettings = (settings: Settings) => {
  if (typeof localStorage === 'undefined') return;
  if (typeof localStorage.setItem !== 'function') return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const baseSettings = atom<Settings>(getSettings());
export const settingsAtom = atom<Settings, [Settings], undefined>(
  (get) => get(baseSettings),
  (get, set, update) => {
    set(baseSettings, update);
    setSettings(update);
  }
);
