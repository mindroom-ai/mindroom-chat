import { useCallback, useRef, useState } from 'react';
import type { StoredSession } from '../../matrix/session/sessions';
import { removeStoredSession } from '../lifecycle/initMatrix';

/**
 * Removing an inactive account from this device, one at a time: while a removal runs, its
 * session is `removingSessionId` (the switcher shows it busy) and further requests are ignored.
 */
export const useAccountRemoval = (onRemoved: () => void, onFailed: () => void) => {
  const [removingSessionId, setRemovingSessionId] = useState<string>();
  const running = useRef(false);

  const remove = useCallback(
    async (session: StoredSession) => {
      if (running.current) return;
      running.current = true;
      setRemovingSessionId(session.sessionId);
      try {
        await removeStoredSession(session);
        onRemoved();
      } catch {
        onFailed();
      } finally {
        running.current = false;
        setRemovingSessionId(undefined);
      }
    },
    [onFailed, onRemoved]
  );

  return { removingSessionId, remove };
};
