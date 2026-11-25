import { useSyncExternalStore } from 'react';
import { isCapacitorMediaShell, isDesktopApp } from '../../lib/nativeShell';
import { desktopMediaAuthReady, subscribeDesktopMediaAuth } from '../../native/desktopMediaAuth';
import type { SpecVersions } from '../cs-api';
import { supportsAuthenticatedMedia } from '../mediaUrl';
import { isServiceWorkerEnabled } from '../../config/runtimeConfig';
import { useSpecVersions } from './useSpecVersions';

// Authenticated media (Matrix 1.11) needs the access token in an Authorization header on every
// download. A controlling service worker adds it on the web, Electron's webRequest interceptor adds
// it on desktop, and Capacitor native shells authenticate via Bearer `fetch` (`authenticatedMediaRequestInit`
// and `useAvatarImage`) rather than `?access_token=` query parameters.

const hasServiceWorkerController = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

const hasNativeMediaTransport = (): boolean =>
  isDesktopApp() ? desktopMediaAuthReady() : isCapacitorMediaShell();

/** Whether some transport can attach the access token to media requests. */
export const hasMediaAuthTransportSupport = (
  serviceWorkerControlled: boolean,
  nativeTransport: boolean
): boolean => serviceWorkerControlled || nativeTransport;

/** Whether media URLs should use the authenticated endpoints. */
export const shouldUseMediaAuthentication = (
  specVersions: SpecVersions,
  transportSupported: boolean
): boolean => transportSupported && supportsAuthenticatedMedia(specVersions);

const readTransportSupport = (): boolean =>
  hasMediaAuthTransportSupport(
    isServiceWorkerEnabled() && hasServiceWorkerController(),
    hasNativeMediaTransport()
  );

const subscribeTransportSupport = (onChange: () => void): (() => void) => {
  const stopDesktop = subscribeDesktopMediaAuth(onChange);
  const serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  serviceWorker?.addEventListener('controllerchange', onChange);
  return () => {
    stopDesktop();
    serviceWorker?.removeEventListener('controllerchange', onChange);
  };
};

/**
 * Whether to request authenticated media. Follows the transport: media switches to the
 * authenticated endpoints once a worker takes control of the page or main holds the session.
 */
export const useMediaAuthentication = (): boolean => {
  const specVersions = useSpecVersions();
  const transportSupported = useSyncExternalStore(subscribeTransportSupport, readTransportSupport);
  return shouldUseMediaAuthentication(specVersions, transportSupported);
};

// Startup (src/index.tsx) reports a browser that cannot run the service worker. Media then goes to
// the legacy endpoints, which a homeserver may refuse; a legacy image that fails shows it does.
let workerUnavailable = false;
let legacyMediaFailed = false;
const listeners = new Set<() => void>();
const LEGACY_MEDIA_PATH = /\/_matrix\/media\/(?:v3|r0)\/(?:download|thumbnail)\//;

const handleImageError = (event: Event) => {
  const { target } = event;
  if (legacyMediaFailed || !(target instanceof HTMLImageElement)) return;
  if (!LEGACY_MEDIA_PATH.test(target.currentSrc || target.src)) return;
  legacyMediaFailed = true;
  listeners.forEach((listener) => listener());
};

/** Called at startup when no service worker can control this page. */
export const markServiceWorkerUnavailable = (): void => {
  if (workerUnavailable) return;
  workerUnavailable = true;
  // Load errors do not bubble, so the document hears them while they travel down to the image.
  document.addEventListener('error', handleImageError, true);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const readLegacyMediaRefused = () => workerUnavailable && legacyMediaFailed;

/**
 * Whether images fail because nothing in this window can add the access token: no service worker
 * can control it, the homeserver has authenticated media, and it refused a legacy media image.
 */
export const useMediaAuthenticationUnavailable = (): boolean => {
  const specVersions = useSpecVersions();
  const refused = useSyncExternalStore(subscribe, readLegacyMediaRefused);
  return refused && !readTransportSupport() && supportsAuthenticatedMedia(specVersions);
};
