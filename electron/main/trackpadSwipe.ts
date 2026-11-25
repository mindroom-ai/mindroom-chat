import fs from 'node:fs';
import path from 'node:path';
import { app, systemPreferences } from 'electron';
import type { DesktopShellEvent } from '../../src/app/lib/desktopBridge';

export const TRACKPAD_SWIPE_ADDON_NAME = 'mindroom-trackpad-swipe.node';

export type TrackpadSwipePhase = 'begin' | 'end' | 'cancel';
export type TrackpadSwipeStatus = { attached: boolean; warning?: string };
export type AttachNativeMonitor = (
  nativeWindowHandle: Buffer,
  onPhase: (phase: TrackpadSwipePhase) => void
) => () => void;

export type TrackpadSwipeWindow = {
  isDestroyed(): boolean;
  getNativeWindowHandle(): Buffer;
  on(event: 'focus', listener: () => void): unknown;
  on(event: 'swipe', listener: (event: unknown, direction: string) => void): unknown;
  once(event: 'closed', listener: () => void): unknown;
  webContents: {
    send(channel: string, payload: DesktopShellEvent): void;
    on(event: 'did-finish-load', listener: () => void): unknown;
  };
};

type NativeTrackpadSwipeAddon = { attach: AttachNativeMonitor };

const addonCache = new Map<string, NativeTrackpadSwipeAddon>();
let statusRecorder: ((status: TrackpadSwipeStatus) => void) | undefined;

export const setTrackpadSwipeRecorder = (
  recorder: ((status: TrackpadSwipeStatus) => void) | undefined
): void => {
  statusRecorder = recorder;
};

export const resolveTrackpadSwipeAddonPath = (options: {
  isPackaged: boolean;
  resourcesPath: string;
  unpackagedDir: string;
}): string =>
  options.isPackaged
    ? path.join(options.resourcesPath, TRACKPAD_SWIPE_ADDON_NAME)
    : path.join(options.unpackagedDir, TRACKPAD_SWIPE_ADDON_NAME);

const loadNativeAddon = (addonPath: string): NativeTrackpadSwipeAddon => {
  const cached = addonCache.get(addonPath);
  if (cached) return cached;
  if (!fs.existsSync(addonPath)) throw new Error(`Missing native addon at ${addonPath}`);
  const mod: { exports: Partial<NativeTrackpadSwipeAddon> } = { exports: {} };
  process.dlopen(mod, addonPath);
  if (typeof mod.exports.attach !== 'function') {
    throw new Error(`Invalid trackpad swipe addon at ${addonPath}: missing attach()`);
  }
  const addon = mod.exports as NativeTrackpadSwipeAddon;
  addonCache.set(addonPath, addon);
  return addon;
};

/** Forwards macOS native trackpad scroll phases and discrete AppKit swipes to the renderer. */
export const attachTrackpadSwipe = (
  win: TrackpadSwipeWindow,
  options: {
    platform?: NodeJS.Platform;
    isSwipeTrackingEnabled?: () => boolean;
    addonPath?: string;
    attachNativeMonitor?: AttachNativeMonitor;
    warn?: (message: string, error?: unknown) => void;
  } = {}
): void => {
  if ((options.platform ?? process.platform) !== 'darwin' || win.isDestroyed()) return;
  const isEnabled =
    options.isSwipeTrackingEnabled ??
    (() => systemPreferences.isSwipeTrackingFromScrollEventsEnabled());
  const warn = options.warn ?? console.warn;
  const send = (payload: DesktopShellEvent): void => {
    if (!win.isDestroyed()) win.webContents.send('desktop:shell-event', payload);
  };

  let attached = false;
  const sync = (): boolean => {
    if (win.isDestroyed()) return false;
    const enabled = attached && isEnabled();
    win.webContents.send('desktop:shell-event', { type: 'swipe-tracking', enabled });
    return enabled;
  };
  win.webContents.on('did-finish-load', sync);
  win.on('focus', sync);
  win.on('swipe', (_e, direction) => {
    if (direction === 'left' || direction === 'right') send({ type: 'swipe', direction });
  });

  const onPhase = (phase: TrackpadSwipePhase): void => {
    if (phase === 'begin') {
      if (sync()) send({ type: 'scroll-gesture', phase: 'begin' });
    } else {
      send({ type: 'scroll-gesture', phase });
    }
  };

  try {
    const attachMonitor: AttachNativeMonitor =
      options.attachNativeMonitor ??
      ((handle, cb) => {
        const addonPath =
          options.addonPath ??
          resolveTrackpadSwipeAddonPath({
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            unpackagedDir: path.resolve(__dirname),
          });
        return loadNativeAddon(addonPath).attach(handle, cb);
      });
    const detach = attachMonitor(win.getNativeWindowHandle(), onPhase);
    attached = true;
    statusRecorder?.({ attached: true });
    win.once('closed', () => {
      try {
        detach();
      } catch {
        // Best-effort monitor teardown on window close.
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `[trackpad-swipe] Native scroll-phase monitor unavailable; two-finger swipe disabled (${detail})`;
    warn(message, error);
    statusRecorder?.({ attached: false, warning: message });
  }
};
