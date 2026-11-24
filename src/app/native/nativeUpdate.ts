import { setAppUpdate } from '../config/appUpdate';
import { desktopBridge } from '../lib/nativeShell';

// The Electron Mac app's updater (electron-updater) downloads and stages each release by itself.
// The page asks it, rather than being told: a page that starts or reloads after the update was
// staged simply asks. The price is up to a minute before the card shows.

/** How often a shown page asks whether an update is staged. */
export const NATIVE_UPDATE_POLL_MS = 60_000;

/** Available in the packaged Electron Mac app's main window. */
export const isNativeUpdateAvailable = (): boolean => Boolean(desktopBridge()?.update);

/**
 * Asks the app for its staged update when the page starts, when it is shown again and once a
 * minute while shown, and offers it through appUpdate.ts. Returns a function that stops it.
 */
export const watchNativeUpdate = (target: Window = window): (() => void) => {
  const source = desktopBridge()?.update;
  if (!source) return () => undefined;
  const check = () => {
    if (target.document.visibilityState === 'hidden') return;
    source.status().then(
      ({ version }) =>
        setAppUpdate(
          typeof version === 'string' && version
            ? { version, install: () => source.install() }
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
