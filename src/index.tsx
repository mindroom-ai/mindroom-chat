// First: it must change the SDK's logger before any other SDK module loads.
import './app/mindroom/matrix/sdkDebugLogging';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import './index.css';
import './app/i18n';
import App from './app/pages/App';
import {
  isNativeApp,
  isNativeIOS,
  registerNativeAppUrlCallbacks,
} from './app/mindroom/native/nativeSso';
import { installFlightRecorder } from './app/mindroom/diagnostics/flightRecorder';
import {
  initializeDeepTraceRecorder,
  recordDeepTraceEvent,
} from './app/mindroom/diagnostics/deepTrace';
import {
  installIndexedDbLossRecovery,
  readRecoveryReloadAge,
} from './app/mindroom/matrix/indexedDbLossRecovery';
import { applyThemeToDom, resolveInitialTheme } from './app/theme/themeBootstrap';
import { bootstrapRideTraceFlagFromUrl } from './app/mindroom/threads/rideTraceRecorder';
import { migrateMindroomSettingsStorage } from './app/mindroom/settings/mindroomSettingsStorage';
import { migrateLegacyIOSPushEnabled } from './app/mindroom/native/iosPush';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import { getActiveSession, subscribeToSessionStore } from './app/state/sessions';
import {
  answerServiceWorkerSessionRequests,
  pushSessionToSW,
  waitForServiceWorkerControl,
} from './sw-session';
import { APP_BUILD_VERSION, startAppVersionMonitor } from './appVersion';
import { createServiceWorkerUrl } from './serviceWorkerRegistration';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from './serviceWorkerNavigation';
import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';

/** Marks the one reload that recovers a page the service worker does not control. */
const SW_CONTROL_RELOAD_KEY = 'mindroom_sw_control_reloaded';

/** Runs a startup step; a failing optional step must never keep the app from mounting. */
const runSafely = (label: string, step: () => void): void => {
  try {
    step();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[startup] ${label} failed`, error);
  }
};

const startDiagnostics = (): void => {
  // The flight recorder and deep tracing exist for the iOS app, where crashes leave no console.
  if (isNativeIOS()) {
    runSafely('flight recorder', () => {
      installFlightRecorder();
    });
    runSafely('deep trace recorder', () => {
      initializeDeepTraceRecorder();
    });
  }
  runSafely('IndexedDB loss recovery', () => {
    const reloadAge = readRecoveryReloadAge();
    // Recorded after the deep trace recorder started, so the event is kept.
    if (reloadAge !== undefined) {
      recordDeepTraceEvent('storage.indexeddb_loss_reload', { reload_ms_ago: reloadAge });
    }
    installIndexedDbLossRecovery();
  });
};

const prepareDocument = (): void => {
  runSafely('theme', () => applyThemeToDom(resolveInitialTheme()));
  runSafely('ride trace flag', () => bootstrapRideTraceFlagFromUrl());
  // The legacy push flag moves first, so the settings store migration sees it.
  runSafely('push setting migration', () => {
    migrateLegacyIOSPushEnabled();
  });
  runSafely('settings migration', () => {
    migrateMindroomSettingsStorage();
  });
  runSafely('native app links', () => {
    // Capacitor's App plugin reports the SSO and pairing links the native app opens with.
    if (isNativeApp()) registerNativeAppUrlCallbacks(NativeApp);
  });
};

const pushActiveSession = (): void => {
  const session = getActiveSession();
  pushSessionToSW(session?.baseUrl, session?.accessToken);
};

/** The app's active service worker, if it has one. */
const getActiveServiceWorker = async (): Promise<ServiceWorker | undefined> => {
  try {
    const registration = await navigator.serviceWorker.getRegistration(
      ensureBasePathTrailingSlash(getAppBasePath())
    );
    return registration?.active ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether this app has an active worker that could take the page after a reload. Without one
 * (registration failed, was blocked, or is still installing) a reload changes nothing. A worker
 * that is still activating claims open pages when it finishes (src/sw.ts), so this waits for it
 * to finish: a first install that ends just after the page loaded must not cost a reload.
 */
const hasActivatedServiceWorker = async (): Promise<boolean> => {
  const worker = await getActiveServiceWorker();
  if (!worker) return false;
  if (worker.state === 'activating') {
    await new Promise<void>((resolve) => {
      const settled = () => {
        if (worker.state === 'activating') return;
        worker.removeEventListener('statechange', settled);
        resolve();
      };
      worker.addEventListener('statechange', settled);
    });
  }
  return worker.state !== 'redundant';
};

/**
 * A signed-in page the service worker does not control cannot load
 * authenticated media. Reload once, marked as a recovery navigation, so the
 * worker can take the page; the address, history state and scroll target
 * stay as they were.
 */
const recoverServiceWorkerControl = async (): Promise<void> => {
  if (!getActiveSession()) return;
  let alreadyReloaded = true;
  runSafely('recovery reload marker', () => {
    alreadyReloaded = window.sessionStorage.getItem(SW_CONTROL_RELOAD_KEY) === '1';
  });
  // Without a readable marker a reload could loop, so stay on this page.
  if (alreadyReloaded) return;
  if (await waitForServiceWorkerControl()) return;
  if (!(await hasActivatedServiceWorker())) return;
  // A worker that just finished activating has claimed this page, or does so in a moment.
  if (await waitForServiceWorkerControl(1_000)) return;

  const url = new URL(window.location.href);
  url.searchParams.set(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM, '1');
  try {
    window.history.replaceState(window.history.state, '', url.href);
  } catch {
    // Without a way to mark the navigation, a reload could loop; stay on this page.
    return;
  }
  try {
    window.sessionStorage.setItem(SW_CONTROL_RELOAD_KEY, '1');
  } catch {
    return;
  }
  window.location.reload();
};

const clearRecoveryMarker = (): void => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM)) return;
  url.searchParams.delete(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url.href);
  } catch {
    // The marker stays in the address bar; it does nothing on the next load.
  }
};

const startServiceWorker = (): void => {
  if (!isServiceWorkerEnabled() || typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return;
  }
  const { serviceWorker } = navigator;
  Promise.resolve(
    serviceWorker.register(createServiceWorkerUrl(APP_BUILD_VERSION), {
      scope: ensureBasePathTrailingSlash(getAppBasePath()),
      type: 'classic',
      updateViaCache: 'none',
    })
  ).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[startup] service worker registration failed', error, appUrl('sw.js'));
  });
  serviceWorker.addEventListener('controllerchange', pushActiveSession);
  // The worker asks when a media request arrives from a tab it has no session for.
  runSafely('session requests', () => {
    answerServiceWorkerSessionRequests(getActiveSession);
  });
  runSafely('session sync', () => {
    subscribeToSessionStore(pushActiveSession);
  });
  Promise.resolve(serviceWorker.ready)
    .then(() => pushActiveSession())
    .catch(() => undefined);
  runSafely('version monitor', () => {
    startAppVersionMonitor();
  });
  recoverServiceWorkerControl().catch(() => undefined);
};

startDiagnostics();
prepareDocument();
runSafely('recovery marker', () => {
  // Reading sessionStorage throws where site data is blocked; startup must go on.
  if (window.sessionStorage.getItem(SW_CONTROL_RELOAD_KEY) === '1') clearRecoveryMarker();
});

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

startServiceWorker();
