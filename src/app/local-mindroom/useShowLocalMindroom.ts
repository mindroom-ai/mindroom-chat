import { useClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { resolveProvisioningRequest } from './provisioning';

// Local MindRoom pairs through the provisioning service, which only accounts on
// its homeserver can authenticate to, so other accounts get no entry point.
export const useShowLocalMindroom = (): boolean => {
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  if (!(sidebar?.showMindRoom ?? true)) return false;

  return resolveProvisioningRequest({
    sessionHomeserverUrl: mx.getHomeserverUrl(),
    provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
    accessToken: mx.getAccessToken() ?? undefined,
  }).canAuthenticate;
};
