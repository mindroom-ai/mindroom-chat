import type { MatrixClient } from 'matrix-js-sdk';

// Authenticated media (Matrix 1.11, MSC3916) needs the access token in an Authorization header on
// every download (MSC4127 removed `?access_token=` query parameters). On the web a controlling
// service worker adds it, in Electron desktop main's webRequest interceptor adds it, and in
// Capacitor shells or pages without a service worker callers fetch with
// `authenticatedMediaRequestInit`.

type MediaClient = Pick<MatrixClient, 'getHomeserverUrl' | 'mxcUrlToHttp'>;

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
  allowRedirects?: boolean,
];

const buildMediaUrl = (
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
  return url === parsed ? httpUrl : url.href;
};

// Every timeline row builds its avatar's URL at each render, and building one parses URLs twice.
// Because media URLs never carry access tokens, each URL depends only on the client's homeserver
// (which a client never changes) and the arguments, so it is cached per client on every platform.
const MAX_CACHED_URLS = 1000;
const cachedMediaUrls = new WeakMap<MediaClient, Map<string, string | null>>();

/** The clean, token-free HTTP URL of an `mxc://` URI, a thumbnail when a size is given. */
export const mxcUrlToHttp = (
  mx: MediaClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  ...extras: MxcHttpExtras
): string | null => {
  let urls = cachedMediaUrls.get(mx);
  if (!urls) {
    urls = new Map();
    cachedMediaUrls.set(mx, urls);
  }
  const key = JSON.stringify([mxcUrl, useAuthentication, ...extras]);
  const known = urls.get(key);
  if (known !== undefined) return known;
  const url = buildMediaUrl(mx, mxcUrl, useAuthentication, ...extras);
  if (urls.size >= MAX_CACHED_URLS) urls.delete(urls.keys().next().value as string);
  urls.set(key, url);
  return url;
};

/**
 * The fetch options that authenticate a request for homeserver media, if it needs any. Only the
 * homeserver's authenticated endpoints (`/_matrix/client/v1/media/`) take the access token; the
 * legacy `/_matrix/media/v3/` endpoints are unauthenticated, so they never receive it.
 * `cache: 'no-store'` keeps authenticated media out of the browser and WebView HTTP caches across
 * sign-out; callers manage their own sign-out-cleared caches instead.
 */
export const authenticatedMediaRequestInit = (
  mx: Pick<MatrixClient, 'getHomeserverUrl' | 'getAccessToken'>,
  url: string
): RequestInit | undefined => {
  const token = mx.getAccessToken();
  const homeserver = parseUrl(mx.getHomeserverUrl());
  const parsed = parseUrl(url);
  if (!token || !homeserver || !parsed || !isHomeserverMediaUrl(parsed, homeserver)) {
    return undefined;
  }
  return { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
};
