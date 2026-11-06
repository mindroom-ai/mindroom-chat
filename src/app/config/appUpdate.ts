// What a page does after a deployment replaced the build it runs. The service worker precaches only
// a signed-in start (src/sw/sw.ts), so a page loads its other chunks from the server the first time it
// needs them, and a deployment that removed the previous build's files leaves the page unable to
// load them. When a part fails to load and the server publishes another version than this page's
// (version.json), the page says a new version is available (NewVersionNotice) and offers to reload.
//
// A failed chunk can also outlive a reload: Safari 26 (and so the iOS app) answers a module the
// page failed to load from that failure again after the reload, without a request, until the file
// is fetched once more. So the page notes each module preload that failed, and a reload fetches
// those files first.
//
// A reload alone keeps the old build: an upgraded worker waits until no page of the old one is
// left (src/sw/sw.ts), and the old worker answers the reload with its own shell. So a reload for the
// new version asks the waiting worker to take over first, staging it if the version monitor
// (src/app/config/appVersion.ts) has not yet, and reloads once it controls the page.

import { APP_BUILD_VERSION, fetchPublishedAppVersion } from './appVersion';
import { createServiceWorkerUrl } from './serviceWorkerRegistration';
import { ensureBasePathTrailingSlash, getAppBasePath } from '../lib/basePath';

/** How long a reload waits for the new worker to install and take over before it goes ahead. */
export const TAKE_OVER_TIMEOUT_MS = 10_000;

/** Vite's event for a chunk or style sheet of a dynamic import that failed to load. */
const PRELOAD_ERROR_EVENT = 'vite:preloadError';

let newVersion: string | undefined;
/** Build files whose module preload failed in this page (Vite preloads every chunk it imports). */
const failedModules = new Set<string>();
let checking: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** The version the server publishes when it is not this page's, once a part failed to load. */
export const getNewVersion = (): string | undefined => newVersion;

export const subscribeToNewVersion = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Asks the server which version it publishes, after a part of the app failed to load. Offline, or
 * when the server still has this page's version, nothing changes: the part failed for another
 * reason and loads again on its next use.
 */
export const checkForNewVersion = (): Promise<void> => {
  if (newVersion !== undefined) return Promise.resolve();
  checking ??= fetchPublishedAppVersion()
    .then((published) => {
      if (!published || published === APP_BUILD_VERSION) return;
      newVersion = published;
      listeners.forEach((listener) => listener());
    })
    .finally(() => {
      checking = undefined;
    });
  return checking;
};

/**
 * Checks for a new version whenever a dynamic import fails, and notes the files that failed.
 * Production builds load every on-demand chunk through Vite's preload helper, which adds a module
 * preload link for the chunk and each chunk it imports, and reports each failure on the window;
 * the importer still gets its error and handles it as before. Returns a function that stops it.
 */
export const watchForNewVersion = (target: Window = window): (() => void) => {
  const onPreloadError = () => {
    checkForNewVersion().catch(() => undefined);
  };
  // A link's error does not bubble, so the window hears it while capturing.
  const onResourceError = (event: Event) => {
    const link = event.target;
    if (link instanceof HTMLLinkElement && link.rel === 'modulepreload')
      failedModules.add(link.href);
  };
  target.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  target.addEventListener('error', onResourceError, true);
  return () => {
    target.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
    target.removeEventListener('error', onResourceError, true);
  };
};

/**
 * Fetches each module that failed to load again, so the next page does not reuse the failure. Each
 * body is read to its end: a reload would cancel a download still running.
 */
const refetchFailedModules = (timeoutMs: number): Promise<unknown> =>
  Promise.all(
    [...failedModules].map((url) =>
      fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        .then((response) => response.arrayBuffer())
        .then(
          () => failedModules.delete(url),
          () => undefined
        )
    )
  );

/** Resolves once `worker` has left `state`, or after `timeoutMs`. */
const waitWhile = (worker: ServiceWorker, state: ServiceWorkerState, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    if (worker.state !== state) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (worker.state !== state) done();
    };
    const timer = setTimeout(done, timeoutMs);
    worker.addEventListener('statechange', onChange);
  });

/** Resolves on the next controller change of `container`, or after `timeoutMs`. */
const waitForNewController = (container: ServiceWorkerContainer, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      container.removeEventListener('controllerchange', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    container.addEventListener('controllerchange', done);
  });

/** Hands this page to the new build's worker; resolves when it controls the page or cannot. */
const handOverToNewWorker = async (timeoutMs: number): Promise<void> => {
  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (!container) return;
  const scope = ensureBasePathTrailingSlash(getAppBasePath());
  let registration = await container.getRegistration(scope);
  if (!registration) return;
  let worker = registration.waiting ?? registration.installing;
  if (!worker && newVersion !== undefined) {
    // The version monitor stages a new build every five minutes at most; this one cannot wait.
    registration = await container.register(createServiceWorkerUrl(newVersion), {
      scope,
      type: 'classic',
      updateViaCache: 'none',
    });
    worker = registration.waiting ?? registration.installing;
  }
  if (!worker) return;
  await waitWhile(worker, 'installing', timeoutMs);
  if (worker.state !== 'installed') return;
  const takenOver = waitForNewController(container, timeoutMs);
  worker.postMessage({ type: 'takeOver' });
  await takenOver;
};

/**
 * Reloads the page on the newest build the server has: its worker takes over first, and the files
 * that failed to load in this page are fetched again.
 */
export const reloadForNewVersion = async ({
  timeoutMs = TAKE_OVER_TIMEOUT_MS,
  reload = () => window.location.reload(),
}: { timeoutMs?: number; reload?: () => void } = {}): Promise<void> => {
  try {
    await Promise.all([handOverToNewWorker(timeoutMs), refetchFailedModules(timeoutMs)]);
  } catch {
    // Without the new worker the reload still runs; a page the old one serves can retry.
  }
  reload();
};
