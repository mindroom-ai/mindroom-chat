import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const NATIVE_SSO_SCHEME = 'mindroom';
const NATIVE_SSO_HOST = 'auth';
type StandaloneNavigator = Navigator & { standalone?: boolean };

const normalizePath = (path: string): string => path.replace(/\/{2,}/g, '/');

export const buildNativeSsoRedirectUrl = (webRedirectUrl: string): string => {
  const parsed = new URL(webRedirectUrl);
  return `${NATIVE_SSO_SCHEME}://${NATIVE_SSO_HOST}${parsed.pathname}${parsed.search}${parsed.hash}`;
};

const getPathFromHostlessNativeUrl = (pathname: string): string | undefined => {
  const normalizedPathname = normalizePath(pathname.startsWith('/') ? pathname : `/${pathname}`);
  const hostPrefix = `/${NATIVE_SSO_HOST}`;

  if (normalizedPathname === hostPrefix) return '/';
  if (normalizedPathname.startsWith(`${hostPrefix}/`)) {
    return normalizedPathname.slice(hostPrefix.length);
  }

  return undefined;
};

export const isNativeIOS = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

const isIOSWebPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;

  const { userAgent = '', platform = '', maxTouchPoints = 0 } = window.navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
};

export const isIOSStandaloneWebApp = (): boolean => {
  if (isNativeIOS()) return false;
  if (typeof window === 'undefined') return false;
  if (!isIOSWebPlatform()) return false;

  const standaloneDisplayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;

  return standaloneDisplayMode || (window.navigator as StandaloneNavigator).standalone === true;
};

export const openNativeSsoBrowser = async (url: string): Promise<void> => {
  await Browser.open({ url, presentationStyle: 'fullscreen' });
};

export const getAppPathFromNativeSsoUrl = (incomingUrl: string): string | undefined => {
  try {
    const parsed = new URL(incomingUrl);

    if (parsed.protocol !== `${NATIVE_SSO_SCHEME}:`) return undefined;
    if (parsed.host === NATIVE_SSO_HOST) {
      const path = normalizePath(parsed.pathname || '/');
      return `${path}${parsed.search}${parsed.hash}`;
    }

    // Some iOS URL open paths arrive as `mindroom:/auth/...` (no host) instead
    // of `mindroom://auth/...`. Accept both formats.
    if (!parsed.host) {
      const hostlessPath = getPathFromHostlessNativeUrl(parsed.pathname);
      if (!hostlessPath) return undefined;

      return `${hostlessPath}${parsed.search}${parsed.hash}`;
    }

    return undefined;
  } catch {
    return undefined;
  }
};
