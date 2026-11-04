// Build files the precache leaves out (scripts/precache-plan.mjs keeps only what a signed-in start
// needs): chunks loaded on demand, their style sheets and fonts, images, sounds and workers. The
// service worker keeps each one the first time a page loads it and answers from that copy from
// then on, also offline. Vite puts a content hash in every name under assets/, so a kept copy
// never goes stale; a new worker belongs to a new build and starts the cache empty.

const BUILD_ASSET_CACHE = 'mindroom-build-assets';

type AssetFetchEvent = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
};

/**
 * True for a same-origin GET of a file in the build's assets/ directory beside the worker.
 * Range requests (media playback) go to the network: a kept full answer cannot serve them.
 */
export const isBuildAssetRequest = (request: Request, workerUrl: string): boolean => {
  if (request.method !== 'GET' || request.headers.has('range')) return false;
  const assets = new URL('assets/', workerUrl);
  const url = new URL(request.url);
  return url.origin === assets.origin && url.pathname.startsWith(assets.pathname);
};

/**
 * Only a complete same-origin answer is kept. A host that answers unknown paths with the app page
 * (a single-page fallback, after a deploy removed an older build's file) sends HTML, which no
 * build asset is, and must not be kept under the asset's name.
 */
const keepable = (response: Response): boolean =>
  response.status === 200 &&
  response.type === 'basic' &&
  !(response.headers.get('content-type') ?? '').includes('text/html');

const keep = async (request: Request, response: Response): Promise<void> => {
  try {
    const cache = await caches.open(BUILD_ASSET_CACHE);
    await cache.put(request, response);
  } catch {
    // A full or unavailable cache only costs the offline use of this file.
  }
};

const findKept = async (request: Request): Promise<Response | undefined> => {
  try {
    const cache = await caches.open(BUILD_ASSET_CACHE);
    return await cache.match(request, { ignoreVary: true });
  } catch {
    return undefined;
  }
};

/** The kept copy when there is one; otherwise the network's answer, kept when it is complete. */
export const fetchBuildAsset = async (event: AssetFetchEvent): Promise<Response> => {
  const { request } = event;
  const kept = await findKept(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (keepable(response)) event.waitUntil(keep(request, response.clone()));
  return response;
};

/** Empties the cache when a new worker takes over: its build names other files. */
export const clearBuildAssets = async (): Promise<void> => {
  try {
    await caches.delete(BUILD_ASSET_CACHE);
  } catch {
    // Without CacheStorage there is nothing to clear.
  }
};
