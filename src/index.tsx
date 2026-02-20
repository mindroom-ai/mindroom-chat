/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';

import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';

document.body.classList.add(configClass, varsClass);

// Register Service Worker
if ('serviceWorker' in navigator && isServiceWorkerEnabled()) {
  const swUrl =
    import.meta.env.MODE === 'production'
      ? appUrl('sw.js')
      : appUrl('dev-sw.js?dev-sw');

  navigator.serviceWorker.register(swUrl, { scope: ensureBasePathTrailingSlash(getAppBasePath()) });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'token' && event.data?.responseKey) {
      // Get the token for SW.
      const token = localStorage.getItem('cinny_access_token') ?? undefined;
      event.source!.postMessage({
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
