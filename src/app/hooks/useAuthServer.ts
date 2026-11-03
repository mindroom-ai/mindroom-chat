import { useParams } from 'react-router-dom';
import { useClientConfig } from './useClientConfig';

/**
 * The server the login, registration or reset page is for: the `:server` route segment, else
 * the configured default homeserver.
 */
export const useAuthServer = (): string => {
  const { server } = useParams();
  const { homeserverList, defaultHomeserver } = useClientConfig();
  if (server) return decodeURIComponent(server);
  return homeserverList?.[defaultHomeserver ?? 0] ?? homeserverList?.[0] ?? '';
};
