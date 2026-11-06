import { useEffect, useState } from 'react';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';

/** Whether the client has applied a sync response from the server, not only its stored copy. */
const hasAppliedServerSync = (client: MatrixClient): boolean => {
  const state = client.getSyncState();
  if (state === SyncState.Syncing) return true;
  return state === SyncState.Prepared && !client.getSyncStateData()?.fromCache;
};

/**
 * Turns true once the client has applied its first sync from the server, and stays true. A
 * client that starts from its store is ready before that, but the first sync then catches up on
 * everything since the store was last saved, delivered as live events: what came while the app
 * was closed, and what this device already announced before a reload.
 */
export const useServerSyncApplied = (client: MatrixClient): boolean => {
  const [appliedBy, setAppliedBy] = useState<MatrixClient | undefined>(() =>
    hasAppliedServerSync(client) ? client : undefined
  );
  useEffect(() => {
    const check = () => {
      if (hasAppliedServerSync(client)) setAppliedBy(client);
    };
    check();
    client.on(ClientEvent.Sync, check);
    return () => {
      client.removeListener(ClientEvent.Sync, check);
    };
  }, [client]);
  return appliedBy === client;
};
