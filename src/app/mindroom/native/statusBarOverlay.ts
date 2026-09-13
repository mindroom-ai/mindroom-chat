import { StatusBar } from '@capacitor/status-bar';

import { isNativeIOS } from './nativeSso';

let splashOverlayRefCount = 0;

export const acquireSplashOverlay = (): void => {
  if (!isNativeIOS()) return;

  splashOverlayRefCount += 1;
  if (splashOverlayRefCount !== 1) return;

  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
};

export const releaseSplashOverlay = (): void => {
  if (!isNativeIOS()) return;
  if (splashOverlayRefCount === 0) return;

  splashOverlayRefCount -= 1;
  if (splashOverlayRefCount !== 0) return;

  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
};
