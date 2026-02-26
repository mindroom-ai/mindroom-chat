import type { SpecVersions } from '../cs-api';
import { isServiceWorkerEnabled } from '../utils/runtimeConfig';
import { useSpecVersions } from './useSpecVersions';

const AUTHENTICATED_MEDIA_SPEC_VERSION = 'v1.11';
const AUTHENTICATED_MEDIA_UNSTABLE_FEATURE = 'org.matrix.msc3916.stable';

export const supportsAuthenticatedMedia = ({
  versions,
  unstable_features: unstableFeatures,
}: SpecVersions): boolean =>
  unstableFeatures?.[AUTHENTICATED_MEDIA_UNSTABLE_FEATURE] === true ||
  versions.includes(AUTHENTICATED_MEDIA_SPEC_VERSION);

export const hasServiceWorkerMediaAuthSupport = (
  serviceWorkerApiSupported: boolean = typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator,
  runtimeServiceWorkerEnabled: boolean = isServiceWorkerEnabled()
): boolean => serviceWorkerApiSupported && runtimeServiceWorkerEnabled;

// Capacitor iOS WebViews run on `capacitor://` and do not expose service workers,
// but we can still use authenticated media endpoints via token-in-query fallback.
export const hasCapacitorMediaAuthSupport = (
  protocol: string | undefined =
    typeof window !== 'undefined' ? window.location?.protocol : undefined
): boolean => protocol === 'capacitor:';

export const hasMediaAuthTransportSupport = (
  serviceWorkerAvailable: boolean = hasServiceWorkerMediaAuthSupport(),
  capacitorAvailable: boolean = hasCapacitorMediaAuthSupport()
): boolean => serviceWorkerAvailable || capacitorAvailable;

export const shouldUseMediaAuthentication = (
  specVersions: SpecVersions,
  mediaAuthTransportAvailable: boolean = hasMediaAuthTransportSupport()
): boolean => supportsAuthenticatedMedia(specVersions) && mediaAuthTransportAvailable;

export const useMediaAuthentication = (): boolean => shouldUseMediaAuthentication(useSpecVersions());
