import { useEffect, useMemo, useState } from 'react';
import { UserEvent, type MatrixClient, type MatrixEvent, type User } from 'matrix-js-sdk';

/**
 * The presence status messages of these users, following presence updates. A user the client
 * has heard nothing of yet is looked up once, since agents announce voice calls there.
 */
export const usePresenceStatuses = (
  mx: MatrixClient,
  userIds: string[]
): ReadonlyMap<string, string | undefined> => {
  const key = userIds.join('\n');
  const ids = useMemo(() => (key ? key.split('\n') : []), [key]);
  const read = () =>
    new Map(ids.map((userId) => [userId, mx.getUser(userId)?.presenceStatusMsg] as const));
  const [statuses, setStatuses] = useState(read);

  useEffect(() => {
    let active = true;
    const watched = new Set(ids);
    setStatuses(read());
    const onPresence = (_event: MatrixEvent | undefined, user: User) => {
      if (!watched.has(user.userId)) return;
      setStatuses((current) => new Map(current).set(user.userId, user.presenceStatusMsg));
    };
    mx.on(UserEvent.Presence, onPresence);
    ids
      .filter((userId) => mx.getUser(userId)?.presenceStatusMsg === undefined)
      .forEach((userId) => {
        mx.getPresence(userId)
          .then((presence) => {
            if (!active) return;
            setStatuses((current) => new Map(current).set(userId, presence.status_msg));
          })
          .catch(() => undefined);
      });
    return () => {
      active = false;
      mx.off(UserEvent.Presence, onPresence);
    };
    // `read` only depends on `mx` and `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, ids]);

  return statuses;
};
