import { useEffect } from 'react';
import { ClientEvent, MatrixClient, SyncState, SyncStateData } from 'matrix-js-sdk';

export type SyncStateCallback = (
  state: SyncState,
  previousState: SyncState | null,
  data?: SyncStateData
) => void;

/** Calls `onSyncState` on every sync state change of the client. */
export const useSyncState = (
  mx: MatrixClient | undefined,
  onSyncState: SyncStateCallback
): void => {
  useEffect(() => {
    if (!mx) return undefined;
    mx.on(ClientEvent.Sync, onSyncState);
    return () => {
      mx.removeListener(ClientEvent.Sync, onSyncState);
    };
  }, [mx, onSyncState]);
};
