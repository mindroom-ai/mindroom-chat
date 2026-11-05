import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { SpecVersions } from '../cs-api';
import { supportsAuthenticatedMedia } from '../mediaUrl';
import { isServiceWorkerEnabled } from '../../config/runtimeConfig';
import { useSpecVersions } from './useSpecVersions';

// Authenticated media (Matrix 1.11) needs the access token on every download. A controlling
// service worker adds it as a header; native shells without one put it in the media URL.

const hasServiceWorkerController = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

const hasNativeMediaTransport = (): boolean => {
  const protocol = typeof window === 'undefined' ? undefined : window.location?.protocol;
  if (protocol && protocol !== 'http:' && protocol !== 'https:') return true;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

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

/**
 * Whether to request authenticated media. Follows the service worker: media switches to the
 * authenticated endpoints once a worker takes control of the page.
 */
export const useMediaAuthentication = (): boolean => {
  const specVersions = useSpecVersions();
  const [transportSupported, setTransportSupported] = useState(readTransportSupport);

  useEffect(() => {
    const serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!serviceWorker) return undefined;
    const handleControllerChange = () => setTransportSupported(readTransportSupport());
    handleControllerChange();
    serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => serviceWorker.removeEventListener('controllerchange', handleControllerChange);
  }, []);

  return shouldUseMediaAuthentication(specVersions, transportSupported);
};
