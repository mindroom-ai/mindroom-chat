import type { WritableAtom } from 'jotai';
import { useAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  BAR_HEIGHT,
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  clampToViewport,
  isBar,
  type ViewportSize,
  type WindowRect,
} from './callWindowGeometry';

export type CallWindowMode = 'floating' | 'docked';
export type CallWindowSettings = {
  mode: CallWindowMode;
  rect?: WindowRect;
  expandedHeight?: number;
};

const DEFAULT_SETTINGS: CallWindowSettings = { mode: 'floating' };

export const callWindowStorageKey = (userId: string): string => `mindroom.callWindow:${userId}`;

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const normalizeRect = (value: unknown): WindowRect | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  // A position may be zero or negative while a window is dragged past an edge, so only its size must be positive.
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
  if (typeof y !== 'number' || !Number.isFinite(y)) return undefined;
  if (!isPositive(width) || !isPositive(height)) return undefined;
  return { x, y, width, height };
};

/** Anything malformed gives the defaults; a bad rectangle or height is dropped on its own. */
export const normalizeCallWindowSettings = (value: unknown): CallWindowSettings => {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const stored = value as Record<string, unknown>;
  if (stored.mode !== 'floating' && stored.mode !== 'docked') return { ...DEFAULT_SETTINGS };
  const settings: CallWindowSettings = { mode: stored.mode };
  const rect = normalizeRect(stored.rect);
  if (rect) settings.rect = rect;
  const height = stored.expandedHeight;
  if (typeof height === 'number' && Number.isFinite(height) && height >= MIN_HEIGHT) {
    settings.expandedHeight = height;
  }
  return settings;
};

type CallWindowSettingsAtom = WritableAtom<CallWindowSettings, [CallWindowSettings], void>;

const createSettingsAtom = (userId: string): CallWindowSettingsAtom =>
  atomWithLocalStorage<CallWindowSettings>(
    callWindowStorageKey(userId),
    (key) => normalizeCallWindowSettings(getLocalStorageItem<unknown>(key, undefined)),
    (key, value) => {
      setLocalStorageItem(key, value);
    }
  );

const registry = createUserScopedAtomRegistry<CallWindowSettingsAtom>({
  create: createSettingsAtom,
  getStorageKey: callWindowStorageKey,
});

/** The account's call window settings, kept in localStorage; one atom per account. */
export const getCallWindowSettingsAtom = registry.getOrCreate;

/** Forgets the account's window settings, in memory and in localStorage (sign-out, account removal). */
export const clearCallWindowStore = (userId: string): void => {
  registry.clear(userId);
};

export const useCallWindowSettings = (): readonly [
  CallWindowSettings,
  (next: CallWindowSettings) => void
] => {
  const userId = useMatrixClient().getSafeUserId();
  return useAtom(getCallWindowSettingsAtom(userId));
};

/** The bar keeps the window's bottom edge, and the old height is remembered for the way back. */
export const minimizedSettings = (
  settings: CallWindowSettings,
  rect: WindowRect
): CallWindowSettings => ({
  ...settings,
  rect: { ...rect, y: rect.y + rect.height - BAR_HEIGHT, height: BAR_HEIGHT },
  expandedHeight: isBar(rect) ? settings.expandedHeight : rect.height,
});

/** Grows upward from the bar's bottom edge to the remembered height, then fits the viewport. */
export const expandedSettings = (
  settings: CallWindowSettings,
  rect: WindowRect,
  viewport: ViewportSize
): CallWindowSettings => {
  const height = settings.expandedHeight ?? DEFAULT_HEIGHT;
  const grown = { ...rect, y: rect.y + rect.height - height, height };
  return { ...settings, rect: clampToViewport(grown, viewport) };
};
