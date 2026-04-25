import {
  MINDROOM_APP_NAME,
  MINDROOM_CINNY_SOURCE_URL,
  MINDROOM_DEVICE_DISPLAY_NAME,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
} from '../branding/branding';
import {
  buildNativeSsoRedirectUrl,
  isNativeIOS,
  openNativeSsoBrowser,
} from '../native/nativeSso';
import {
  isMindroomHomeserver,
  shouldDisablePasswordLogin,
  shouldUseSsoOnlyRegistration,
} from './authPolicy';

export const MINDROOM_AUTH_BRANDING = {
  appName: MINDROOM_APP_NAME,
  cinnySourceUrl: MINDROOM_CINNY_SOURCE_URL,
  deviceDisplayName: MINDROOM_DEVICE_DISPLAY_NAME,
  logoAlt: MINDROOM_LOGO_ALT,
  logoSrc: MINDROOM_LOGO_SRC,
} as const;

export const getMindroomAuthSsoRedirectUrl = (webRedirectUrl: string): string =>
  isNativeIOS() ? buildNativeSsoRedirectUrl(webRedirectUrl) : webRedirectUrl;

export {
  isMindroomHomeserver,
  isNativeIOS,
  openNativeSsoBrowser,
  shouldDisablePasswordLogin,
  shouldUseSsoOnlyRegistration,
};
