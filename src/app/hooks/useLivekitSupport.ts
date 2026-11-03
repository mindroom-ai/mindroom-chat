import { useMemo } from 'react';
import type { AutoDiscoveryInfo } from '../cs-api';
import { useAutoDiscoveryInfo } from './useAutoDiscoveryInfo';

/** The well-known key that lists the MatrixRTC transports (MSC4143). */
export const RTC_FOCI_WELL_KNOWN_KEY = 'org.matrix.msc4143.rtc_foci';

type LivekitFocus = { type: 'livekit'; livekit_service_url: string };

const isLivekitFocus = (focus: unknown): focus is LivekitFocus => {
  if (!focus || typeof focus !== 'object') return false;
  const { type, livekit_service_url: serviceUrl } = focus as Record<string, unknown>;
  return type === 'livekit' && typeof serviceUrl === 'string' && serviceUrl.length > 0;
};

/** The LiveKit authorization services the homeserver announces. */
export const getLivekitServiceUrls = (info: AutoDiscoveryInfo): string[] => {
  const foci = info[RTC_FOCI_WELL_KNOWN_KEY];
  if (!Array.isArray(foci)) return [];
  return foci.filter(isLivekitFocus).map((focus) => focus.livekit_service_url);
};

/** Whether the homeserver announces a LiveKit service, which calls need. */
export const useLivekitSupport = (): boolean => {
  const info = useAutoDiscoveryInfo();
  return useMemo(() => getLivekitServiceUrls(info).length > 0, [info]);
};
