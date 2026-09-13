import { appUrl } from './app/utils/basePath';
import { getServiceWorkerNavigationFallbackExcludePaths } from './app/utils/runtimeConfig';
import { NAVIGATION_FALLBACK_EXCLUDE_PARAM } from './serviceWorkerNavigation';

export const createServiceWorkerUrl = (version: string, origin = window.location.origin): URL => {
  const url = new URL(appUrl('sw.js'), origin);
  url.searchParams.set('version', version);
  getServiceWorkerNavigationFallbackExcludePaths().forEach((path) => {
    url.searchParams.append(NAVIGATION_FALLBACK_EXCLUDE_PARAM, path);
  });
  return url;
};
