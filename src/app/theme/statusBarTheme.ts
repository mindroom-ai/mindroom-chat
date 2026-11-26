import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import { isNativeAndroid, isNativeIOS } from '../native/nativeSso';

const ANDROID_STATUS_BAR_COLORS = {
  dark: '#1A1A1A',
  light: '#FFFFFF',
} as const;

export const syncNativeStatusBarTheme = (scheme: 'light' | 'dark'): void => {
  const style = scheme === 'dark' ? Style.Dark : Style.Light;

  if (isNativeIOS()) {
    // MindRoomBridgeViewController leaves the background to the web safe area.
    // Only the native clock and status icons need to follow the active theme.
    StatusBar.setStyle({ style }).catch(() => undefined);
    return;
  }

  if (isNativeAndroid()) {
    // SystemBars controls icon contrast for both status and navigation bars on Android 7-16.
    const systemBarsStyle = scheme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
    SystemBars.setStyle({ style: systemBarsStyle }).catch(() => undefined);
    StatusBar.setStyle({ style }).catch(() => undefined);
    // On API 35/36 edge-to-edge this is a deprecated no-op; catch errors silently.
    StatusBar.setBackgroundColor({ color: ANDROID_STATUS_BAR_COLORS[scheme] }).catch(
      () => undefined
    );
  }
};
