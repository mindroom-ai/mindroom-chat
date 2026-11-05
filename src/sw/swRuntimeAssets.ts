// Build files the precache leaves out (scripts/precache-plan.mjs keeps only what a signed-in start
// needs): chunks loaded on demand, their style sheets and fonts, sounds and workers. The service
// worker keeps each one the first time a page loads it and answers from that copy from then on,
// also offline. Vite puts a content hash in every name under assets/, so a kept copy never goes
// stale. A new worker belongs to a new build: when it takes over it drops the kept files its build
// no longer has and keeps the rest (emoji data, KaTeX and markdown-it rarely change), so the first
// offline start after an update still has them.

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
export const keepable = (response: Response): boolean =>
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

/**
 * Fetches a file of this build and keeps it unless a copy is kept already, so a page of this build
 * finds it offline before any page loaded it. Best effort: a failure only costs that file.
 */
export const keepBuildFile = async (url: string): Promise<void> => {
  try {
    const request = new Request(url);
    if (await findKept(request)) return;
    const response = await fetch(request);
    if (keepable(response)) await keep(request, response);
  } catch {
    // Offline or refused: a page that needs the file loads it from the server later.
  }
};

/** Empties the cache, for a worker that cannot tell which files its build has. */
export const clearBuildAssets = async (): Promise<void> => {
  try {
    await caches.delete(BUILD_ASSET_CACHE);
  } catch {
    // Without CacheStorage there is nothing to clear.
  }
};

/**
 * When a new worker takes over: drops every kept file that is not one of `buildFiles` (paths
 * beside the worker, such as `assets/emoji-1a2b.js`), and empties the cache when the worker has no
 * list of its build's files.
 */
export const keepOnlyBuildFiles = async (
  buildFiles: readonly string[] | undefined,
  workerUrl: string
): Promise<void> => {
  if (!buildFiles) {
    await clearBuildAssets();
    return;
  }
  const listed = new Set(buildFiles.map((file) => new URL(file, workerUrl).href));
  try {
    const cache = await caches.open(BUILD_ASSET_CACHE);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => {
          const url = new URL(request.url);
          return !listed.has(`${url.origin}${url.pathname}`);
        })
        .map((request) => cache.delete(request))
    );
  } catch {
    // A cache that cannot be read is emptied instead, so old builds' files cannot pile up in it.
    await clearBuildAssets();
  }
};
