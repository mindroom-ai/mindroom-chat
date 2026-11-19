import { Capacitor, registerPlugin } from '@capacitor/core';
import { setAppUpdate } from '../config/appUpdate';

// The Mac app's updater (Sparkle, ios/App/App/MindRoomUpdatePlugin.swift) downloads and stages each
// release by itself. The page asks it, rather than being told: a page that starts or reloads after
// the update was staged simply asks, and Capacitor neither keeps an event for a later page nor lets
// one be raised safely from another queue. The price is up to a minute before the card shows.

type MindRoomUpdatePlugin = {
  /** The staged update's version, or none. */
  status: () => Promise<{ version?: string }>;
  /** Quits the app, installs the staged update and opens it; rejects with NOT_READY without one. */
  install: () => Promise<void>;
};

/** How often a shown page asks whether an update is staged. */
export const NATIVE_UPDATE_POLL_MS = 60_000;

let updatePlugin: MindRoomUpdatePlugin | undefined;

/** Only the Developer ID Mac app's main window has the plugin. */
export const isNativeUpdateAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomUpdate');

/**
 * Asks the app for its staged update when the page starts, when it is shown again and once a
 * minute while shown, and offers it through appUpdate.ts. Returns a function that stops it.
 */
export const watchNativeUpdate = (target: Window = window): (() => void) => {
  if (!isNativeUpdateAvailable()) return () => undefined;
  updatePlugin ??= registerPlugin<MindRoomUpdatePlugin>('MindRoomUpdate');
  const plugin = updatePlugin;
  const check = () => {
    if (target.document.visibilityState === 'hidden') return;
    plugin.status().then(
      ({ version }) =>
        setAppUpdate(
          typeof version === 'string' && version
            ? { version, install: () => plugin.install() }
            : undefined
        ),
      () => undefined
    );
  };
  check();
  target.document.addEventListener('visibilitychange', check);
  const interval = target.setInterval(check, NATIVE_UPDATE_POLL_MS);
  return () => {
    target.document.removeEventListener('visibilitychange', check);
    target.clearInterval(interval);
  };
};
