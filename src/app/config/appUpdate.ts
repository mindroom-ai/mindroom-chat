// What a page does after a deployment replaced the build it runs. The service worker precaches only
// a signed-in start (src/sw/sw.ts), so a page loads its other chunks from the server the first time it
// needs them, and a deployment that removed the previous build's files leaves the page unable to
// load them. When a part fails to load and the server publishes another version than this page's
// (version.json), the page says a new version is available (NewVersionNotice) and offers to reload.
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
 * Checks for a new version whenever a dynamic import fails. Production builds load every on-demand
 * chunk through Vite's preload helper, which reports each failure on the window; the importer still
 * gets its error and handles it as before. Returns a function that stops it.
 */
export const watchForNewVersion = (target: Window = window): (() => void) => {
  const onPreloadError = () => {
    checkForNewVersion().catch(() => undefined);
  };
  target.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  return () => target.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
};

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

/** Reloads the page on the newest build the server has: its worker takes over first. */
export const reloadForNewVersion = async ({
  timeoutMs = TAKE_OVER_TIMEOUT_MS,
  reload = () => window.location.reload(),
}: { timeoutMs?: number; reload?: () => void } = {}): Promise<void> => {
  try {
    await handOverToNewWorker(timeoutMs);
  } catch {
    // Without the new worker the reload still runs; a page the old one serves can retry.
  }
  reload();
};
