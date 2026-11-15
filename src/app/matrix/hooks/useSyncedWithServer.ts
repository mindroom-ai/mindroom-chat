import { useCallback, useEffect, useState } from 'react';
import { type MatrixClient, SyncState } from 'matrix-js-sdk';
import { useSyncState } from './useSyncState';

/**
 * Whether the client has synced with its homeserver since the page started. A start from the
 * stored copy of the last session counts as ready before that (`hasCompletedInitialSync`), with
 * account data as old as that copy; this turns true with the first answer of the server, which
 * the client reports as `Syncing`, and stays true through later connection trouble.
 */
export const useSyncedWithServer = (mx: MatrixClient): boolean => {
  const [synced, setSynced] = useState(() => mx.getSyncState() === SyncState.Syncing);
  useSyncState(
    mx,
    useCallback((state: SyncState) => {
      if (state === SyncState.Syncing) setSynced(true);
    }, [])
  );
  // The first answer may come between the render that read the state and the subscription.
  useEffect(() => {
    if (mx.getSyncState() === SyncState.Syncing) setSynced(true);
  }, [mx]);
  return synced;
};
