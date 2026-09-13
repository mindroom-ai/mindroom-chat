import { SyncState, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useState } from 'react';
import { useSyncState } from './useSyncState';

export type ClientSyncStateData = {
  current: SyncState | null | undefined;
  previous: SyncState | null | undefined;
};

export const isInitialClientCatchupInProgress = ({
  current,
  previous,
}: ClientSyncStateData): boolean =>
  current == null ||
  ((current === SyncState.Prepared ||
    current === SyncState.Syncing ||
    current === SyncState.Catchup) &&
    previous !== SyncState.Syncing);

export const useInitialClientCatchup = (mx: MatrixClient | undefined): boolean => {
  const [stateData, setStateData] = useState<ClientSyncStateData>({
    current: null,
    previous: undefined,
  });

  useSyncState(
    mx,
    useCallback((current, previous) => {
      setStateData((state) => {
        if (state.current === current && state.previous === previous) {
          return state;
        }
        return { current, previous };
      });
    }, [])
  );

  return isInitialClientCatchupInProgress(stateData);
};
