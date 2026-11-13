// First: it must change the SDK's logger before any other SDK module loads.
import './app/diagnostics/sdkDebugLogging';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import './index.css';
import './app/theme/Typography.css';
import './app/i18n/i18n';
// Before the app routes: a redirect (to sign in, say) must not drop the `?plugins=off` that turns
// the client plugins off for this load.
import './app/plugins/registry';
import { deletePluginStorageOfRemovedAccounts } from './app/plugins/pluginStorage';
import App from './app/shell/App';
import {
  isNativeApp,
  isNativeIOS,
  registerNativeAppUrlCallbacks,
} from './app/native/nativeSso';
import { installFlightRecorder } from './app/diagnostics/flightRecorder';
import {
  initializeDeepTraceRecorder,
  recordDeepTraceEvent,
} from './app/diagnostics/deepTrace';
import {
  installIndexedDbLossRecovery,
  readRecoveryReloadAge,
} from './app/account/lifecycle/indexedDbLossRecovery';
import { resolveInitialTheme } from './app/theme/themeBootstrap';
import { applyAppTheme } from './app/theme/appliedTheme';
import { bootstrapRideTraceFlagFromUrl } from './app/timeline/rideTraceRecorder';
import { migratePrefetchSettingsStorage } from './app/event-store/engine/prefetchSettingsStorage';
import { migrateLegacyIOSPushEnabled } from './app/notifications/push/iosPush';
import { isServiceWorkerEnabled } from './app/config/runtimeConfig';
import { getActiveSession, subscribeToSessionStore } from './app/matrix/session/sessions';
import {
  answerServiceWorkerSessionRequests,
  pushSessionToSW,
  waitForServiceWorkerControl,
} from './sw/swSession';
import { APP_BUILD_VERSION, startAppVersionMonitor } from './app/config/appVersion';
import { watchForNewVersion } from './app/config/appUpdate';
import { createServiceWorkerUrl } from './app/config/serviceWorkerRegistration';
import { markServiceWorkerUnavailable } from './app/matrix/hooks/useMediaAuthentication';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from './boot/serviceWorkerNavigation';
import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/lib/basePath';
import { isQuickCapturePath } from './app/routes/pathUtils';
import { installErrorCapture } from './app/bug-reports/error-reporting/errorReporting';

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
  runSafely('theme', () => applyAppTheme(resolveInitialTheme()));
  runSafely('ride trace flag', () => bootstrapRideTraceFlagFromUrl());
  // The legacy push flag moves first, so the settings store migration sees it.
  runSafely('push setting migration', () => {
    migrateLegacyIOSPushEnabled();
  });
  runSafely('settings migration', () => {
    migratePrefetchSettingsStorage();
  });
  runSafely('plugin storage of removed accounts', deletePluginStorageOfRemovedAccounts);
  runSafely('native app links', () => {
    // Capacitor's App plugin reports the SSO and pairing links the native app opens with. The
    // quick capture widget's web view leaves them to the main one: followed there, a link would
    // take the widget's window away from the widget, to a second copy of the app.
    if (isNativeApp() && !isQuickCapturePath(window.location.pathname)) {
      registerNativeAppUrlCallbacks(NativeApp);
    }
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
 * that is still activating claims open pages when it finishes (src/sw/sw.ts), so this waits for it
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
 * A page the service worker does not control cannot load authenticated media. The worker claims
 * it when asked (src/sw/sw.ts), and the media hook follows the new controller. A signed-in page
 * that stays without one, as with an older worker that ignores the request, reloads once, marked
 * as a recovery navigation; the address, history state and scroll target stay as they were.
 */
const recoverServiceWorkerControl = async (): Promise<void> => {
  if (!navigator.serviceWorker.controller) {
    const worker = await getActiveServiceWorker();
    try {
      worker?.postMessage({ type: 'claim' });
    } catch {
      // A worker that cannot take the message leaves the reload below.
    }
  }
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
  if (!isServiceWorkerEnabled() || typeof navigator === 'undefined') return;
  // Without a worker (none in this browser, or registration refused, as in some private windows)
  // nothing adds the access token to media requests.
  if (!navigator.serviceWorker) {
    markServiceWorkerUnavailable();
    return;
  }
  const { serviceWorker } = navigator;
  Promise.resolve(
    serviceWorker.register(createServiceWorkerUrl(APP_BUILD_VERSION), {
      scope: ensureBasePathTrailingSlash(getAppBasePath()),
      type: 'classic',
      updateViaCache: 'none',
    })
  )
    .then((registration: ServiceWorkerRegistration | undefined) => {
      if (!registration) markServiceWorkerUnavailable();
    })
    .catch((error: unknown) => {
      markServiceWorkerUnavailable();
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

// A server answers a path it has no file for with this page, so a frame of this origin whose page
// is gone (the PDF viewer's frame page, say) would start a second copy of the app, on the same
// account and storage as the page around it. There it stops before any startup step: only its
// modules have loaded.
if (window.frameElement !== null) {
  throw new Error('MindRoom does not start inside a frame of its own origin');
}

// Before anything else runs: failures from here on wait for the configuration, which decides
// whether they become error reports.
runSafely('error capture', installErrorCapture);
startDiagnostics();
prepareDocument();
runSafely('new version watch', () => {
  // A part that cannot load after a deployment offers the new version (src/app/config/appUpdate.ts).
  watchForNewVersion();
});
runSafely('recovery marker', () => {
  // Reading sessionStorage throws where site data is blocked; startup must go on.
  if (window.sessionStorage.getItem(SW_CONTROL_RELOAD_KEY) === '1') clearRecoveryMarker();
});

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

startServiceWorker();
