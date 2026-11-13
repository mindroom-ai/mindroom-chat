import { Capacitor } from '@capacitor/core';
import { MINDROOM_DEVICE_DISPLAY_NAMES } from '../../ui/branding/branding';
import { buildNativeSsoRedirectUrl, isNativeApp } from '../../native/nativeSso';
import { isMacOS } from '../../lib/user-agent';

/**
 * The name of the session a sign-in creates, as the sessions list shows it: the app on this
 * platform. The Mac app is the iOS app built for Mac, which loads as a desktop page.
 */
export const getDeviceDisplayName = (): string => {
  if (!isNativeApp()) return MINDROOM_DEVICE_DISPLAY_NAMES.web;
  if (Capacitor.getPlatform() === 'android') return MINDROOM_DEVICE_DISPLAY_NAMES.android;
  return isMacOS() ? MINDROOM_DEVICE_DISPLAY_NAMES.macos : MINDROOM_DEVICE_DISPLAY_NAMES.ios;
};

export const getAuthSsoRedirectUrl = (webRedirectUrl: string): string =>
  isNativeApp() ? buildNativeSsoRedirectUrl(webRedirectUrl) : webRedirectUrl;
