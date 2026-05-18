import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NATIVE_SSO_SCHEME = 'mindroom';
const NATIVE_SSO_HOST = 'auth';
type StandaloneNavigator = Navigator & { standalone?: boolean };
type MindRoomAuthPlugin = {
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url?: string }>;
  signInWithApple(options?: Record<string, never>): Promise<NativeAppleCredential>;
};

let mindRoomAuthPlugin: MindRoomAuthPlugin | undefined;

type NativeAppleCredential = {
  authorizationCode?: string;
  email?: string;
  familyName?: string;
  givenName?: string;
  identityToken?: string;
  nonce?: string;
  user?: string;
};

type NativeAppleLoginResponse = {
  expiresInMs?: number;
  loginToken?: string;
};

type NativeAppleLoginOptions = {
  baseUrl: string;
  providerId?: string;
  redirectUrl: string;
};

const normalizePath = (path: string): string => path.replace(/\/{2,}/g, '/');

const getMindRoomAuthPlugin = (): MindRoomAuthPlugin => {
  if (!mindRoomAuthPlugin) {
    mindRoomAuthPlugin = registerPlugin<MindRoomAuthPlugin>('MindRoomAuth');
  }

  return mindRoomAuthPlugin;
};

const createPopStateNavigationEvent = (): Event =>
  typeof PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');

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

export const routeNativeSsoCallback = (incomingUrl: string): boolean => {
  const appPath = getAppPathFromNativeSsoUrl(incomingUrl);
  if (!appPath || typeof window === 'undefined') return false;

  Promise.resolve(Browser.close()).catch(() => undefined);

  try {
    window.history.replaceState(null, '', appPath);
    window.dispatchEvent(createPopStateNavigationEvent());
  } catch {
    window.location.replace(appPath);
  }

  return true;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const buildLoginTokenRedirectUrl = (redirectUrl: string, loginToken: string): string => {
  const target = new URL(redirectUrl);
  target.searchParams.set('loginToken', loginToken);
  return target.toString();
};

const routeLoginTokenRedirect = (redirectUrl: string, loginToken: string): void => {
  const targetUrl = buildLoginTokenRedirectUrl(redirectUrl, loginToken);

  if (routeNativeSsoCallback(targetUrl)) return;

  window.location.replace(targetUrl);
};

export const openNativeSsoBrowser = async (url: string): Promise<void> => {
  if (isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth')) {
    const result = await getMindRoomAuthPlugin().authenticate({
      callbackScheme: NATIVE_SSO_SCHEME,
      url,
    });

    if (result.url) {
      routeNativeSsoCallback(result.url);
    }

    return;
  }

  await Browser.open({ url, presentationStyle: 'fullscreen' });
};

export const signInWithNativeApple = async ({
  baseUrl,
  providerId,
  redirectUrl,
}: NativeAppleLoginOptions): Promise<void> => {
  if (!isNativeIOS() || !Capacitor.isPluginAvailable('MindRoomAuth')) {
    throw new Error('Native Apple sign-in is unavailable');
  }

  const credential = await getMindRoomAuthPlugin().signInWithApple({});

  if (!credential.identityToken) {
    throw new Error('Native Apple sign-in did not return an identity token');
  }

  const response = await fetch(
    `${trimTrailingSlash(baseUrl)}/_matrix/client/unstable/org.mindroom.login/apple`,
    {
      body: JSON.stringify({
        authorizationCode: credential.authorizationCode,
        identityToken: credential.identityToken,
        nonce: credential.nonce,
        providerId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );

  if (!response.ok) {
    throw new Error(`Native Apple sign-in exchange failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as NativeAppleLoginResponse;
  if (!body.loginToken) {
    throw new Error('Native Apple sign-in exchange did not return a Matrix login token');
  }

  routeLoginTokenRedirect(redirectUrl, body.loginToken);
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
