// Avatars (small thumbnails of homeserver media) are kept in a cache of their own, so an offline
// start shows the pictures it showed online instead of initials. The service worker fills it from
// the images it loads for the page, and the page from the avatars it fetches itself; both read it
// when the network fails. Signing out deletes it.

export const AVATAR_CACHE_NAME = 'mindroom-avatars-v1';

/** The most avatars kept; the oldest go first. */
export const MAX_CACHED_AVATARS = 500;

// Avatars are asked for at up to 112 px; larger thumbnails are message previews, not avatars.
const MAX_AVATAR_SIDE = 256;

// The authenticated endpoint (Matrix 1.11) and the legacy ones.
const THUMBNAIL_PATH = /\/_matrix\/(client\/v1\/media|media\/(v3|r0))\/thumbnail\//;

const availableCaches = (): CacheStorage | undefined =>
  typeof caches === 'undefined' ? undefined : caches;

/** Whether `url` is a homeserver thumbnail small enough to be an avatar. */
export const isAvatarThumbnailUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!THUMBNAIL_PATH.test(parsed.pathname)) return false;
  const width = Number(parsed.searchParams.get('width'));
  const height = Number(parsed.searchParams.get('height'));
  return width > 0 && height > 0 && width <= MAX_AVATAR_SIDE && height <= MAX_AVATAR_SIDE;
};

// Parameters that change how the picture is fetched, not which picture it is.
const TRANSPORT_PARAMETERS = ['allow_redirect', 'allow_remote', 'access_token'];
const AUTHENTICATED_THUMBNAIL = '/_matrix/client/v1/media/thumbnail/';

/**
 * The key a thumbnail is kept under: one picture by the authenticated path and its size, whether
 * it was asked for by the legacy path or with transport parameters (the client switches between
 * them as it learns what the server supports, also between an online and an offline start).
 */
export const avatarCacheKey = (url: string): string => {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(
    /\/_matrix\/media\/(v3|r0)\/thumbnail\//,
    AUTHENTICATED_THUMBNAIL
  );
  TRANSPORT_PARAMETERS.forEach((name) => parsed.searchParams.delete(name));
  parsed.searchParams.sort();
  return parsed.href;
};

/** Keeps a loaded avatar for offline starts; does nothing for other responses. */
export const rememberAvatar = async (url: string, response: Response): Promise<void> => {
  const storage = availableCaches();
  if (!storage || !response.ok || !isAvatarThumbnailUrl(url)) return;
  try {
    const cache = await storage.open(AVATAR_CACHE_NAME);
    await cache.put(avatarCacheKey(url), response);
    const keys = await cache.keys();
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - MAX_CACHED_AVATARS)).map((key) => cache.delete(key))
    );
  } catch {
    // A full or unavailable cache only costs the offline picture.
  }
};

/** The avatar kept for `url`, if any. */
export const recallAvatar = async (url: string): Promise<Response | undefined> => {
  const storage = availableCaches();
  if (!storage || !isAvatarThumbnailUrl(url)) return undefined;
  try {
    const cache = await storage.open(AVATAR_CACHE_NAME);
    return await cache.match(avatarCacheKey(url));
  } catch {
    return undefined;
  }
};

/** Deletes every kept avatar, as a sign-out does. */
export const forgetAvatars = async (): Promise<void> => {
  try {
    await availableCaches()?.delete(AVATAR_CACHE_NAME);
  } catch {
    // Nothing kept, or no cache storage here.
  }
};
