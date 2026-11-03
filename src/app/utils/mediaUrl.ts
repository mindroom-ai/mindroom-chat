import { Capacitor } from '@capacitor/core';
import type { MatrixClient } from 'matrix-js-sdk';

// Authenticated media (Matrix 1.11, MSC3916) needs the access token on every download. On the web
// the service worker adds it as a header; native shells without a service worker put it in the
// URL instead, and only for the homeserver's own media endpoints.

type MediaClient = Pick<MatrixClient, 'getHomeserverUrl' | 'mxcUrlToHttp'> &
  Partial<Pick<MatrixClient, 'getAccessToken'>>;

type VersionsLike = { versions?: string[]; unstable_features?: Record<string, boolean> };

const AUTHENTICATED_MEDIA_PATH = '/_matrix/client/v1/media/';

const parseUrl = (url: string, base?: string): URL | undefined => {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
};

const isSpecVersionAtLeast = (version: string, major: number, minor: number): boolean => {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [vMajor, vMinor] = [Number(match[1]), Number(match[2])];
  return vMajor > major || (vMajor === major && vMinor >= minor);
};

/** Whether the homeserver serves the authenticated media endpoints. */
export const supportsAuthenticatedMedia = (versions: VersionsLike): boolean =>
  (versions.versions ?? []).some((version) => isSpecVersionAtLeast(version, 1, 11)) ||
  versions.unstable_features?.['org.matrix.msc3916.stable'] === true;

const runsInNativeShell = (): boolean => {
  const protocol = typeof window === 'undefined' ? undefined : window.location?.protocol;
  if (protocol && protocol !== 'http:' && protocol !== 'https:') return true;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const hasServiceWorkerControl = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

/**
 * Some SDK versions build media URLs from the homeserver origin only. A homeserver served under a
 * path (`https://example.org/matrix`) needs that path in front of `/_matrix`.
 */
const withHomeserverPath = (url: URL, homeserver: URL): URL => {
  const basePath = homeserver.pathname.replace(/\/+$/, '');
  if (!basePath || url.origin !== homeserver.origin) return url;
  if (url.pathname.startsWith(`${basePath}/`) || !url.pathname.startsWith('/_matrix/')) return url;
  const rebased = new URL(url.href);
  rebased.pathname = `${basePath}${url.pathname}`;
  return rebased;
};

// Matches only the homeserver's own media endpoints under its base path, like the service worker
// (`swMediaAuth.ts`), so a lookalike path elsewhere on the same origin never gets the token.
const isHomeserverMediaUrl = (url: URL, homeserver: URL): boolean => {
  const basePath = homeserver.pathname.replace(/\/+$/, '');
  return (
    url.origin === homeserver.origin &&
    url.pathname.startsWith(`${basePath}${AUTHENTICATED_MEDIA_PATH}`)
  );
};

// Everything after `useAuthentication` is passed on to the SDK unchanged: an optional thumbnail size
// and method (`crop` or `scale`, spec "Thumbnails"), then the SDK's direct-link and redirect flags.
type MxcHttpExtras = [
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean
];

/** The HTTP URL of an `mxc://` URI, a thumbnail when a size is given. */
export const mxcUrlToHttp = (
  mx: MediaClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  ...[width, height, resizeMethod, allowDirectLinks, allowRedirects]: MxcHttpExtras
): string | null => {
  const httpUrl = mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );
  if (!httpUrl) return null;

  const homeserver = parseUrl(mx.getHomeserverUrl());
  const parsed = parseUrl(httpUrl);
  if (!homeserver || !parsed) return httpUrl;

  const url = withHomeserverPath(parsed, homeserver);
  if (!useAuthentication || hasServiceWorkerControl() || !runsInNativeShell()) {
    return url === parsed ? httpUrl : url.href;
  }

  const token = mx.getAccessToken?.();
  if (!token || !isHomeserverMediaUrl(url, homeserver)) return url === parsed ? httpUrl : url.href;
  url.searchParams.set('access_token', token);
  return url.href;
};

/**
 * The fetch options that authenticate a request for homeserver media, if it needs any. Only the
 * homeserver's authenticated endpoints (`/_matrix/client/v1/media/`) take the access token; the
 * legacy `/_matrix/media/v3/` endpoints are unauthenticated, so they never receive it.
 */
export const authenticatedMediaRequestInit = (
  mx: Pick<MatrixClient, 'getHomeserverUrl' | 'getAccessToken'>,
  url: string
): RequestInit | undefined => {
  const token = mx.getAccessToken();
  const homeserver = parseUrl(mx.getHomeserverUrl());
  const parsed = parseUrl(url);
  if (!token || !homeserver || !parsed) return undefined;
  if (!isHomeserverMediaUrl(parsed, homeserver) || parsed.searchParams.has('access_token')) {
    return undefined;
  }
  return { headers: { Authorization: `Bearer ${token}` } };
};
