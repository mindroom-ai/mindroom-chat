/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { App as CapacitorApp } from '@capacitor/app';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import 'katex/dist/katex.min.css';

enableMapSet();

import './index.css';

import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';
import { isNativeApp, registerNativeSsoCallbacks } from './app/mindroom/native/nativeSso';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import { pushSessionToSW, waitForServiceWorkerControl } from './sw-session';
import { getActiveSession, subscribeToSessionStore } from './app/state/sessions';
import App from './app/pages/App';
import { applyThemeToDom, resolveInitialTheme } from './app/theme/themeBootstrap';
import { bootstrapRideTraceFlagFromUrl } from './app/mindroom/threads/rideTraceRecorder';
import { migrateMindroomSettingsStorage } from './app/mindroom/settings/mindroomSettingsStorage';
import { migrateLegacyIOSPushEnabled } from './app/mindroom/native/iosPush';
import { APP_BUILD_VERSION, fetchPublishedAppVersion, startAppVersionMonitor } from './appVersion';

// import i18n (needs to be bundled ;))
import './app/i18n';

applyThemeToDom(resolveInitialTheme());
// On-device scroll diagnostics: `?ridetrace=1` arms the timeline ride
// recorder (persisted; `?ridetrace=0` disarms). Read here because the
// router drops query params on navigation.
bootstrapRideTraceFlagFromUrl();

if (isNativeApp()) {
  registerNativeSsoCallbacks(CapacitorApp);
}

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

const bootstrap = async () => {
  migrateLegacyIOSPushEnabled();
  migrateMindroomSettingsStorage();

  // Request persistent storage to prevent browser from evicting IndexedDB
  if (navigator.storage?.persist) {
    navigator.storage
      .persist()
      .then((granted) => {
        console.log(`[MindRoom Chat] Persistent storage: ${granted ? 'granted' : 'denied'}`);
      })
      .catch((err) => {
        console.warn('[MindRoom Chat] Persistent storage request failed:', err);
      });
  }

  if ('serviceWorker' in navigator && isServiceWorkerEnabled()) {
    const postCurrentSessionToSW = () => {
      const session = getActiveSession();
      pushSessionToSW(session?.baseUrl, session?.accessToken);
    };
    subscribeToSessionStore(postCurrentSessionToSW);

    const isProductionSW = import.meta.env.MODE === 'production';
    const swUrl = isProductionSW
      ? `${appUrl('sw.js')}?version=${encodeURIComponent(APP_BUILD_VERSION)}`
      : appUrl('dev-sw.js?dev-sw');

    navigator.serviceWorker.ready.then(postCurrentSessionToSW).catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', postCurrentSessionToSW);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'requestSession') postCurrentSessionToSW();
    });
    try {
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
        // vite-plugin-pwa's devOptions serve dev-sw.js as an ES module
        // (type: 'module' in vite.config.js); registering it as a classic
        // script throws "Cannot use import statement outside a module" and
        // dev runs silently without a service worker. The production sw.js
        // is bundled as a classic script.
        type: isProductionSW ? 'classic' : 'module',
        updateViaCache: 'none',
      });
      if (isProductionSW) startAppVersionMonitor(registration);
    } catch {
      // Keep booting even if service worker registration fails.
    }

    // A force-reload loads the page uncontrolled for its entire lifetime
    // (re-registering an unchanged worker never fires controllerchange),
    // which would leave authenticated media broken all session. One
    // guarded reload restores control; the flag prevents a reload loop
    // when no worker can take over. The flag is cleared on EVERY
    // controlled boot — the reloaded page boots controlled and skips the
    // guard below, so clearing only inside it would arm the guard once
    // per tab lifetime.
    const RELOAD_FLAG = 'mindroom_sw_control_reloaded';
    try {
      if (navigator.serviceWorker.controller) {
        window.sessionStorage.removeItem(RELOAD_FLAG);
      } else if (getActiveSession()) {
        const controlled = await waitForServiceWorkerControl();
        if (controlled) {
          window.sessionStorage.removeItem(RELOAD_FLAG);
        } else {
          const registration = await navigator.serviceWorker
            .getRegistration()
            .catch(() => undefined);
          const publishedVersion = navigator.onLine ? await fetchPublishedAppVersion() : undefined;
          if (
            publishedVersion &&
            registration?.active &&
            !window.sessionStorage.getItem(RELOAD_FLAG)
          ) {
            window.sessionStorage.setItem(RELOAD_FLAG, '1');
            window.location.reload();
            return;
          }
        }
      }
    } catch {
      // Blocked sessionStorage degrades to the pre-fix behavior.
    }

    postCurrentSessionToSW();
  }

  try {
    if (window.sessionStorage.getItem('mindroom_app_version_reloading') === APP_BUILD_VERSION) {
      window.sessionStorage.removeItem('mindroom_app_version_reloading');
    }
  } catch {
    // Blocked sessionStorage does not affect app startup.
  }

  mountApp();
};

bootstrap().catch(() => undefined);
