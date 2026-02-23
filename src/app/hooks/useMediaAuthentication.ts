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

export const shouldUseMediaAuthentication = (
  specVersions: SpecVersions,
  serviceWorkerAvailable: boolean = hasServiceWorkerMediaAuthSupport()
): boolean => supportsAuthenticatedMedia(specVersions) && serviceWorkerAvailable;

export const useMediaAuthentication = (): boolean => shouldUseMediaAuthentication(useSpecVersions());
