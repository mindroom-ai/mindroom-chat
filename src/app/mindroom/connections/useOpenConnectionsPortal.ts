import { useCallback } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';
import { openConnectionsPortal } from './openConnections';

/**
 * Open a backend's Connections portal signed in as the current Matrix user, optionally to open an agent link there.
 * `discovered` marks backends that agents published, whose token waits for a fresh binding check.
 * Call the returned function synchronously from a click handler so popup blockers allow the window.
 */
export const useOpenConnectionsPortal = (discovered: boolean) => {
  const mx = useMatrixClient();
  return useCallback(
    (backendUrl: string, next?: string) =>
      openConnectionsPortal({
        backendUrl,
        next,
        getOpenIdToken: async (audience) => {
          // An account switch stops this client but not the portal session, so a stopped client never answers.
          if (!mx.clientRunning) throw new Error('Matrix client stopped');
          const token = await requestAudienceOpenIdToken(mx, audience, {
            requireBinding: discovered,
          });
          if (!mx.clientRunning) throw new Error('Matrix client stopped');
          return token;
        },
      }),
    [mx, discovered]
  );
};
