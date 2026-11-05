// The development service worker has nothing precached (the dev server bundles src/sw/sw.ts with an
// empty manifest), so on its own an offline reload finds no app to start. Instead it keeps a copy
// of every same-origin file it serves and answers from those copies when the network is gone:
// the app's own modules under their dev-server URLs, and the last page document as the shell for
// every app route. A build never uses this; its precache holds the shell.

const DEVELOPMENT_CACHE = 'mindroom-development-offline';

type DevelopmentFetchEvent = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
};

/** The one entry that holds the last page document; the dev server sends the same for all routes. */
const shellKey = (scopeUrl: string): string => new URL('development-app-shell', scopeUrl).href;

const keep = async (key: RequestInfo, response: Response): Promise<void> => {
  try {
    const cache = await caches.open(DEVELOPMENT_CACHE);
    await cache.put(key, response);
  } catch {
    // A full or unavailable cache only costs the offline start.
  }
};

const findKept = async (key: RequestInfo): Promise<Response | undefined> => {
  try {
    const cache = await caches.open(DEVELOPMENT_CACHE);
    return await cache.match(key, { ignoreVary: true });
  } catch {
    return undefined;
  }
};

/** Network first; a successful answer is kept, a failed request gets the kept copy if there is one. */
export const fetchWithDevelopmentCache = async (
  event: DevelopmentFetchEvent,
  scopeUrl: string
): Promise<Response> => {
  const { request } = event;
  const key = request.mode === 'navigate' ? shellKey(scopeUrl) : request.url;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') event.waitUntil(keep(key, response.clone()));
    return response;
  } catch (error) {
    const kept = await findKept(key);
    if (kept) return kept;
    throw error;
  }
};
