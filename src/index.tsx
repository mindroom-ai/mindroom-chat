/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';

import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';
import { getAppPathFromNativeSsoUrl } from './app/utils/nativeSso';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import { pushSessionToSW } from './sw-session';
import { getActiveSession, subscribeToSessionStore } from './app/state/sessions';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';

document.body.classList.add(configClass, varsClass);

const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

const handleNativeSSOCallback = (url: string) => {
  const appPath = getAppPathFromNativeSsoUrl(url);
  if (!appPath) return;
  try {
    // Handle SSO callback as an SPA route transition (no full WebView reload),
    // preventing iOS from treating path params like `mindroom.chat` as file paths.
    window.history.replaceState(null, '', appPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    window.location.replace(appPath);
  }
};

if (isNativeIOS) {
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

// Register Service Worker
if ('serviceWorker' in navigator && isServiceWorkerEnabled()) {
  const postCurrentSessionToSW = () => {
    const session = getActiveSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };
  subscribeToSessionStore(postCurrentSessionToSW);

  const swUrl =
    import.meta.env.MODE === 'production'
      ? appUrl('sw.js')
      : appUrl('dev-sw.js?dev-sw');

  navigator.serviceWorker.register(swUrl, { scope: ensureBasePathTrailingSlash(getAppBasePath()) });
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

mountApp();
