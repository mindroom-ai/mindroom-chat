import { AutoDiscoveryInfo, isAllowedHomeserverBaseUrl } from '../cs-api';
import { useAutoDiscoveryInfo } from './useAutoDiscoveryInfo';

export const getLivekitServiceUrl = (autoDiscoveryInfo: AutoDiscoveryInfo): string | undefined => {
  const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'];
  if (!Array.isArray(rtcFoci)) return undefined;

  for (const value of rtcFoci as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const info = value as Record<string, unknown>;
    const livekitServiceUrl = info.livekit_service_url;
    if (
      info.type === 'livekit' &&
      typeof livekitServiceUrl === 'string' &&
      isAllowedHomeserverBaseUrl(livekitServiceUrl)
    ) {
      return livekitServiceUrl;
    }
  }

  return undefined;
};

export const livekitSupport = (autoDiscoveryInfo: AutoDiscoveryInfo): boolean => {
  return getLivekitServiceUrl(autoDiscoveryInfo) !== undefined;
};

export const useLivekitSupport = (): boolean => {
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  return livekitSupport(autoDiscoveryInfo);
};
