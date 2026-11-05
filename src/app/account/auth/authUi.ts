import {
  MINDROOM_APP_NAME,
  MINDROOM_DEVICE_DISPLAY_NAME,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
  MINDROOM_SITE_URL,
} from '../../ui/branding/branding';
import {
  buildNativeSsoRedirectUrl,
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
} from '../../native/nativeSso';
import {
  isMindroomHomeserver,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
} from './authPolicy';

export const MINDROOM_AUTH_BRANDING = {
  appName: MINDROOM_APP_NAME,
  deviceDisplayName: MINDROOM_DEVICE_DISPLAY_NAME,
  logoAlt: MINDROOM_LOGO_ALT,
  logoSrc: MINDROOM_LOGO_SRC,
  poweredBy: [
    { label: 'MindRoom', url: MINDROOM_SITE_URL },
    { label: 'Matrix', url: 'https://matrix.org' },
  ],
} as const;

export const getMindroomAuthSsoRedirectUrl = (webRedirectUrl: string): string =>
  isNativeApp() ? buildNativeSsoRedirectUrl(webRedirectUrl) : webRedirectUrl;

export {
  isNativeApp,
  isMindroomHomeserver,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
};
