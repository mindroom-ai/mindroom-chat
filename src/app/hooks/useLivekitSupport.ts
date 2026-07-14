import { AutoDiscoveryInfo, isAllowedHomeserverBaseUrl } from '../cs-api';
import { useAutoDiscoveryInfo } from './useAutoDiscoveryInfo';

export const getLivekitServiceUrl = (autoDiscoveryInfo: AutoDiscoveryInfo): string | undefined => {
  const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'];
  if (!Array.isArray(rtcFoci)) return undefined;

  return rtcFoci.find(
    (info) =>
      info.type === 'livekit' &&
      typeof info.livekit_service_url === 'string' &&
      isAllowedHomeserverBaseUrl(info.livekit_service_url)
  )?.livekit_service_url;
};

export const livekitSupport = (autoDiscoveryInfo: AutoDiscoveryInfo): boolean => {
  return getLivekitServiceUrl(autoDiscoveryInfo) !== undefined;
};

export const useLivekitSupport = (): boolean => {
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  return livekitSupport(autoDiscoveryInfo);
};
