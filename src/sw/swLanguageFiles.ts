// The files an offline start in a language other than English needs: its catalog
// (public/locales/<code>.json, fetched by src/app/i18n/i18n.ts) and the build's overlay chunk of Lane C
// strings for it (src/app/i18n/localeAdditions.ts). Without the catalog the whole app falls back to
// English offline.
//
// A catalog has no hash in its name, so the worker answers it from the network and keeps the latest
// copy for when the network is gone. The kept catalogs also tell which languages this browser's
// pages use: a new worker fetches its own build's overlay chunk for each of them when it installs,
// so the first offline start after an update has the language in full.

import { keepable, keepBuildFile } from './swRuntimeAssets';

const LANGUAGE_CACHE = 'mindroom-languages';
const CATALOG_PATH = /^public\/locales\/([A-Za-z-]+)\.json$/;

type CatalogFetchEvent = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
};

/** The language of a catalog URL beside the worker, or undefined for any other URL. */
const catalogLanguage = (url: URL, workerUrl: string): string | undefined => {
  const base = new URL('./', workerUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
  return CATALOG_PATH.exec(url.pathname.slice(base.pathname.length))?.[1];
};

/** True for a GET of a language catalog in the build's public/locales/ beside the worker. */
export const isLanguageCatalogRequest = (request: Request, workerUrl: string): boolean =>
  request.method === 'GET' && catalogLanguage(new URL(request.url), workerUrl) !== undefined;

const openLanguageCache = async (): Promise<Cache | undefined> => {
  try {
    return await caches.open(LANGUAGE_CACHE);
  } catch {
    return undefined;
  }
};

/** The network's catalog, a copy of it kept when complete; the kept copy when the network fails. */
export const fetchLanguageCatalog = async (event: CatalogFetchEvent): Promise<Response> => {
  const { request } = event;
  let response: Response;
  try {
    response = await fetch(request);
  } catch (error) {
    const kept = await (await openLanguageCache())?.match(request, { ignoreVary: true });
    if (kept) return kept;
    throw error;
  }
  if (keepable(response)) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        try {
          await (await openLanguageCache())?.put(request, copy);
        } catch {
          // A full cache only costs this language offline.
        }
      })()
    );
  }
  return response;
};

/** The languages whose catalog a page loaded through this worker or an earlier one. */
const keptLanguages = async (workerUrl: string): Promise<string[]> => {
  try {
    const requests = (await (await openLanguageCache())?.keys()) ?? [];
    return requests.flatMap((request) => catalogLanguage(new URL(request.url), workerUrl) ?? []);
  } catch {
    return [];
  }
};

/**
 * For a worker that installs: keeps this build's overlay chunk (`localeOverlays`, language code to
 * a path beside the worker) for every language a page loaded before. Best effort.
 */
export const keepLanguageOverlays = async (
  localeOverlays: Readonly<Record<string, string>> | undefined,
  workerUrl: string
): Promise<void> => {
  if (!localeOverlays) return;
  const languages = await keptLanguages(workerUrl);
  await Promise.all(
    languages.map((language) => {
      const file = localeOverlays[language];
      return file ? keepBuildFile(new URL(file, workerUrl).href) : undefined;
    })
  );
};
