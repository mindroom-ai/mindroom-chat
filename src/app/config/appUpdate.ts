// What a page does after a deployment replaced the build it runs. The service worker precaches only
// a signed-in start (src/sw/sw.ts), so a page loads its other chunks from the server the first time it
// needs them, and a deployment that removed the previous build's files leaves the page unable to
// load them. When the server publishes another version than this page's (version.json), the page
// says a new version is available (NewVersionNotice) and offers to reload. It asks when the page
// starts, when a part fails to load, when the page is shown again or comes back online, and every
// five minutes while shown. The start matters most: the previous build's worker answers a reload
// (and a discarded tab or a phone app that comes back) with the previous build.
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
//
// The server may now publish another app, such as the legacy app after a rollback, whose worker
// never takes over when asked. Every reload would then come back to this build with the same
// notice. So when the new worker does not install or take over, and the server answers with
// another version than this page's, the page unregisters its worker and the reload comes from the
// server. Offline, the worker stays: the reload needs it.

import {
  APP_BUILD_VERSION,
  APP_VERSION_POLL_INTERVAL_MS,
  fetchPublishedAppVersion,
} from './appVersion';
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

/** The version the server publishes when it is not this page's, once the page asked. */
export const getNewVersion = (): string | undefined => newVersion;

export const subscribeToNewVersion = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Asks the server which version it publishes. Offline, or when the server still has this page's
 * version, nothing changes: a part that failed to load failed for another reason and loads again
 * on its next use.
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
 * the importer still gets its error and handles it as before. A deployment is also noticed with
 * nothing failing, which a page that already loaded every part it uses never would: once the page
 * has started, when it is shown again or comes back online, and every five minutes while it is
 * shown. Returns a function that stops it.
 */
export const watchForNewVersion = (target: Window = window): (() => void) => {
  const check = () => {
    checkForNewVersion().catch(() => undefined);
  };
  const checkWhenShown = () => {
    if (target.document.visibilityState !== 'hidden') check();
  };
  const onPreloadError = check;
  // A link's error does not bubble, so the window hears it while capturing.
  const onResourceError = (event: Event) => {
    const link = event.target;
    if (link instanceof HTMLLinkElement && link.rel === 'modulepreload')
      failedModules.add(link.href);
  };
  target.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  target.addEventListener('error', onResourceError, true);
  target.document.addEventListener('visibilitychange', checkWhenShown);
  target.addEventListener('online', checkWhenShown);
  const timer = target.setInterval(checkWhenShown, APP_VERSION_POLL_INTERVAL_MS);
  // After the start's own work: a page the previous build's worker served may be that build.
  const start = target.setTimeout(checkWhenShown, 0);
  return () => {
    target.clearTimeout(start);
    target.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
    target.removeEventListener('error', onResourceError, true);
    target.document.removeEventListener('visibilitychange', checkWhenShown);
    target.removeEventListener('online', checkWhenShown);
    target.clearInterval(timer);
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

/** Resolves true on the next controller change of `container`, false after `timeoutMs`. */
const waitForNewController = (container: ServiceWorkerContainer, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const finish = (changed: boolean) => {
      clearTimeout(timer);
      container.removeEventListener('controllerchange', onChange);
      resolve(changed);
    };
    const onChange = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    container.addEventListener('controllerchange', onChange);
  });

/**
 * Hands this page to the new build's worker. Resolves false when the new worker failed to install
 * or did not take over in time, and true otherwise, including when there was nothing to hand over.
 */
const handOverToNewWorker = async (timeoutMs: number): Promise<boolean> => {
  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (!container) return true;
  const scope = ensureBasePathTrailingSlash(getAppBasePath());
  let registration = await container.getRegistration(scope);
  if (!registration) return true;
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
  if (!worker) return true;
  await waitWhile(worker, 'installing', timeoutMs);
  // An activating or activated worker claims the page itself.
  if (worker.state === 'activating' || worker.state === 'activated') return true;
  if (worker.state !== 'installed') return false;
  const takenOver = waitForNewController(container, timeoutMs);
  worker.postMessage({ type: 'takeOver' });
  return takenOver;
};

/**
 * Unregisters this page's worker when the server publishes another version than this page's, so
 * the reload comes from the server rather than from this build's shell.
 */
const retireWorker = async (): Promise<void> => {
  const published = await fetchPublishedAppVersion();
  if (!published || published === APP_BUILD_VERSION) return;
  const registration = await navigator.serviceWorker.getRegistration(
    ensureBasePathTrailingSlash(getAppBasePath())
  );
  await registration?.unregister();
};

/** Hands the page to the new worker, or retires the current one when the new one cannot take it. */
const prepareWorkerForReload = async (timeoutMs: number): Promise<void> => {
  const handedOver = await handOverToNewWorker(timeoutMs).catch(() => false);
  if (!handedOver) await retireWorker();
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
    await Promise.all([prepareWorkerForReload(timeoutMs), refetchFailedModules(timeoutMs)]);
  } catch {
    // Without the new worker the reload still runs; a page the old one serves can retry.
  }
  reload();
};
