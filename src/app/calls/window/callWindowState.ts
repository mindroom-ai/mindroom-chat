import type { Atom, WritableAtom } from 'jotai';
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  BAR_HEIGHT,
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  clampToViewport,
  fitToViewport,
  isBar,
  type ViewportSize,
  type WindowRect,
} from './callWindowGeometry';
import { DEFAULT_TRANSCRIPT_SPLIT, clampSplit, isTranscriptSplit } from './transcriptLayout';

export type CallWindowMode = 'floating' | 'docked';
export type CallWindowSettings = {
  mode: CallWindowMode;
  rect?: WindowRect;
  /**
   * The viewport `rect` was placed in. The window fits `rect` from it to the viewport it shows in,
   * also after a reload or Dock and Float, and an expand from outside the window grows the bar
   * from there; a rectangle stored without it counts as placed in the viewport that reads it.
   */
  placedIn?: ViewportSize;
  expandedHeight?: number;
  /** The live transcript shows inside the window (in calls MindRoom transcribes). */
  transcript?: boolean;
  /** The stage's share of the window body beside the transcript, 0.25 to 0.8. */
  transcriptSplit?: number;
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

const normalizeViewport = (value: unknown): ViewportSize | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { width, height } = value as Record<string, unknown>;
  return isPositive(width) && isPositive(height) ? { width, height } : undefined;
};

/** Anything malformed gives the defaults; a bad rectangle or height is dropped on its own. */
export const normalizeCallWindowSettings = (value: unknown): CallWindowSettings => {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const stored = value as Record<string, unknown>;
  if (stored.mode !== 'floating' && stored.mode !== 'docked') return { ...DEFAULT_SETTINGS };
  const settings: CallWindowSettings = { mode: stored.mode };
  const rect = normalizeRect(stored.rect);
  if (rect) settings.rect = rect;
  const placedIn = rect && normalizeViewport(stored.placedIn);
  if (placedIn) settings.placedIn = placedIn;
  const height = stored.expandedHeight;
  if (typeof height === 'number' && Number.isFinite(height) && height >= MIN_HEIGHT) {
    settings.expandedHeight = height;
  }
  if (typeof stored.transcript === 'boolean') settings.transcript = stored.transcript;
  if (isTranscriptSplit(stored.transcriptSplit)) settings.transcriptSplit = stored.transcriptSplit;
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

/**
 * Views of one account's settings for readers that do not place the window: they render again
 * when what they read changes, not on every move or resize. `expand` turns a stored bar back into
 * the window and answers whether there was a bar.
 */
type SettingsViews = {
  mode: WritableAtom<CallWindowMode, [CallWindowMode], void>;
  minimized: Atom<boolean>;
  expand: WritableAtom<null, [], boolean>;
  transcript: WritableAtom<boolean, [boolean], void>;
  split: WritableAtom<number, [number], void>;
};

const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight });

const views = new WeakMap<CallWindowSettingsAtom, SettingsViews>();

const viewsOf = (settingsAtom: CallWindowSettingsAtom): SettingsViews => {
  const known = views.get(settingsAtom);
  if (known) return known;
  const made: SettingsViews = {
    mode: atom(
      (get) => get(settingsAtom).mode,
      (get, set, mode: CallWindowMode) => set(settingsAtom, { ...get(settingsAtom), mode })
    ),
    minimized: atom((get) => {
      const { mode, rect } = get(settingsAtom);
      return mode === 'floating' && !!rect && isBar(rect);
    }),
    expand: atom(null, (get, set) => {
      const settings = get(settingsAtom);
      const viewport = readViewport();
      const bar = shownRect(settings, viewport);
      if (!bar || !isBar(bar)) return false;
      set(settingsAtom, expandedSettings(settings, bar, viewport));
      return true;
    }),
    // The bar shows no transcript, so showing it gives a minimized window its height back.
    transcript: atom(
      (get) => get(settingsAtom).transcript === true,
      (get, set, shown: boolean) => {
        const settings = { ...get(settingsAtom), transcript: shown };
        const viewport = readViewport();
        const rect = shownRect(settings, viewport);
        const bar = shown && rect && isBar(rect) ? rect : undefined;
        set(settingsAtom, bar ? expandedSettings(settings, bar, viewport) : settings);
      }
    ),
    split: atom(
      (get) => get(settingsAtom).transcriptSplit ?? DEFAULT_TRANSCRIPT_SPLIT,
      (get, set, split: number) =>
        set(settingsAtom, { ...get(settingsAtom), transcriptSplit: clampSplit(split) })
    ),
  };
  views.set(settingsAtom, made);
  return made;
};

const useSettingsViews = (): SettingsViews =>
  viewsOf(getCallWindowSettingsAtom(useMatrixClient().getSafeUserId()));

/** Where the account's call view shows on desktop, and a way to change it. */
export const useCallWindowMode = () => useAtom(useSettingsViews().mode);

/**
 * Whether the call view floats in its window here: on desktop (every screen but a phone's) while
 * the account has not docked it. Otherwise it shows in its room's side panel.
 */
export const useCallViewFloats = (): boolean => {
  const desktop = useScreenSizeContext() !== ScreenSize.Mobile;
  const [mode] = useCallWindowMode();
  return desktop && mode === 'floating';
};

/**
 * Dock and Float move the call view to the other place, where it mounts anew, and the rail's call
 * button opens the floating window or brings it out of its bar: the focus their button had goes
 * to the title bar there (`to`) rather than to the page or staying on the rail. `from` is that
 * button, which may stay a moment while the docked panel it was in moves out.
 */
export type FocusHandOff = { to: 'window' | 'panel'; from: Element | null };
export const focusHandOffAtom = atom<FocusHandOff | undefined>(undefined);

/** Whether the account's floating window is minimized to its bar. */
export const useCallWindowMinimized = (): boolean => useAtomValue(useSettingsViews().minimized);

/** Gives a window minimized to its bar its height back; answers whether it was a bar. */
export const useExpandCallWindow = (): (() => boolean) => useSetAtom(useSettingsViews().expand);

/**
 * Whether the account's floating window shows the live transcript; set true, it also expands a
 * window minimized to its bar.
 */
export const getCallWindowTranscriptAtom = (userId: string) =>
  viewsOf(getCallWindowSettingsAtom(userId)).transcript;

/** The stage's share of the window body beside the live transcript (60 percent until moved). */
export const getCallWindowSplitAtom = (userId: string) =>
  viewsOf(getCallWindowSettingsAtom(userId)).split;

/**
 * Where the stored rectangle shows in `viewport`, in the window and for an expand from outside
 * it: fitted from the viewport it was placed in, so it keeps its distance to the nearer edges.
 */
export const shownRect = (
  settings: CallWindowSettings,
  viewport: ViewportSize
): WindowRect | undefined =>
  settings.rect && fitToViewport(settings.rect, settings.placedIn ?? viewport, viewport);

/**
 * The bar keeps the bottom edge of the window as it shows (`rect`, in `viewport`), and the old
 * height is remembered for the way back.
 */
export const minimizedSettings = (
  settings: CallWindowSettings,
  rect: WindowRect,
  viewport: ViewportSize
): CallWindowSettings => ({
  ...settings,
  rect: { ...rect, y: rect.y + rect.height - BAR_HEIGHT, height: BAR_HEIGHT },
  placedIn: viewport,
  expandedHeight: isBar(rect) ? settings.expandedHeight : rect.height,
});

/**
 * Grows upward from the bottom edge of the bar as it shows (`rect`, in `viewport`) to the
 * remembered height, then fits the viewport.
 */
export const expandedSettings = (
  settings: CallWindowSettings,
  rect: WindowRect,
  viewport: ViewportSize
): CallWindowSettings => {
  const height = settings.expandedHeight ?? DEFAULT_HEIGHT;
  const grown = { ...rect, y: rect.y + rect.height - height, height };
  return { ...settings, rect: clampToViewport(grown, viewport), placedIn: viewport };
};
