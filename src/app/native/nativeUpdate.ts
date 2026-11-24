import { setAppUpdate } from '../config/appUpdate';
import type { DesktopUpdateCheckResult } from '../lib/desktopBridge';
import { desktopBridge } from '../lib/nativeShell';

// The Electron Mac app's updater (electron-updater) downloads and stages each release by itself.
// The page asks on start, visibility changes, shell update-status pushes, and once a minute while
// shown so staged updates surface right away and survive page reloads.

/** How often a shown page asks whether an update is staged. */
export const NATIVE_UPDATE_POLL_MS = 60_000;

/** Available in the packaged Electron Mac app's main window. */
export const isNativeUpdateAvailable = (): boolean => Boolean(desktopBridge()?.update);

const syncStagedVersion = (version: string | undefined, install: () => Promise<void>): void => {
  setAppUpdate(typeof version === 'string' && version ? { version, install } : undefined);
};

/** Triggers a native update check and syncs any staged version into appUpdate.ts. */
export const checkNativeUpdate = async (): Promise<DesktopUpdateCheckResult> => {
  const source = desktopBridge()?.update;
  if (!source) return { outcome: 'error' };
  let result: DesktopUpdateCheckResult;
  try {
    result = await source.check();
  } catch {
    return { outcome: 'error' };
  }
  if (result.outcome !== 'error') {
    syncStagedVersion(result.version, () => source.install());
  }
  return result;
};

/**
 * Asks the app for its staged update when the page starts, when it is shown again, when the main
 * process pushes an update-status event, and once a minute while shown, and offers it through
 * appUpdate.ts. Returns a function that stops it.
 */
export const watchNativeUpdate = (target: Window = window): (() => void) => {
  const bridge = desktopBridge();
  const source = bridge?.update;
  if (!source) return () => undefined;
  const check = () => {
    if (target.document.visibilityState === 'hidden') return;
    source.status().then(
      ({ version }) => syncStagedVersion(version, () => source.install()),
      () => undefined
    );
  };
  check();
  target.document.addEventListener('visibilitychange', check);
  const stopShellEvents =
    typeof bridge.onShellEvent === 'function'
      ? bridge.onShellEvent((event) => {
          if (event.type === 'update-status') check();
        })
      : undefined;
  const interval = target.setInterval(check, NATIVE_UPDATE_POLL_MS);
  return () => {
    target.document.removeEventListener('visibilitychange', check);
    stopShellEvents?.();
    target.clearInterval(interval);
  };
};
