import type { MatrixClient } from 'matrix-js-sdk';
import { authenticatedMediaRequestInit, supportsAuthenticatedMedia } from '../matrix/mediaUrl';
import { getBlobSafeMimeType } from '../lib/mimeTypes';
import { forgetAvatars, recallAvatar, rememberAvatar } from '../../sw/avatarCache';

// Avatar images normally load straight from their media URL: on the web the service worker adds
// the access token to authenticated media requests (Matrix 1.11, MSC3916). A page without a
// controlling worker (first load after a hard reload, deployments with the worker turned off,
// browsers without one) cannot do that from an `<img>`, and servers that froze the legacy
// endpoints answer those with 403 or 404. For the homeserver's own media this module fetches the
// image with the token in a header instead and hands the `<img>` an object URL.

/** The client calls this module needs; components may get a partial test double. */
export type AvatarMediaClient = Pick<MatrixClient, 'getHomeserverUrl' | 'getAccessToken'> &
  Partial<Pick<MatrixClient, 'getUserId'>>;

type SpecVersionsLike = Parameters<typeof supportsAuthenticatedMedia>[0];

const AUTHENTICATED_PREFIX = '/_matrix/client/v1/media/';
const LEGACY_PREFIXES = ['/_matrix/media/v3/', '/_matrix/media/r0/'];
// Only image reads are rewritten; other media endpoints (config, upload, preview) never are.
const IMAGE_VERBS = ['thumbnail/', 'download/'];

const parse = (url: string, base?: string): URL | undefined => {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
};

const homeserverOf = (mx: AvatarMediaClient): URL | undefined => {
  try {
    return typeof mx.getHomeserverUrl === 'function' ? parse(mx.getHomeserverUrl()) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The authenticated endpoint for a thumbnail or download URL of the homeserver's own media,
 * whether `url` uses the legacy or the authenticated path; undefined for any other URL. The URL
 * is parsed first, so `..` segments cannot step out of the media path.
 */
export const toAuthenticatedAvatarUrl = (
  mx: AvatarMediaClient,
  url: string
): string | undefined => {
  const homeserver = homeserverOf(mx);
  const parsed = parse(url);
  if (!homeserver || !parsed || parsed.origin !== homeserver.origin) return undefined;
  const basePath = homeserver.pathname.replace(/\/+$/, '');
  const path = parsed.pathname;
  const prefix = [AUTHENTICATED_PREFIX, ...LEGACY_PREFIXES]
    .map((candidate) => `${basePath}${candidate}`)
    .find((candidate) => path.startsWith(candidate));
  if (!prefix) return undefined;
  const rest = path.slice(prefix.length);
  if (!IMAGE_VERBS.some((verb) => rest.startsWith(verb))) return undefined;
  const target = new URL(parsed.href);
  target.pathname = `${basePath}${AUTHENTICATED_PREFIX}${rest}`;
  return target.href;
};

const pageHasServiceWorkerControl = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

// Only a page that could have a service worker but is not controlled by one is known to fail;
// elsewhere the `<img>` tries first and the fetch only runs once it reports an error.
const pageLacksServiceWorkerControl = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.serviceWorker && !pageHasServiceWorkerControl();

/**
 * Whether loading `src` in an `<img>` is bound to fail, so the avatar should fetch it at once:
 * an authenticated media URL without a token in it, or a legacy one on a server with authenticated
 * media, on a page that no service worker controls.
 */
export const avatarNeedsFetch = (
  mx: AvatarMediaClient,
  src: string,
  versions: SpecVersionsLike
): boolean => {
  if (!pageLacksServiceWorkerControl()) return false;
  const target = toAuthenticatedAvatarUrl(mx, src);
  const parsed = parse(src);
  if (!target || !parsed || parsed.searchParams.has('access_token')) return false;
  return target === parsed.href || supportsAuthenticatedMedia(versions);
};

/**
 * The request that loads `src` from the authenticated endpoint with the access token in a header,
 * or undefined when `src` is not homeserver media or there is no token. For code that fetches an
 * avatar itself, for example after the server refused a legacy URL.
 */
export const authenticatedAvatarRequest = (
  mx: AvatarMediaClient,
  src: string
): { url: string; init: RequestInit } | undefined => {
  const url = toAuthenticatedAvatarUrl(mx, src);
  if (!url) return undefined;
  let init: RequestInit | undefined;
  try {
    init = authenticatedMediaRequestInit(mx, url);
  } catch {
    init = undefined;
  }
  return init ? { url, init } : undefined;
};

/** Whether `src` is homeserver media this module could fetch with the access token. */
export const canFetchAvatar = (mx: AvatarMediaClient, src: string): boolean =>
  !!authenticatedAvatarRequest(mx, src);

// Object URLs of fetched avatars, most recently used last. The cap bounds memory in rooms with
// thousands of members; an `<img>` keeps showing an image whose URL was revoked after it loaded.
const MAX_CACHED_AVATARS = 300;
// `cleared` marks an entry dropped by clearFetchedAvatars while it downloaded.
type CachedAvatar = {
  objectUrl?: string;
  pending?: Promise<string | undefined>;
  cleared?: boolean;
};
const fetchedAvatars = new Map<string, CachedAvatar>();

// Each account has its own entries, so one account never reuses what another fetched.
const cacheKey = (mx: AvatarMediaClient, target: string): string => {
  let owner = '';
  try {
    owner = mx.getUserId?.() ?? '';
  } catch {
    owner = '';
  }
  return `${owner}\n${target}`;
};

const touch = (key: string, entry: CachedAvatar) => {
  fetchedAvatars.delete(key);
  fetchedAvatars.set(key, entry);
  while (fetchedAvatars.size > MAX_CACHED_AVATARS) {
    const [oldestKey, oldest] = fetchedAvatars.entries().next().value as [string, CachedAvatar];
    fetchedAvatars.delete(oldestKey);
    if (oldest.objectUrl) URL.revokeObjectURL(oldest.objectUrl);
  }
};

/** The object URL of an avatar fetched earlier for this account, if it is still cached. */
export const peekFetchedAvatar = (mx: AvatarMediaClient, src: string): string | undefined => {
  const target = toAuthenticatedAvatarUrl(mx, src);
  if (!target) return undefined;
  const key = cacheKey(mx, target);
  const entry = fetchedAvatars.get(key);
  if (!entry?.objectUrl) return undefined;
  touch(key, entry);
  return entry.objectUrl;
};

// The object URL belongs to the app's origin, where "Open image in new tab" would run an SVG or
// HTML body's script, so the blob gets one of the safe image types or a plain download type.
// An avatar loaded is kept for offline starts, and a kept one answers when the network fails.
const download = async (target: string, init: RequestInit): Promise<string | undefined> => {
  let response: Response;
  try {
    response = await fetch(target, init);
    if (response.ok) void rememberAvatar(target, response.clone());
  } catch (error) {
    const kept = await recallAvatar(target);
    if (!kept) throw error;
    response = kept;
  }
  if (!response.ok) return undefined;
  const blob = await response.blob();
  if (blob.size === 0) return undefined;
  return URL.createObjectURL(new Blob([blob], { type: getBlobSafeMimeType(blob.type) }));
};

/**
 * Fetches homeserver media with the access token in a header and resolves to an object URL for
 * an `<img>`, or undefined when that is not possible or the server refuses. Concurrent requests
 * for one image share a single download.
 */
export const fetchAvatar = (mx: AvatarMediaClient, src: string): Promise<string | undefined> => {
  const request = authenticatedAvatarRequest(mx, src);
  if (!request || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(undefined);
  }
  const { url: target, init } = request;

  const key = cacheKey(mx, target);
  const cached = fetchedAvatars.get(key);
  if (cached) {
    touch(key, cached);
    return cached.pending ?? Promise.resolve(cached.objectUrl);
  }

  const entry: CachedAvatar = {};
  entry.pending = download(target, init)
    .catch(() => undefined)
    .then((objectUrl) => {
      entry.pending = undefined;
      if (!objectUrl) {
        // A refusal is not kept, so the next mount asks again.
        if (fetchedAvatars.get(key) === entry) fetchedAvatars.delete(key);
        return undefined;
      }
      entry.objectUrl = objectUrl;
      // Evicted while it downloaded: keep it after all, it is about to be shown.
      if (!fetchedAvatars.has(key) && !entry.cleared) touch(key, entry);
      return objectUrl;
    });
  touch(key, entry);
  return entry.pending;
};

/**
 * Drops fetched avatars and revokes their object URLs: those one account fetched when `userId`
 * is given (it signed out), otherwise every account's. Resolves once the kept avatars' deletion
 * was tried; a failure is ignored.
 */
export const clearFetchedAvatars = (userId?: string): Promise<void> => {
  [...fetchedAvatars].forEach(([key, entry]) => {
    if (userId !== undefined && !key.startsWith(`${userId}\n`)) return;
    fetchedAvatars.delete(key);
    entry.cleared = true;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  });
  // The kept pictures belong to no one account; any sign-out deletes them.
  return forgetAvatars();
};
