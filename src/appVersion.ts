import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';

declare const __MINDROOM_BUILD_VERSION__: string;

export const APP_BUILD_VERSION =
  typeof __MINDROOM_BUILD_VERSION__ === 'string' ? __MINDROOM_BUILD_VERSION__ : 'development-build';
export const APP_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const APP_VERSION_FETCH_TIMEOUT_MS = 5 * 1000;
const SERVICE_WORKER_ACTIVATION_TIMEOUT_MS = 15 * 1000;

type AppVersionManifest = {
  version?: unknown;
};

export const fetchPublishedAppVersion = async (): Promise<string | undefined> => {
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => abortController.abort(),
    APP_VERSION_FETCH_TIMEOUT_MS
  );
  try {
    const url = new URL(appUrl('version.json'), window.location.origin);
    url.searchParams.set('cache-bust', `${Date.now()}`);
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: abortController.signal,
    });
    if (!response.ok) return undefined;

    const manifest = (await response.json()) as AppVersionManifest;
    const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
    return /^[A-Za-z0-9._+-]{1,128}$/.test(version) ? version : undefined;
  } catch {
    // Version discovery must never interfere with offline or degraded use.
    return undefined;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

const waitForWorkerActivation = async (
  registration: ServiceWorkerRegistration
): Promise<boolean> => {
  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    // No candidate means the fetched worker was byte-identical to the active
    // one. The active worker already owns the newly published app shell.
    return Boolean(registration.active);
  }
  if (worker.state === 'activated') return true;
  if (worker.state === 'redundant') return false;

  return new Promise<boolean>((resolve) => {
    let finish: (activated: boolean) => void = () => undefined;
    const handleStateChange = () => {
      if (worker.state === 'activated') finish(true);
      if (worker.state === 'redundant') finish(false);
    };
    const timeoutId = globalThis.setTimeout(
      () => finish(false),
      SERVICE_WORKER_ACTIVATION_TIMEOUT_MS
    );
    finish = (activated: boolean) => {
      globalThis.clearTimeout(timeoutId);
      worker.removeEventListener('statechange', handleStateChange);
      resolve(activated);
    };
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });
};

type AppVersionMonitorOptions = {
  pollIntervalMs?: number;
  reload?: () => void;
};

export const startAppVersionMonitor = ({
  pollIntervalMs = APP_VERSION_POLL_INTERVAL_MS,
  reload = () => window.location.reload(),
}: AppVersionMonitorOptions = {}): (() => void) => {
  let stopped = false;
  let checking = false;
  let pendingVersion: string | undefined;
  let reloadRequestedVersion: string | undefined;

  const check = async () => {
    if (stopped || checking || !navigator.onLine) return;
    checking = true;
    try {
      const publishedVersion = await fetchPublishedAppVersion();
      if (!publishedVersion || publishedVersion === APP_BUILD_VERSION || stopped) return;

      pendingVersion = publishedVersion;
      const swUrl = new URL(appUrl('sw.js'), window.location.origin);
      swUrl.searchParams.set('version', publishedVersion);
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
        type: 'classic',
        updateViaCache: 'none',
      });
      if (await waitForWorkerActivation(registration)) handleControllerChange();
    } catch {
      // A failed update check is equivalent to no update. Keep the current,
      // fully loaded application running, especially when connectivity drops.
      pendingVersion = undefined;
    } finally {
      checking = false;
    }
  };

  const handleControllerChange = () => {
    if (stopped || !pendingVersion || !navigator.onLine) return;
    if (reloadRequestedVersion === pendingVersion) return;
    try {
      const reloadKey = 'mindroom_app_version_reloading';
      if (window.sessionStorage.getItem(reloadKey) === pendingVersion) return;
      window.sessionStorage.setItem(reloadKey, pendingVersion);
    } catch {
      // Reloading is still safe if sessionStorage is blocked: controllerchange
      // only fires once for this newly activated worker.
    }
    reloadRequestedVersion = pendingVersion;
    reload();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') check().catch(() => undefined);
  };
  const handleOnline = () => {
    const controllerVersion = (() => {
      try {
        const scriptUrl = navigator.serviceWorker.controller?.scriptURL;
        return scriptUrl ? new URL(scriptUrl).searchParams.get('version') : undefined;
      } catch {
        return undefined;
      }
    })();
    if (pendingVersion && controllerVersion === pendingVersion) {
      handleControllerChange();
      return;
    }
    check().catch(() => undefined);
  };

  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);
  const intervalId = window.setInterval(() => check().catch(() => undefined), pollIntervalMs);
  check().catch(() => undefined);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
  };
};
