import { useCallback, useEffect, useState } from 'react';
import { ThreepidMedium } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useAlive } from './useAlive';

type EmailNotificationsState = {
  /** The account's first email address, if it has one. */
  email?: string;
  /** Whether an email pusher sends notifications to that address. */
  enabled: boolean;
};

/**
 * Whether the homeserver emails notifications to the account's address: undefined while
 * loading, null when the homeserver could not tell. `refresh` reads it again.
 */
export const useEmailNotifications = (): [
  EmailNotificationsState | null | undefined,
  () => void
] => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const [state, setState] = useState<EmailNotificationsState | null>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
    Promise.all([mx.getThreePids(), mx.getPushers()])
      .then(([{ threepids }, { pushers }]) => {
        if (disposed || !alive()) return;
        const email = threepids.find(
          (threepid) => threepid.medium === ThreepidMedium.Email
        )?.address;
        const enabled =
          !!email && pushers.some((pusher) => pusher.kind === 'email' && pusher.pushkey === email);
        setState({ email, enabled });
      })
      .catch(() => {
        if (disposed || !alive()) return;
        setState(null);
      });
    return () => {
      disposed = true;
    };
  }, [mx, alive, version]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  return [state, refresh];
};
