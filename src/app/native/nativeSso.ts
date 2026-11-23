import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isRoomAlias, isRoomId } from '../lib/matrixIds';
import {
  getActivityRoomPath,
  getConnectPath,
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceLobbyPath,
  getSpacePath,
  getSpaceRoomPath,
  getThreadsRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import { NATIVE_APP_WEB_ORIGIN } from './nativeAppOrigin';

const NATIVE_SSO_SCHEME = 'mindroom';
const NATIVE_SSO_HOST = 'auth';
const SUPPORTED_NATIVE_APP_PLATFORMS = new Set(['android', 'ios']);
type StandaloneNavigator = Navigator & { standalone?: boolean };
type MindRoomAuthPlugin = {
  authenticate(options: {
    url: string;
    callbackScheme: string;
    ephemeral: boolean;
  }): Promise<{ url?: string }>;
  signInWithApple(options: {
    url: string;
    callbackScheme: string;
    ephemeral: boolean;
  }): Promise<NativeAppleCredential>;
};
type NativeAppUrlPlugin = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url?: string }) => void
  ): Promise<unknown>;
  getLaunchUrl(): Promise<{ url?: string } | undefined>;
};

let mindRoomAuthPlugin: MindRoomAuthPlugin | undefined;

type NativeAppleCredential = {
  url?: string;
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
  ssoUrl: string;
  ephemeral?: boolean;
  providerId?: string;
  redirectUrl: string;
  request?: typeof fetch;
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

export const isNativeApp = (): boolean =>
  Capacitor.isNativePlatform() && SUPPORTED_NATIVE_APP_PLATFORMS.has(Capacitor.getPlatform());

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

const navigateNativeAppPath = (appPath: string): void => {
  try {
    window.history.replaceState(null, '', appPath);
    window.dispatchEvent(createPopStateNavigationEvent());
  } catch {
    window.location.replace(appPath);
  }
};

export const routeNativeSsoCallback = (incomingUrl: string): boolean => {
  const appPath = getAppPathFromNativeSsoUrl(incomingUrl);
  if (!appPath || typeof window === 'undefined') return false;

  Promise.resolve(Browser.close()).catch(() => undefined);
  navigateNativeAppPath(appPath);

  return true;
};

// eslint-disable-next-line no-control-regex
const ASCII_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const SECTION_ROOM_PATH_BUILDERS: Record<
  string,
  (roomIdOrAlias: string, eventId?: string) => string
> = {
  home: getHomeRoomPath,
  direct: getDirectRoomPath,
  threads: getThreadsRoomPath,
  activity: getActivityRoomPath,
};

const decodeUniversalLinkSegment = (segment: string): string | undefined => {
  if (!segment) return undefined;
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || ASCII_CONTROL_CHARS.test(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
};

const isRoomOrAlias = (value: string): boolean =>
  !ASCII_CONTROL_CHARS.test(value) && (isRoomId(value) || isRoomAlias(value));

const isEventId = (value: string): boolean =>
  !ASCII_CONTROL_CHARS.test(value) && /^\$\S+$/.test(value);

const readSafeViaServers = (searchParams: URLSearchParams): string[] => {
  const rawValues = [
    ...searchParams.getAll('via'),
    ...searchParams.getAll('viaServers').flatMap((value) => value.split(',')),
  ];
  const servers: string[] = [];
  const seen = new Set<string>();
  for (const value of rawValues) {
    if (!value || /[\s,]/.test(value) || ASCII_CONTROL_CHARS.test(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    servers.push(value);
  }
  return servers;
};

const resolveUniversalLinkBaseRoute = (
  segments: readonly string[]
): { basePath: string; isLobby: boolean } | undefined => {
  const [first, second, third] = segments;
  if (!first) return undefined;

  if (Object.hasOwn(SECTION_ROOM_PATH_BUILDERS, first)) {
    const buildSectionRoomPath = SECTION_ROOM_PATH_BUILDERS[first];
    if (!buildSectionRoomPath || !second || !isRoomOrAlias(second)) return undefined;
    if (segments.length === 2) {
      return { basePath: buildSectionRoomPath(second), isLobby: false };
    }
    if (segments.length === 3 && third && isEventId(third)) {
      return { basePath: buildSectionRoomPath(second, third), isLobby: false };
    }
    return undefined;
  }

  if (!isRoomOrAlias(first)) return undefined;

  if (segments.length === 1) {
    return { basePath: getSpacePath(first), isLobby: false };
  }

  if (segments.length === 2 && second) {
    if (isEventId(second)) {
      return { basePath: getSpaceRoomPath(first, second), isLobby: false };
    }
    if (second === 'lobby') {
      return { basePath: getSpaceLobbyPath(first), isLobby: true };
    }
    if (isRoomOrAlias(second)) {
      return { basePath: getSpaceRoomPath(first, second), isLobby: false };
    }
    return undefined;
  }

  if (segments.length === 3 && second && third && isRoomOrAlias(second) && isEventId(third)) {
    return { basePath: getSpaceRoomPath(first, second, third), isLobby: false };
  }

  return undefined;
};

export const getAppPathFromUniversalLink = (incomingUrl: string): string | undefined => {
  if (incomingUrl.split(/[?#]/, 1)[0]?.includes('\\')) return undefined;
  let url: URL;
  try {
    url = new URL(incomingUrl);
  } catch {
    return undefined;
  }
  if (
    url.origin !== NATIVE_APP_WEB_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname.includes('//') ||
    url.pathname.includes('\\')
  ) {
    return undefined;
  }
  if (url.pathname === '/connect' || url.pathname === '/connect/') {
    return getConnectPath(url.searchParams.get('code') ?? undefined);
  }

  const pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  if (!pathname.startsWith('/')) return undefined;
  const rawSegments = pathname.slice(1).split('/');
  if (rawSegments.length < 1 || rawSegments.length > 3) return undefined;

  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    const decoded = decodeUniversalLinkSegment(rawSegment);
    if (!decoded) return undefined;
    segments.push(decoded);
  }

  const route = resolveUniversalLinkBaseRoute(segments);
  if (!route) return undefined;

  const viaServers = readSafeViaServers(url.searchParams);
  const rawThreadId = url.searchParams.get('threadId');
  const threadId =
    !route.isLobby && rawThreadId && isEventId(rawThreadId) ? rawThreadId : undefined;
  const focusEvent = !route.isLobby && url.searchParams.get('focusEvent') === '1' ? '1' : undefined;

  return withSearchParam(route.basePath, {
    viaServers: viaServers.length > 0 ? viaServers.join(',') : undefined,
    threadId,
    focusEvent,
  });
};

// Capacitor keeps returning the last opened URL from `getLaunchUrl()` after the
// page reloads (for example to recover from a lost IndexedDB server). That URL
// was handled before the reload; later URLs arrive through `appUrlOpen`.
const isPageReload = (): boolean => {
  try {
    const [navigation] = performance.getEntriesByType(
      'navigation'
    ) as PerformanceNavigationTiming[];
    return navigation?.type === 'reload';
  } catch {
    return false;
  }
};

export const registerNativeAppUrlCallbacks = (nativeApp: NativeAppUrlPlugin): void => {
  let handledOpenUrl = false;
  const handleNativeAppUrl = (url: string): boolean => {
    if (routeNativeSsoCallback(url)) return true;
    const appPath = getAppPathFromUniversalLink(url);
    if (appPath && typeof window !== 'undefined') {
      navigateNativeAppPath(appPath);
      return true;
    }
    // Keep rejected callbacks diagnosable without disclosing codes or credentials.
    // eslint-disable-next-line no-console
    console.warn('[MindRoom] Ignored unsupported app URL');
    return false;
  };

  nativeApp
    .getLaunchUrl()
    .then((launchUrl) => {
      const url = launchUrl?.url;
      if (url && !handledOpenUrl && !isPageReload()) handleNativeAppUrl(url);
    })
    .catch(() => undefined);

  nativeApp
    .addListener('appUrlOpen', (event) => {
      if (event.url && handleNativeAppUrl(event.url)) handledOpenUrl = true;
    })
    .catch(() => undefined);
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

/**
 * Opens `url` in an iOS authentication session and returns the callback URL it ends at.
 * An ephemeral session starts without Safari's cookies and keeps none of its own.
 */
export const authenticateInNativeBrowser = async (
  url: string,
  callbackScheme: string,
  ephemeral = false
): Promise<string | undefined> =>
  (await getMindRoomAuthPlugin().authenticate({ callbackScheme, ephemeral, url })).url;

export const openNativeSsoBrowser = async (url: string, ephemeral = false): Promise<void> => {
  if (isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth')) {
    const callbackUrl = await authenticateInNativeBrowser(url, NATIVE_SSO_SCHEME, ephemeral);

    if (callbackUrl) {
      routeNativeSsoCallback(callbackUrl);
    }

    return;
  }

  await Browser.open({ url, presentationStyle: 'fullscreen' });
};

export const signInWithNativeApple = async ({
  baseUrl,
  ssoUrl,
  ephemeral = false,
  providerId,
  redirectUrl,
  request = fetch,
}: NativeAppleLoginOptions): Promise<void> => {
  if (!isNativeIOS() || !Capacitor.isPluginAvailable('MindRoomAuth')) {
    throw new Error('Native Apple sign-in is unavailable');
  }

  const credential = await getMindRoomAuthPlugin().signInWithApple({
    url: ssoUrl,
    callbackScheme: NATIVE_SSO_SCHEME,
    ephemeral,
  });
  // The native shell chooses browser SSO when its signing profile cannot
  // authorize Apple's native API. Keep platform decisions out of web code.
  if (credential.url) {
    if (!routeNativeSsoCallback(credential.url)) {
      throw new Error('Apple browser sign-in returned an unsupported callback');
    }
    return;
  }

  if (!credential.identityToken) {
    throw new Error('Native Apple sign-in did not return an identity token');
  }

  const response = await request(
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
