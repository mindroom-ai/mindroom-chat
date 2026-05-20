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
import { isNativeApp, routeNativeSsoCallback } from './app/mindroom/native/nativeSso';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import { pushSessionToSW, waitForServiceWorkerControl } from './sw-session';
import { getActiveSession, subscribeToSessionStore } from './app/state/sessions';
import App from './app/pages/App';
import { applyThemeToDom, resolveInitialTheme } from './app/theme/themeBootstrap';

// import i18n (needs to be bundled ;))
import './app/i18n';

applyThemeToDom(resolveInitialTheme());

const handleNativeSSOCallback = (url: string) => {
  routeNativeSsoCallback(url);
};

if (isNativeApp()) {
  CapacitorApp.getLaunchUrl()
    .then((launchUrl) => {
      const url = launchUrl?.url;
      if (url) handleNativeSSOCallback(url);
    })
    .catch(() => undefined);

  CapacitorApp.addListener('appUrlOpen', (event) => {
    if (event.url) handleNativeSSOCallback(event.url);
  }).catch(() => undefined);
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

    const swUrl =
      import.meta.env.MODE === 'production' ? appUrl('sw.js') : appUrl('dev-sw.js?dev-sw');

    navigator.serviceWorker.ready.then(postCurrentSessionToSW).catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', postCurrentSessionToSW);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'token' && event.data?.responseKey) {
        // Get the token for SW.
        const token = getActiveSession()?.accessToken;
        event.source?.postMessage({
          responseKey: event.data.responseKey,
          token,
        });
      }
    });

    try {
      await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
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
