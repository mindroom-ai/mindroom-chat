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
        console.log(`[Cinny] Persistent storage: ${granted ? 'granted' : 'denied'}`);
      })
      .catch((err) => {
        console.warn('[Cinny] Persistent storage request failed:', err);
      });
  }

  if ('serviceWorker' in navigator && isServiceWorkerEnabled()) {
    const postCurrentSessionToSW = () => {
      const session = getActiveSession();
      pushSessionToSW(session?.baseUrl, session?.accessToken);
    };
    subscribeToSessionStore(postCurrentSessionToSW);

    const isProductionSW = import.meta.env.MODE === 'production';
    const swUrl = isProductionSW ? appUrl('sw.js') : appUrl('dev-sw.js?dev-sw');

    navigator.serviceWorker.ready.then(postCurrentSessionToSW).catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', postCurrentSessionToSW);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'requestSession') postCurrentSessionToSW();
    });
    try {
      await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
        // vite-plugin-pwa's devOptions serve dev-sw.js as an ES module
        // (type: 'module' in vite.config.js); registering it as a classic
        // script throws "Cannot use import statement outside a module" and
        // dev runs silently without a service worker. The production sw.js
        // is bundled as a classic script.
        type: isProductionSW ? 'classic' : 'module',
      });
    } catch {
      // Keep booting even if service worker registration fails.
    }

    if (!navigator.serviceWorker.controller && getActiveSession()) {
      await waitForServiceWorkerControl();
    }

    postCurrentSessionToSW();
  }

  mountApp();
};

bootstrap().catch(() => undefined);
