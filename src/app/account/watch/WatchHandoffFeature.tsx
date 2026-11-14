import { useEffect, useState } from 'react';
import { KnownMembership } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useClientStartupContext } from '../../matrix/ClientStartupContext';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { OPENED_FROM_OUTSIDE_STATE } from '../../routes/historyStack';
import { onWatchOpenThread, type WatchThread } from '../../native/nativeWatch';

/**
 * On the iOS app, opens the thread the Apple Watch hands off ("Open on iPhone") once the first
 * sync is done, as a tapped push opens its message. A room this account is not in is ignored.
 */
export function WatchHandoffFeature() {
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [target, setTarget] = useState<WatchThread>();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    void onWatchOpenThread(setTarget).then((remove) => {
      if (alive) stop = remove;
      else remove();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!target || !hasCompletedInitialSync) return;
    setTarget(undefined);
    if (mx.getRoom(target.roomId)?.getMyMembership() !== KnownMembership.Join) return;
    navigateRoom(target.roomId, target.threadId, { state: OPENED_FROM_OUTSIDE_STATE });
  }, [hasCompletedInitialSync, mx, navigateRoom, target]);

  return null;
}
